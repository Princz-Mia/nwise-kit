import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { analyzeRun } from '../../../src/evidence/analyze-run.js';
import { contribution } from '../../../src/evidence/lifecycle.js';
import type { TestEvidence } from '../../../src/evidence/types.js';
import { golden } from '../../fixtures/models.js';
import { evidence, rows, testEntry } from './helpers.js';

const zero = rows[0]?.id ?? '';
const one = rows[1]?.id ?? '';

function run(tests: TestEvidence[], changes: Record<string, unknown> = {}) {
  return analyzeRun({ model: golden, cases: rows, evidence: evidence(tests, changes) });
}

function codes(tests: TestEvidence[]): string[] {
  return run(tests).diagnostics.map((d) => d.code);
}

describe('lifecycle rules', () => {
  test.each<[string, Partial<TestEvidence>, boolean, boolean, string | undefined]>([
    ['passed after the checkpoint', {}, true, true, undefined],
    [
      'failed before the checkpoint',
      { outcome: 'failed', checkpointAttempts: [] },
      false,
      false,
      'FAILED_BEFORE_CHECKPOINT',
    ],
    [
      'failed after the checkpoint (or in teardown)',
      { outcome: 'failed' },
      true,
      false,
      'FAILED_AFTER_CHECKPOINT',
    ],
    [
      'skipped',
      { outcome: 'skipped', attempts: 0, checkpointAttempts: [] },
      false,
      false,
      'TEST_SKIPPED',
    ],
    ['todo', { outcome: 'todo', attempts: 0, checkpointAttempts: [] }, false, false, 'TEST_TODO'],
    [
      'filtered out',
      { outcome: 'filtered', attempts: 0, checkpointAttempts: [] },
      false,
      false,
      'TEST_FILTERED',
    ],
    ['recovered on retry', { attempts: 2, checkpointAttempts: [1] }, true, true, 'RETRY_RECOVERED'],
    [
      'reached only in an earlier attempt, then failed',
      { outcome: 'failed', attempts: 2, checkpointAttempts: [0] },
      true,
      false,
      'CHECKPOINT_ABSENT_IN_FINAL_ATTEMPT',
    ],
    [
      'reached only in an earlier attempt, then passed',
      { attempts: 2, checkpointAttempts: [0] },
      true,
      false,
      'CHECKPOINT_ABSENT_IN_FINAL_ATTEMPT',
    ],
    [
      'passed without a checkpoint',
      { checkpointAttempts: [] },
      false,
      false,
      'CHECKPOINT_NOT_REACHED',
    ],
    ['outcome missing after a crash', { outcome: 'missing' }, true, false, 'OUTCOME_MISSING'],
  ])('%s', (_name, changes, observed, passed, code) => {
    const result = contribution(testEntry(zero, changes));
    expect([result.observed, result.passed]).toEqual([observed, passed]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(code === undefined ? [] : [code]);
  });

  test('ignores late checkpoints but reports them', () => {
    const result = contribution(testEntry(zero, { checkpointAttempts: [], lateCheckpoints: 2 }));
    expect(result.observed).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('LATE_CHECKPOINT');
  });
});

describe('analyzeRun', () => {
  test('counts only the rows whose checkpoint was reached', () => {
    // Both rows are declared (6/11); only 000 reached its checkpoint (3/11).
    const analysis = run([
      testEntry(zero),
      testEntry(one, { outcome: 'failed', checkpointAttempts: [] }),
    ]);
    expect(analysis.runtimeComplete).toBe(true);
    expect(analysis.metrics.declared).toMatchObject({ covered: 6, total: 11 });
    expect(analysis.metrics.observed).toMatchObject({ covered: 3, total: 11 });
    expect(analysis.metrics.passed).toMatchObject({ covered: 3, total: 11 });
    expect(analysis.profile.map((p) => [p.observed?.covered, p.passed?.covered])).toEqual([
      [3, 3],
      [3, 3],
    ]);
    expect(analysis.missing.observed).toHaveLength(8);
  });

  test('separates observed from passed when a test fails after its checkpoint', () => {
    const analysis = run([testEntry(zero), testEntry(one, { outcome: 'failed' })]);
    expect(analysis.metrics.observed?.covered).toBe(6);
    expect(analysis.metrics.passed?.covered).toBe(3);
  });

  test('keeps unregistered, skipped and filtered rows in the denominator only', () => {
    const analysis = run(
      [testEntry(zero, { outcome: 'skipped', attempts: 0, checkpointAttempts: [] })],
      {
        filters: { testNamePattern: 'covers', files: [] },
      },
    );
    expect(analysis.metrics.declared.covered).toBe(6);
    expect(analysis.metrics.observed).toMatchObject({ covered: 0, total: 11 });
    expect(analysis.filters).toEqual({ testNamePattern: 'covers', files: [] });
    expect(analysis.diagnostics.map((d) => d.code)).toEqual(['TEST_SKIPPED', 'UNREGISTERED_CASE']);
  });

  test('flags a retry-recovered test and still counts it', () => {
    const analysis = run([
      testEntry(zero, { attempts: 3, checkpointAttempts: [2] }),
      testEntry(one),
    ]);
    expect(analysis.metrics.passed?.covered).toBe(6);
    expect(codes([testEntry(zero, { attempts: 3, checkpointAttempts: [2] })])).toContain(
      'RETRY_RECOVERED',
    );
  });

  test('makes runtime metrics unavailable when an outcome is missing', () => {
    const analysis = run([testEntry(zero), testEntry(one, { outcome: 'missing' })]);
    expect(analysis.runtimeComplete).toBe(false);
    expect(analysis.metrics).toMatchObject({
      declared: { covered: 6 },
      observed: null,
      passed: null,
    });
    expect(analysis.missing.observed).toBeNull();
    expect(analysis.diagnostics.map((d) => d.code)).toContain('RUNTIME_INCOMPLETE');
  });

  test('makes runtime metrics unavailable after an infrastructure error', () => {
    const analysis = run([testEntry(zero), testEntry(one)], {
      infrastructureErrors: ['Worker exited unexpectedly'],
    });
    expect(analysis.runtimeComplete).toBe(false);
    expect(analysis.metrics.passed).toBeNull();
  });

  test('merges identical repeated entries', () => {
    const analysis = run([testEntry(zero), testEntry(zero), testEntry(one)]);
    expect(analysis.evidence.tests).toHaveLength(2);
    expect(analysis.metrics.observed?.covered).toBe(6);
  });

  test('keeps passed <= observed <= declared for any valid evidence', () => {
    const entry = (caseId: string) =>
      fc
        .record({
          outcome: fc.constantFrom('passed', 'failed', 'skipped', 'todo', 'filtered'),
          attempts: fc.integer({ min: 1, max: 3 }),
          reached: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        })
        .map(({ outcome, attempts, reached }) => {
          const ran = outcome === 'passed' || outcome === 'failed' ? attempts : 0;
          const checkpointAttempts = reached.slice(0, ran).flatMap((r, i) => (r ? [i] : []));
          return testEntry(caseId, {
            outcome: outcome as TestEvidence['outcome'],
            attempts: ran,
            checkpointAttempts,
          });
        });
    fc.assert(
      fc.property(
        fc.option(entry(zero), { nil: undefined }),
        fc.option(entry(one), { nil: undefined }),
        (a, b) => {
          const analysis = run([a, b].filter((t): t is TestEvidence => t !== undefined));
          const { declared, observed, passed } = analysis.metrics;
          expect(passed?.covered ?? 0).toBeLessThanOrEqual(observed?.covered ?? 0);
          expect(observed?.covered ?? 0).toBeLessThanOrEqual(declared.covered);
        },
      ),
    );
  });
});
