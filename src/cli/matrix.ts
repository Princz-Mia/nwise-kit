import type { Inputs } from '../coverage/inputs.js';
import { caseValues } from '../model/cases.js';
import { matrixWithSuggestions } from '../suggestions/file.js';
import type { Recommendation } from '../suggestions/greedy.js';
import { writeOutputFile } from './files.js';

/**
 * Writes the existing cases followed by the recommended new ones as a
 * matrix file, and returns how many cases were added.
 */
export function writeCombinedMatrix(
  path: string,
  inputs: Inputs,
  recommendations: readonly Recommendation[],
  force: boolean,
): number {
  const existing = inputs.cases.map((c) => ({
    id: c.id,
    values: caseValues(inputs.model, c.indices),
  }));
  const combined = matrixWithSuggestions(inputs.model.id, existing, recommendations);
  writeOutputFile(path, `${JSON.stringify(combined, null, 2)}\n`, force);
  return combined.cases.length - existing.length;
}
