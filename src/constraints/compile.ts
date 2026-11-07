import { NwiseKitError } from '../errors.js';
import type { Diagnostic } from '../errors.js';
import type { TestCase } from '../model/cases.js';
import type { Expression, Model } from '../model/types.js';

/** Evaluates against a complete assignment of domain indices in canonical order. */
export type Predicate = (indices: ArrayLike<number>) => boolean;

export interface CompiledConstraint {
  readonly id: string;
  readonly test: Predicate;
}

/**
 * Compiles every model constraint into a predicate over complete
 * assignments. Constraints are evaluated only on complete assignments;
 * there is no partial evaluation.
 */
export function compileConstraints(model: Model): CompiledConstraint[] {
  return model.constraints.map((c) => ({ id: c.id, test: compileExpression(model, c.rule) }));
}

/** True when the assignment satisfies every constraint. */
export function satisfiesAll(
  constraints: readonly CompiledConstraint[],
  indices: ArrayLike<number>,
): boolean {
  for (const constraint of constraints) {
    if (!constraint.test(indices)) {
      return false;
    }
  }
  return true;
}

function compileExpression(model: Model, expression: Expression): Predicate {
  if ('eq' in expression) {
    const [name, value] = expression.eq;
    const position = model.parameterIndex.get(name);
    const target =
      position === undefined ? undefined : model.parameters[position]?.valueIndex.get(value);
    if (position === undefined || target === undefined) {
      // validateModel guarantees both exist; reaching this is a bug.
      throw new Error(`Unresolved constraint reference ${name}=${JSON.stringify(value)}`);
    }
    return (x) => x[position] === target;
  }
  if ('not' in expression) {
    const inner = compileExpression(model, expression.not);
    return (x) => !inner(x);
  }
  if ('and' in expression) {
    const parts = expression.and.map((e) => compileExpression(model, e));
    return (x) => parts.every((part) => part(x));
  }
  if ('or' in expression) {
    const parts = expression.or.map((e) => compileExpression(model, e));
    return (x) => parts.some((part) => part(x));
  }
  const [antecedent, consequent] = expression.implies.map((e) => compileExpression(model, e)) as [
    Predicate,
    Predicate,
  ];
  return (x) => !antecedent(x) || consequent(x);
}

/**
 * Rejects the matrix if any case violates a constraint, naming the
 * constraints each row breaks. Invalid rows are never dropped silently.
 */
export function checkCasesSatisfyConstraints(model: Model, cases: readonly TestCase[]): void {
  const constraints = compileConstraints(model);
  const diagnostics: Diagnostic[] = [];
  for (const testCase of cases) {
    const broken = constraints.filter((c) => !c.test(testCase.indices)).map((c) => c.id);
    if (broken.length > 0) {
      diagnostics.push({
        code: 'CONSTRAINT_VIOLATION',
        severity: 'error',
        message: `Case "${testCase.id}" violates ${broken.map((id) => `"${id}"`).join(', ')}`,
        path: testCase.path,
        caseIds: [testCase.id],
        hint: 'Fix or remove the row; rows that break a constraint cannot count toward coverage.',
      });
    }
  }
  if (diagnostics.length > 0) {
    const n = diagnostics.length;
    throw new NwiseKitError(
      'INVALID_MATRIX',
      `${n} case${n === 1 ? '' : 's'} violate${n === 1 ? 's' : ''} the model constraints`,
      diagnostics,
    );
  }
}
