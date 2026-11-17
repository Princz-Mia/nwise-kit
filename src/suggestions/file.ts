import { parseThreshold } from '../coverage/threshold.js';
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

function isCount(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

function isMetric(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const { covered, total, percentage } = value;
  return (
    isCount(covered, 0) &&
    isCount(total, 1) &&
    covered <= total &&
    typeof percentage === 'number' &&
    Number.isFinite(percentage)
  );
}

function isDomainValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isRecommendation(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value['kind'] === 'add-case' || value['kind'] === 'rerun-existing') &&
    isRecord(value['values']) &&
    Object.values(value['values']).every(isDomainValue) &&
    Array.isArray(value['matchedCaseIds']) &&
    value['matchedCaseIds'].every((id: unknown) => typeof id === 'string') &&
    isCount(value['gain'], 1) &&
    isMetric(value['projected'])
  );
}

const BASES: readonly unknown[] = ['declared', 'observed', 'passed'];
const STOP_REASONS: readonly unknown[] = ['target-reached', 'case-budget', 'work-budget'];

function isTarget(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    parseThreshold(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a suggestions file for display. Every field that is shown is
 * checked, and the file must belong to the expected matrix.
 * Recommendations are projections, so nothing is recomputed.
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
    const invalid = (path: string, message: string): void => {
      issues.error('INVALID_TYPE', path, message);
    };
    if (!BASES.includes(input['basis'])) {
      invalid('/basis', 'basis must be declared, observed or passed');
    }
    if (!STOP_REASONS.includes(input['stopReason'])) {
      invalid('/stopReason', 'stopReason must be target-reached, case-budget or work-budget');
    }
    if (!isTarget(input['target'])) {
      invalid('/target', 'target must be a percentage such as "100" or "99.5"');
    }
    if (typeof input['targetReached'] !== 'boolean') {
      invalid('/targetReached', 'targetReached must be true or false');
    }
    const recommendations = input['recommendations'];
    if (!Array.isArray(recommendations)) {
      invalid('/recommendations', 'recommendations must be an array');
    } else {
      recommendations.forEach((recommendation: unknown, i) => {
        if (!isRecommendation(recommendation)) {
          invalid(`/recommendations/${String(i)}`, 'This recommendation is malformed');
        }
      });
    }
    if (!isMetric(input['baseline'])) {
      invalid('/baseline', 'baseline must be a coverage metric');
    }
    if (!isMetric(input['projected'])) {
      invalid('/projected', 'projected must be a coverage metric');
    }
  }
  if (issues.count > 0) {
    throw new NwiseKitError('INVALID_REPORT', 'Invalid suggestions file', issues.diagnostics);
  }
  return input as SuggestionsFile;
}
