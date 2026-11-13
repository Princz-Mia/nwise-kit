import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { suggestCases } from '../../../src/suggestions/greedy.js';
import { golden } from '../../fixtures/models.js';
import { evidence, rows, testEntry } from '../evidence/helpers.js';

const zero = rows[0]?.id ?? '';
const one = rows[1]?.id ?? '';

describe('suggestions from a runtime basis', () => {
  test('recommends rerunning an existing row that was never observed', () => {
    // 111 failed before its checkpoint, so only 000 counts as observed.
    const run = evidence([
      testEntry(zero),
      testEntry(one, { outcome: 'failed', checkpointAttempts: [] }),
    ]);
    const result = suggestCases({ model: golden, cases: rows, basis: 'observed', evidence: run });
    expect(result.runId).toBe('run-1');
    expect(result.baseline).toMatchObject({ covered: 3, total: 11 });
    expect(result.recommendations.map((r) => [r.indices.join(''), r.kind])).toEqual([
      ['011', 'add-case'],
      ['110', 'add-case'],
      ['001', 'add-case'],
      ['111', 'rerun-existing'],
    ]);
    expect(result.recommendations.at(-1)).toMatchObject({
      matchedCaseIds: [one],
      previousOutcomes: [{ caseId: one, outcome: 'failed' }],
    });
    expect(result.targetReached).toBe(true);
  });

  test('starts lower from passed than from observed when a test fails after its checkpoint', () => {
    const run = evidence([testEntry(zero), testEntry(one, { outcome: 'failed' })]);
    const observed = suggestCases({ model: golden, cases: rows, basis: 'observed', evidence: run });
    const passed = suggestCases({ model: golden, cases: rows, basis: 'passed', evidence: run });
    expect(observed.baseline.covered).toBe(6);
    expect(passed.baseline.covered).toBe(3);
    expect(passed.recommendations.some((r) => r.kind === 'rerun-existing')).toBe(true);
  });

  test('labels nothing as a rerun on the declared basis', () => {
    const result = suggestCases({ model: golden, cases: rows });
    expect(result.runId).toBeNull();
    expect(result.recommendations.every((r) => r.previousOutcomes.length === 0)).toBe(true);
  });

  test('refuses evidence from an incomplete run', () => {
    const run = evidence([testEntry(zero), testEntry(one, { outcome: 'missing' })]);
    expect(() =>
      suggestCases({ model: golden, cases: rows, basis: 'passed', evidence: run }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME_INCOMPLETE' }) as NwiseKitError);
  });

  test('refuses evidence for another matrix', () => {
    const run = evidence([testEntry(zero)], { matrixHash: '0'.repeat(64) });
    expect(() =>
      suggestCases({ model: golden, cases: rows, basis: 'observed', evidence: run }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }) as NwiseKitError);
  });
});
