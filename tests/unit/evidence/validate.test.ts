import { describe, expect, test } from 'vitest';
import type { TestEvidence } from '../../../src/evidence/types.js';
import { validateEvidence } from '../../../src/evidence/validate.js';
import { NwiseKitError } from '../../../src/errors.js';
import { validateCases } from '../../../src/model/cases.js';
import { validateModel } from '../../../src/model/validate-model.js';
import { golden } from '../../fixtures/models.js';
import { evidence, hashes, rows, testEntry } from './helpers.js';

const cases = validateCases(rows, validateModel(golden));
const context = { ...hashes, cases };
const zero = rows[0]?.id ?? '';
const one = rows[1]?.id ?? '';

function rejection(input: unknown): NwiseKitError {
  try {
    validateEvidence(input, context);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected validateEvidence to throw');
}

describe('validateEvidence', () => {
  test('accepts evidence for the current model and matrix', () => {
    const valid = validateEvidence(evidence([testEntry(zero), testEntry(one)]), context);
    expect(valid.tests.map((t) => t.caseId)).toEqual([zero, one]);
    expect(valid.filters).toBeNull();
  });

  test('accepts filters and a null location', () => {
    const valid = validateEvidence(
      evidence([testEntry(zero, { location: null })], {
        filters: { testNamePattern: null, files: ['checkout.test.ts'] },
      }),
      context,
    );
    expect(valid.filters).toEqual({ testNamePattern: null, files: ['checkout.test.ts'] });
  });

  test('merges identical repeated entries', () => {
    const valid = validateEvidence(evidence([testEntry(zero), testEntry(zero)]), context);
    expect(valid.tests).toHaveLength(1);
  });

  test.each<[string, TestEvidence[], Record<string, unknown>, string]>([
    ['a stale run id', [testEntry(zero, { runId: 'run-0' })], {}, 'STALE_RUN_ID'],
    ['an unknown case', [testEntry('row-9-010')], {}, 'UNKNOWN_CASE'],
    ['a wrong model hash', [testEntry(zero)], { modelHash: '0'.repeat(64) }, 'MODEL_HASH_MISMATCH'],
    [
      'a wrong matrix hash',
      [testEntry(zero)],
      { matrixHash: '0'.repeat(64) },
      'MATRIX_HASH_MISMATCH',
    ],
    [
      'conflicting entries',
      [testEntry(zero), testEntry(zero, { outcome: 'failed' })],
      {},
      'CONFLICTING_EVIDENCE',
    ],
    [
      'a case used by two tests',
      [testEntry(zero), testEntry(zero, { testId: 'other' })],
      {},
      'CASE_REGISTERED_TWICE',
    ],
    [
      'a checkpoint beyond the attempts',
      [testEntry(zero, { checkpointAttempts: [1] })],
      {},
      'INVALID_CHECKPOINTS',
    ],
    [
      'unordered checkpoints',
      [testEntry(zero, { attempts: 2, checkpointAttempts: [1, 0] })],
      {},
      'INVALID_CHECKPOINTS',
    ],
    [
      'a skipped test with attempts',
      [testEntry(zero, { outcome: 'skipped' })],
      {},
      'INCONSISTENT_OUTCOME',
    ],
    [
      'a passed test that never ran',
      [testEntry(zero, { attempts: 0, checkpointAttempts: [] })],
      {},
      'INCONSISTENT_OUTCOME',
    ],
    [
      'an unknown outcome',
      [testEntry(zero, { outcome: 'crashed' as never })],
      {},
      'INVALID_OUTCOME',
    ],
  ])('rejects %s', (_name, tests, changes, code) => {
    const error = rejection(evidence(tests, changes));
    expect(error.code).toBe('INVALID_EVIDENCE');
    expect(error.diagnostics.map((d) => d.code)).toContain(code);
  });

  test('rejects unknown keys and other schema versions', () => {
    expect(rejection({ ...evidence([]), extra: 1 }).diagnostics[0]?.code).toBe('UNKNOWN_KEY');
    expect(rejection({ ...evidence([]), schemaVersion: 2 }).diagnostics[0]?.code).toBe(
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });
});
