import { NwiseKitError } from '../errors.js';
import type { Limits } from './limits.js';
import { DEFAULT_LIMITS } from './limits.js';
import { appendPointer } from './pointer.js';
import {
  checkDomainValue,
  checkIdentifier,
  checkObject,
  describe,
  Issues,
  isRecord,
} from './shape.js';
import type { Constraint, DomainValue, Expression, Model, Parameter, Strength } from './types.js';
import { compareCodeUnits } from './types.js';

const OPERATORS = ['eq', 'not', 'and', 'or', 'implies'] as const;
type Operator = (typeof OPERATORS)[number];

type ModelLimits = Pick<Limits, 'maxParameters' | 'maxConstraintDepth' | 'maxConstraintNodes'>;

/**
 * Validates a model as written in JSON and returns it in canonical form.
 * Every problem found is reported in one `INVALID_MODEL` error.
 */
export function validateModel(input: unknown, limits: ModelLimits = DEFAULT_LIMITS): Model {
  const issues = new Issues();
  if (
    !checkObject(
      issues,
      input,
      '',
      'The model',
      ['schemaVersion', 'id', 'strength', 'parameters'],
      ['constraints'],
    )
  ) {
    throw invalid(issues);
  }
  if (Object.hasOwn(input, 'schemaVersion') && input['schemaVersion'] !== 1) {
    throw new NwiseKitError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported model schemaVersion ${JSON.stringify(input['schemaVersion'])}`,
      [
        {
          code: 'UNSUPPORTED_SCHEMA_VERSION',
          severity: 'error',
          message: 'This version of nwise-kit reads model schemaVersion 1',
          path: '/schemaVersion',
        },
      ],
    );
  }

  // Missing keys are already reported; only present values are checked further.
  const id = input['id'];
  const validId = Object.hasOwn(input, 'id') && checkIdentifier(issues, id, '/id', 'The model id');
  const parameters = Object.hasOwn(input, 'parameters')
    ? checkParameters(issues, input['parameters'], limits)
    : undefined;
  const strength = Object.hasOwn(input, 'strength')
    ? checkStrength(issues, input['strength'], parameters?.length)
    : undefined;
  const constraints =
    parameters === undefined
      ? undefined
      : new ConstraintChecker(issues, parameters, limits).check(
          Object.hasOwn(input, 'constraints') ? input['constraints'] : [],
        );

  if (
    issues.count > 0 ||
    !validId ||
    parameters === undefined ||
    constraints === undefined ||
    strength === undefined
  ) {
    throw invalid(issues);
  }
  return {
    schemaVersion: 1,
    id,
    strength,
    parameters,
    parameterIndex: new Map(parameters.map((p, i) => [p.name, i])),
    constraints,
  };
}

function invalid(issues: Issues): NwiseKitError {
  const n = issues.count;
  return new NwiseKitError(
    'INVALID_MODEL',
    `The model has ${n} error${n === 1 ? '' : 's'}`,
    issues.diagnostics,
  );
}

function checkStrength(
  issues: Issues,
  value: unknown,
  parameterCount: number | undefined,
): Strength | undefined {
  if (value !== 2 && value !== 3) {
    issues.error(
      'UNSUPPORTED_STRENGTH',
      '/strength',
      `Strength must be 2 or 3, not ${shown(value)}`,
    );
    return undefined;
  }
  if (parameterCount !== undefined && value > parameterCount) {
    issues.error(
      'STRENGTH_EXCEEDS_PARAMETERS',
      '/strength',
      `Strength ${value} needs at least ${value} parameters; the model has ${parameterCount}`,
    );
    return undefined;
  }
  return value;
}

function checkParameters(
  issues: Issues,
  value: unknown,
  limits: ModelLimits,
): Parameter[] | undefined {
  if (!isRecord(value)) {
    issues.error(
      'INVALID_TYPE',
      '/parameters',
      `Parameters must be an object, not ${describe(value)}`,
    );
    return undefined;
  }
  const names = Object.keys(value).sort(compareCodeUnits);
  if (names.length > limits.maxParameters) {
    issues.error(
      'TOO_MANY_PARAMETERS',
      '/parameters',
      `The model has ${names.length} parameters; the limit is ${limits.maxParameters}`,
    );
    return undefined;
  }
  const before = issues.count;
  const parameters: Parameter[] = [];
  for (const name of names) {
    const path = appendPointer('/parameters', name);
    if (checkIdentifier(issues, name, path, 'A parameter name')) {
      const domain = checkDomain(issues, value[name], path);
      if (domain !== undefined) {
        parameters.push({
          name,
          values: domain,
          valueIndex: new Map(domain.map((v, i) => [v, i])),
        });
      }
    }
  }
  return issues.count === before ? parameters : undefined;
}

function checkDomain(issues: Issues, value: unknown, path: string): DomainValue[] | undefined {
  if (!Array.isArray(value)) {
    issues.error('INVALID_TYPE', path, `A domain must be an array, not ${describe(value)}`);
    return undefined;
  }
  if (value.length === 0) {
    issues.error('EMPTY_DOMAIN', path, 'A domain needs at least one value');
    return undefined;
  }
  const before = issues.count;
  const domain: DomainValue[] = [];
  const seen = new Set<DomainValue>();
  let firstType: string | undefined;
  value.forEach((raw: unknown, i) => {
    const itemPath = appendPointer(path, i);
    const item = checkDomainValue(issues, raw, itemPath);
    if (item === undefined) {
      return;
    }
    firstType ??= typeof item;
    if (typeof item !== firstType) {
      issues.error(
        'MIXED_DOMAIN_TYPES',
        itemPath,
        `Domain mixes ${firstType} and ${typeof item} values`,
        'Use one type per domain, such as strings throughout.',
      );
    } else if (seen.has(item)) {
      issues.error(
        'DUPLICATE_VALUE',
        itemPath,
        `Value ${JSON.stringify(item)} appears more than once`,
      );
    }
    seen.add(item);
    domain.push(item);
  });
  return issues.count === before ? domain : undefined;
}

class ConstraintChecker {
  private nodes = 0;
  private reportedNodes = false;
  private readonly byName: ReadonlyMap<string, Parameter>;

  constructor(
    private readonly issues: Issues,
    parameters: readonly Parameter[],
    private readonly limits: ModelLimits,
  ) {
    this.byName = new Map(parameters.map((p) => [p.name, p]));
  }

  check(value: unknown): Constraint[] | undefined {
    if (!Array.isArray(value)) {
      this.issues.error(
        'INVALID_TYPE',
        '/constraints',
        `Constraints must be an array, not ${describe(value)}`,
      );
      return undefined;
    }
    const before = this.issues.count;
    const ids = new Set<string>();
    const constraints: Constraint[] = [];
    value.forEach((item: unknown, i) => {
      const path = appendPointer('/constraints', i);
      if (!checkObject(this.issues, item, path, 'A constraint', ['id', 'rule'])) {
        return;
      }
      const id = item['id'];
      if (
        Object.hasOwn(item, 'id') &&
        checkIdentifier(this.issues, id, `${path}/id`, 'A constraint id')
      ) {
        if (ids.has(id)) {
          this.issues.error(
            'DUPLICATE_CONSTRAINT_ID',
            `${path}/id`,
            `Constraint id "${id}" is used more than once`,
          );
        }
        ids.add(id);
      }
      const rule = Object.hasOwn(item, 'rule')
        ? this.expression(item['rule'], `${path}/rule`, 1)
        : undefined;
      if (rule !== undefined && typeof id === 'string') {
        constraints.push({ id, rule });
      }
    });
    return this.issues.count === before ? constraints : undefined;
  }

  private expression(value: unknown, path: string, depth: number): Expression | undefined {
    if (depth > this.limits.maxConstraintDepth) {
      this.issues.error(
        'CONSTRAINT_TOO_DEEP',
        path,
        `Constraint expressions may be nested at most ${this.limits.maxConstraintDepth} levels deep`,
      );
      return undefined;
    }
    if (++this.nodes > this.limits.maxConstraintNodes) {
      if (!this.reportedNodes) {
        this.reportedNodes = true;
        this.issues.error(
          'TOO_MANY_CONSTRAINT_NODES',
          path,
          `Constraints may contain at most ${this.limits.maxConstraintNodes} expressions in total`,
        );
      }
      return undefined;
    }
    if (!isRecord(value)) {
      this.issues.error(
        'INVALID_EXPRESSION',
        path,
        `An expression must be an object, not ${describe(value)}`,
      );
      return undefined;
    }
    const keys = Object.keys(value);
    const operator = keys[0];
    if (keys.length !== 1 || operator === undefined || !isOperator(operator)) {
      this.issues.error(
        'INVALID_EXPRESSION',
        path,
        `An expression must have exactly one operator; found ${keys.length === 0 ? 'none' : keys.map((k) => `"${k}"`).join(', ')}`,
        `Operators: ${OPERATORS.join(', ')}.`,
      );
      return undefined;
    }
    const operand = value[operator];
    const operandPath = appendPointer(path, operator);
    switch (operator) {
      case 'eq':
        return this.equality(operand, operandPath);
      case 'not': {
        const inner = this.expression(operand, operandPath, depth + 1);
        return inner === undefined ? undefined : { not: inner };
      }
      case 'and':
      case 'or': {
        const items = this.operands(operand, operandPath, operator, depth, 2, Infinity);
        if (items === undefined) {
          return undefined;
        }
        return operator === 'and' ? { and: items } : { or: items };
      }
      case 'implies': {
        const items = this.operands(operand, operandPath, operator, depth, 2, 2);
        const [antecedent, consequent] = items ?? [];
        return antecedent === undefined || consequent === undefined
          ? undefined
          : { implies: [antecedent, consequent] };
      }
    }
  }

  private operands(
    value: unknown,
    path: string,
    operator: Operator,
    depth: number,
    min: number,
    max: number,
  ): Expression[] | undefined {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      const expected = min === max ? `exactly ${min}` : `at least ${min}`;
      this.issues.error(
        'INVALID_ARITY',
        path,
        `"${operator}" takes an array of ${expected} expressions`,
      );
      return undefined;
    }
    const items = value.map((item: unknown, i) =>
      this.expression(item, appendPointer(path, i), depth + 1),
    );
    return items.every((item) => item !== undefined) ? items : undefined;
  }

  private equality(value: unknown, path: string): Expression | undefined {
    if (!Array.isArray(value) || value.length !== 2) {
      this.issues.error(
        'INVALID_ARITY',
        path,
        '"eq" takes an array of a parameter name and a value',
      );
      return undefined;
    }
    const [name, raw] = value as [unknown, unknown];
    if (typeof name !== 'string') {
      this.issues.error(
        'INVALID_TYPE',
        `${path}/0`,
        `A parameter name must be a string, not ${describe(name)}`,
      );
      return undefined;
    }
    const parameter = this.byName.get(name);
    if (parameter === undefined) {
      this.issues.error('UNKNOWN_PARAMETER', `${path}/0`, `Unknown parameter "${name}"`);
      return undefined;
    }
    const constant = checkDomainValue(this.issues, raw, `${path}/1`);
    if (constant === undefined) {
      return undefined;
    }
    if (!parameter.valueIndex.has(constant)) {
      this.issues.error(
        'VALUE_NOT_IN_DOMAIN',
        `${path}/1`,
        `${JSON.stringify(constant)} is not in the domain of "${name}"`,
        `Domain: ${JSON.stringify(parameter.values)}. Comparison is type-strict.`,
      );
      return undefined;
    }
    return { eq: [name, constant] };
  }
}

function isOperator(key: string): key is Operator {
  return (OPERATORS as readonly string[]).includes(key);
}

function shown(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string'
    ? JSON.stringify(value)
    : describe(value);
}
