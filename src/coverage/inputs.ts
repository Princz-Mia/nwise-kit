import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import type { TestCase } from '../model/cases.js';
import { validateCases, validateMatrix } from '../model/cases.js';
import type { Limits } from '../model/limits.js';
import { resolveLimits } from '../model/limits.js';
import type { Model } from '../model/types.js';
import { validateModel } from '../model/validate-model.js';

/**
 * A model and its cases after every check: the model is valid, each case
 * assigns every parameter a value from its domain, and no case breaks a
 * constraint. Everything downstream works from this, so input is
 * validated exactly once per operation.
 */
export interface Inputs {
  readonly model: Model;
  readonly cases: readonly TestCase[];
  readonly limits: Limits;
}

/** Resolves the limits and validates a model as written in JSON. */
export function prepareModel(
  model: unknown,
  limits?: Partial<Limits>,
): Pick<Inputs, 'model' | 'limits'> {
  const resolved = resolveLimits(limits);
  return { model: validateModel(model, resolved), limits: resolved };
}

/** Validates the `cases` array of a matrix against a model, constraints included. */
export function prepareCases(model: Model, cases: unknown): TestCase[] {
  const valid = validateCases(cases, model);
  checkCasesSatisfyConstraints(model, valid);
  return valid;
}

/** Validates a whole matrix file against a model, constraints included. */
export function prepareMatrix(model: Model, matrix: unknown): TestCase[] {
  const valid = validateMatrix(matrix, model);
  checkCasesSatisfyConstraints(model, valid);
  return valid;
}

/** Prepares a model and the `cases` array of its matrix. */
export function prepareInputs(model: unknown, cases: unknown, limits?: Partial<Limits>): Inputs {
  const prepared = prepareModel(model, limits);
  return { ...prepared, cases: prepareCases(prepared.model, cases) };
}

/** Prepares a model and a whole matrix file. */
export function prepareMatrixInputs(
  model: unknown,
  matrix: unknown,
  limits?: Partial<Limits>,
): Inputs {
  const prepared = prepareModel(model, limits);
  return { ...prepared, cases: prepareMatrix(prepared.model, matrix) };
}
