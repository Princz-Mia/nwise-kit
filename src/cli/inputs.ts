import type { Inputs } from '../coverage/inputs.js';
import { prepareMatrix, prepareModel } from '../coverage/inputs.js';
import { inFile, readJsonFile } from './files.js';

/**
 * Reads and validates a model file and, if given, a matrix file. Errors
 * name the file they come from. Without a matrix file the matrix is empty,
 * which is how a suite is built from scratch.
 */
export function loadInputs(modelPath: string, casesPath: string | undefined): Inputs {
  const { model, limits } = inFile(modelPath, () => prepareModel(readJsonFile(modelPath)));
  const matrix: unknown =
    casesPath === undefined
      ? { schemaVersion: 1, modelId: model.id, cases: [] }
      : readJsonFile(casesPath);
  const cases = inFile(casesPath ?? modelPath, () => prepareMatrix(model, matrix));
  return { model, cases, limits };
}
