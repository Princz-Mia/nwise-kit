import { NwiseKitError } from '../errors.js';
import { checkObject, Issues, isRecord } from '../model/shape.js';
import type { SuggestionResult } from './greedy.js';

export const SUGGESTIONS_SCHEMA_VERSION = 1;

/** A suggestions file: the search result with its contract version and producer. */
export type SuggestionsFile = {
  readonly schemaVersion: typeof SUGGESTIONS_SCHEMA_VERSION;
  readonly toolVersion: string;
  readonly kind: 'suggestions';
} & SuggestionResult;

export function createSuggestionsFile(
  result: SuggestionResult,
  toolVersion: string,
): SuggestionsFile {
  return {
    schemaVersion: SUGGESTIONS_SCHEMA_VERSION,
    toolVersion,
    kind: 'suggestions',
    ...result,
  };
}

/** Serialises a suggestions file as indented JSON with a trailing newline. */
export function formatSuggestions(file: SuggestionsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

const FILE_KEYS = [
  'schemaVersion',
  'toolVersion',
  'kind',
  'algorithm',
  'basis',
  'runId',
  'modelId',
  'strength',
  'modelHash',
  'matrixHash',
  'target',
  'maxNewCases',
  'baseline',
  'recommendations',
  'projected',
  'targetReached',
  'suggestionComplete',
  'stopReason',
  'remaining',
  'work',
  'diagnostics',
  'limits',
  'durationMs',
] as const;

function isMetric(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { covered, total, percentage } = value;
  return (
    Number.isSafeInteger(covered) && Number.isSafeInteger(total) && typeof percentage === 'number'
  );
}

/**
 * Reads a suggestions file for display. It checks the structure the
 * display relies on and that the file belongs to the expected matrix;
 * recommendations are projections, so nothing is recomputed.
 */
export function readSuggestionsFile(input: unknown, matrixHash: string): SuggestionsFile {
  const issues = new Issues();
  if (checkObject(issues, input, '', 'The suggestions file', FILE_KEYS)) {
    if (input['schemaVersion'] !== SUGGESTIONS_SCHEMA_VERSION || input['kind'] !== 'suggestions') {
      issues.error(
        'UNSUPPORTED_SCHEMA_VERSION',
        '/schemaVersion',
        'Expected a suggestions file with schemaVersion 1',
      );
    }
    if (input['matrixHash'] !== matrixHash) {
      issues.error(
        'MATRIX_HASH_MISMATCH',
        '/matrixHash',
        'The suggestions were made for a different matrix',
      );
    }
    const recommendations = input['recommendations'];
    if (
      !Array.isArray(recommendations) ||
      !recommendations.every(
        (r: unknown) =>
          isRecord(r) &&
          (r['kind'] === 'add-case' || r['kind'] === 'rerun-existing') &&
          isRecord(r['values']) &&
          Array.isArray(r['matchedCaseIds']) &&
          Number.isSafeInteger(r['gain']) &&
          isMetric(r['projected']),
      )
    ) {
      issues.error('INVALID_TYPE', '/recommendations', 'Recommendations are malformed');
    }
    if (!isMetric(input['baseline']) || !isMetric(input['projected'])) {
      issues.error('INVALID_TYPE', '/baseline', 'Baseline and projected coverage must be metrics');
    }
  }
  if (issues.count > 0) {
    throw new NwiseKitError('INVALID_REPORT', 'Invalid suggestions file', issues.diagnostics);
  }
  return input as SuggestionsFile;
}
