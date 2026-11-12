import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { analyzeMatrix } from '../../../src/coverage/analyze.js';
import { NwiseKitError } from '../../../src/errors.js';
import type { SuggestCasesOptions } from '../../../src/suggestions/greedy.js';
import { suggestCases } from '../../../src/suggestions/greedy.js';
import { golden, goldenRows } from '../../fixtures/models.js';
import type { Assignment } from '../../reference/brute-force.js';
import { holds } from '../../reference/brute-force.js';
import { asInput, scenarioArb } from '../../support/arbitraries.js';

const base = { model: golden, cases: goldenRows('000', '111') };

function configs(result: ReturnType<typeof suggestCases>): string[] {
  return result.recommendations.map((r) => r.indices.join(''));
}

function rejection(options: SuggestCasesOptions): NwiseKitError {
  try {
    suggestCases(options);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected suggestCases to throw');
}

describe('suggestCases on the reference model', () => {
  test('recommends 001, 010 and 110 with gains 2, 2 and 1 to reach 11 of 11', () => {
    const result = suggestCases({ ...base, targetCoverage: 100, maxNewCases: 3 });
    expect(configs(result)).toEqual(['001', '010', '110']);
    expect(result.recommendations.map((r) => r.gain)).toEqual([2, 2, 1]);
    expect(result.recommendations.map((r) => r.projected.covered)).toEqual([8, 10, 11]);
    expect(result.recommendations.every((r) => r.kind === 'add-case')).toBe(true);
    expect(result.recommendations[0]?.values).toEqual({ A: 0, B: 0, C: 1 });
    expect(result).toMatchObject({
      algorithm: 'greedy-v1',
      basis: 'declared',
      baseline: { covered: 6, total: 11 },
      projected: { covered: 11, total: 11, percentage: 100 },
      targetReached: true,
      suggestionComplete: true,
      stopReason: 'target-reached',
      remaining: [],
    });
  });

  test('returns nothing when the matrix already meets the target', () => {
    const result = suggestCases({
      model: golden,
      cases: goldenRows('000', '001', '010', '011', '110', '111'),
    });
    expect(result.recommendations).toEqual([]);
    expect(result.targetReached).toBe(true);
    expect(result.stopReason).toBe('target-reached');
  });

  test('stops at the case budget with a partial, honestly labelled result', () => {
    const result = suggestCases({ ...base, targetCoverage: 100, maxNewCases: 1 });
    expect(configs(result)).toEqual(['001']);
    expect(result.projected).toMatchObject({ covered: 8, total: 11 });
    expect(result).toMatchObject({
      targetReached: false,
      suggestionComplete: false,
      stopReason: 'case-budget',
    });
    expect(result.remaining).toHaveLength(3);
  });

  test('stops at a lower target', () => {
    const result = suggestCases({ ...base, targetCoverage: '72.727' });
    expect(configs(result)).toEqual(['001']);
    expect(result.targetReached).toBe(true);
    expect(suggestCases({ ...base, targetCoverage: 0 }).recommendations).toEqual([]);
  });

  test('never commits a choice from a scoring pass the work budget cut short', () => {
    // Each full pass checks every remaining candidate against 3 pair groups:
    // 6 x 3 = 18 for the first pass, 5 x 3 = 15 for the second.
    const afterOne = suggestCases({ ...base, limits: { suggestionWork: 20 } });
    expect(configs(afterOne)).toEqual(['001']);
    expect(afterOne.stopReason).toBe('work-budget');
    expect(afterOne.work).toEqual({ used: 18, budget: 20 });
    expect(afterOne.targetReached).toBe(false);

    const none = suggestCases({ ...base, limits: { suggestionWork: 17 } });
    expect(none.recommendations).toEqual([]);
    expect(none.stopReason).toBe('work-budget');
    expect(none.projected).toEqual(none.baseline);
  });
});

describe('suggestCases arguments', () => {
  test('rejects a runtime basis until runtime reports are supported', () => {
    expect(rejection({ ...base, basis: 'observed' }).diagnostics[0]?.code).toBe(
      'BASIS_UNAVAILABLE',
    );
  });

  test.each([0, -1, 1.5, Number.NaN])('rejects a case budget of %d', (maxNewCases) => {
    expect(rejection({ ...base, maxNewCases }).code).toBe('INVALID_ARGUMENTS');
  });

  test.each(['101', '99.9999', 'all'])('rejects a target of %j', (targetCoverage) => {
    expect(rejection({ ...base, targetCoverage }).code).toBe('INVALID_ARGUMENTS');
  });

  test('rejects invalid matrices like the analysis does', () => {
    const bad = [{ id: 'x', values: { A: 1, B: 0, C: 0 } }];
    expect(rejection({ model: golden, cases: bad }).code).toBe('INVALID_MATRIX');
  });
});

describe('suggestion properties', () => {
  const run = (model: Parameters<typeof asInput>[0], rows: Assignment[], maxNewCases: number) =>
    suggestCases({
      model: asInput(model),
      cases: rows.map((values, i) => ({ id: `case-${String(i)}`, values })),
      maxNewCases,
    });

  test('recommends only new, distinct, valid configurations with falling positive gains', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, rows }) => {
        const result = run(model, rows, 50);
        const keys = result.recommendations.map((r) => r.indices.join(','));
        expect(new Set(keys).size).toBe(keys.length);
        for (const r of result.recommendations) {
          expect(model.constraints.every((c) => holds(c.rule, r.values))).toBe(true);
          expect(r.kind).toBe('add-case');
          expect(r.gain).toBeGreaterThan(0);
        }
        const gains = result.recommendations.map((r) => r.gain);
        expect(gains).toEqual([...gains].sort((a, b) => b - a));
        const total = gains.reduce((sum, g) => sum + g, 0);
        expect(result.projected.covered - result.baseline.covered).toBe(total);
      }),
    );
  });

  test('reaches full coverage when the budget allows, as an independent analysis confirms', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, rows, valid }) => {
        const result = run(model, rows, valid.length);
        expect(result.targetReached).toBe(true);
        const combined = [...rows, ...result.recommendations.map((r) => r.values as Assignment)];
        const analysis = analyzeMatrix({
          model: asInput(model),
          cases: combined.map((values, i) => ({ id: `row-${String(i)}`, values })),
        });
        expect(analysis.metrics.declared).toEqual(result.projected);
        expect(analysis.metrics.declared.covered).toBe(analysis.metrics.declared.total);
      }),
    );
  });

  test('gives identical recommendations for identical inputs', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, rows }) => {
        const { durationMs: _a, ...first } = run(model, rows, 5);
        const { durationMs: _b, ...second } = run(model, rows, 5);
        expect(second).toEqual(first);
      }),
      { numRuns: 50 },
    );
  });
});
