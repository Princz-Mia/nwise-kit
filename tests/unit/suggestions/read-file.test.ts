import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import {
  createSuggestionsFile,
  formatSuggestions,
  readSuggestionsFile,
} from '../../../src/suggestions/file.js';
import { suggestCases } from '../../../src/suggestions/greedy.js';
import { golden, goldenRows } from '../../fixtures/models.js';

const file = createSuggestionsFile(
  suggestCases({ model: golden, cases: goldenRows('000', '111') }),
  '1.2.3',
);

function stored(): Record<string, unknown> {
  return JSON.parse(formatSuggestions(file)) as Record<string, unknown>;
}

function paths(input: unknown, hash = file.matrixHash): (string | undefined)[] {
  try {
    readSuggestionsFile(input, hash);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error.diagnostics.map((d) => d.path);
    }
    throw error;
  }
  return [];
}

describe('readSuggestionsFile', () => {
  test('accepts a file written by the tool', () => {
    expect(readSuggestionsFile(stored(), file.matrixHash)).toEqual(file);
  });

  test('rejects a file for another matrix', () => {
    expect(paths(stored(), '0'.repeat(64))).toEqual(['/matrixHash']);
  });

  test.each<[string, unknown, string]>([
    ['basis', 'lines', '/basis'],
    ['stopReason', { replace: 1 }, '/stopReason'],
    ['target', 100, '/target'],
    ['target', '<b>100</b>', '/target'],
    ['targetReached', 'yes', '/targetReached'],
    ['recommendations', {}, '/recommendations'],
    ['baseline', { covered: 12, total: 11, percentage: 100 }, '/baseline'],
    ['projected', null, '/projected'],
  ])('rejects a bad %s', (key, value, path) => {
    expect(paths({ ...stored(), [key]: value })).toEqual([path]);
  });

  test.each<[string, unknown]>([
    ['kind', 'delete-everything'],
    ['values', { A: { nested: true } }],
    ['matchedCaseIds', [1]],
    ['gain', 0],
    ['projected', { covered: 1 }],
  ])('rejects a recommendation with a bad %s', (key, value) => {
    const edited = stored() as { recommendations: Record<string, unknown>[] };
    edited.recommendations[1] = { ...edited.recommendations[1], [key]: value };
    expect(paths(edited)).toEqual(['/recommendations/1']);
  });

  test('rejects unknown keys and other kinds of file', () => {
    expect(paths({ ...stored(), extra: 1 })).toEqual(['/extra']);
    expect(paths({ ...stored(), kind: 'report' })).toEqual(['/schemaVersion']);
  });
});
