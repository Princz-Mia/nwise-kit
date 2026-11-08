import { NwiseKitError } from '../errors.js';
import { appendPointer } from './pointer.js';
import {
  checkDomainValue,
  checkIdentifier,
  checkObject,
  describe,
  Issues,
  isRecord,
} from './shape.js';
import type { DomainValue, Model } from './types.js';

/** One row of a matrix as written in JSON. */
export interface CaseInput {
  readonly id: string;
  readonly values: Readonly<Record<string, DomainValue>>;
}

/** A matrix file as written in JSON. */
export interface MatrixInput {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly cases: readonly CaseInput[];
}

/** A structurally valid case. Constraints are checked separately. */
export interface TestCase {
  readonly id: string;
  /** Domain index of each parameter, in canonical parameter order. */
  readonly indices: readonly number[];
  /** JSON Pointer of the row in its input, for diagnostics. */
  readonly path: string;
}

/**
 * Validates a matrix file: its schema version, that it belongs to the
 * model, and every case.
 */
export function validateMatrix(input: unknown, model: Model): TestCase[] {
  const issues = new Issues();
  if (!checkObject(issues, input, '', 'The matrix', ['schemaVersion', 'modelId', 'cases'])) {
    throw invalid(issues);
  }
  if (Object.hasOwn(input, 'schemaVersion') && input['schemaVersion'] !== 1) {
    throw new NwiseKitError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported matrix schemaVersion ${JSON.stringify(input['schemaVersion'])}`,
      [
        {
          code: 'UNSUPPORTED_SCHEMA_VERSION',
          severity: 'error',
          message: 'This version of nwise-kit reads matrix schemaVersion 1',
          path: '/schemaVersion',
        },
      ],
    );
  }
  const modelId = input['modelId'];
  if (
    Object.hasOwn(input, 'modelId') &&
    checkIdentifier(issues, modelId, '/modelId', 'The model id') &&
    modelId !== model.id
  ) {
    issues.error(
      'MODEL_ID_MISMATCH',
      '/modelId',
      `The matrix is for model "${modelId}", not "${model.id}"`,
    );
  }
  const cases = Object.hasOwn(input, 'cases')
    ? checkCases(issues, input['cases'], model, '/cases')
    : [];
  if (issues.count > 0) {
    throw invalid(issues);
  }
  return cases;
}

/**
 * Validates the rows of a matrix. Each row must assign every parameter
 * exactly once with a value from its domain, and case ids must be unique.
 * Rows are never dropped: any problem rejects the whole matrix.
 */
export function validateCases(input: unknown, model: Model, path = '/cases'): TestCase[] {
  const issues = new Issues();
  const cases = checkCases(issues, input, model, path);
  if (issues.count > 0) {
    throw invalid(issues);
  }
  return cases;
}

function invalid(issues: Issues): NwiseKitError {
  const n = issues.count;
  return new NwiseKitError(
    'INVALID_MATRIX',
    `The matrix has ${n} error${n === 1 ? '' : 's'}`,
    issues.diagnostics,
  );
}

function checkCases(issues: Issues, input: unknown, model: Model, path: string): TestCase[] {
  if (!Array.isArray(input)) {
    issues.error('INVALID_TYPE', path, `Cases must be an array, not ${describe(input)}`);
    return [];
  }
  const ids = new Set<string>();
  const cases: TestCase[] = [];
  input.forEach((row: unknown, i) => {
    const rowPath = appendPointer(path, i);
    if (!checkObject(issues, row, rowPath, 'A case', ['id', 'values'])) {
      return;
    }
    const id = row['id'];
    const validId =
      Object.hasOwn(row, 'id') && checkIdentifier(issues, id, `${rowPath}/id`, 'A case id');
    if (validId) {
      if (ids.has(id)) {
        issues.error(
          'DUPLICATE_CASE_ID',
          `${rowPath}/id`,
          `Case id "${id}" is used more than once`,
          'Give every case its own id.',
        );
      }
      ids.add(id);
    }
    const indices = Object.hasOwn(row, 'values')
      ? checkValues(issues, row['values'], model, `${rowPath}/values`)
      : undefined;
    if (validId && indices !== undefined) {
      cases.push({ id, indices, path: rowPath });
    }
  });
  return cases;
}

function checkValues(
  issues: Issues,
  input: unknown,
  model: Model,
  path: string,
): number[] | undefined {
  if (!isRecord(input)) {
    issues.error('INVALID_TYPE', path, `Case values must be an object, not ${describe(input)}`);
    return undefined;
  }
  const before = issues.count;
  for (const name of Object.keys(input)) {
    if (!model.parameterIndex.has(name)) {
      issues.error('UNKNOWN_PARAMETER', appendPointer(path, name), `Unknown parameter "${name}"`);
    }
  }
  const indices = model.parameters.map((parameter) => {
    const valuePath = appendPointer(path, parameter.name);
    if (!Object.hasOwn(input, parameter.name)) {
      issues.error(
        'MISSING_PARAMETER',
        path,
        `The case does not assign "${parameter.name}"`,
        'Every case assigns every parameter.',
      );
      return -1;
    }
    const value = checkDomainValue(issues, input[parameter.name], valuePath);
    if (value === undefined) {
      return -1;
    }
    const index = parameter.valueIndex.get(value);
    if (index === undefined) {
      issues.error(
        'VALUE_NOT_IN_DOMAIN',
        valuePath,
        `${JSON.stringify(value)} is not in the domain of "${parameter.name}"`,
        `Domain: ${JSON.stringify(parameter.values)}. Comparison is type-strict.`,
      );
      return -1;
    }
    return index;
  });
  return issues.count === before ? indices : undefined;
}

/** The values of a case keyed by parameter name, in canonical order. */
export function caseValues(model: Model, indices: readonly number[]): Record<string, DomainValue> {
  const values: Record<string, DomainValue> = {};
  model.parameters.forEach((parameter, i) => {
    const value = parameter.values[indices[i] ?? -1];
    if (value !== undefined) {
      Object.defineProperty(values, parameter.name, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  });
  return values;
}
