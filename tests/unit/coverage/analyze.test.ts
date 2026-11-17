import { describe, expect, test } from 'vitest';
import { analyzeInputs, analyzeMatrix } from '../../../src/coverage/analyze.js';
import { prepareInputs } from '../../../src/coverage/inputs.js';
import { NwiseKitError } from '../../../src/errors.js';
import { golden, goldenRows } from '../../fixtures/models.js';

function rejection(run: () => unknown): NwiseKitError {
  try {
    run();
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a NwiseKitError');
}

function pairs(missing: readonly { parameters: readonly string[]; values: readonly unknown[] }[]) {
  return missing.map((m) => m.parameters.map((p, i) => `${p}${String(m.values[i])}`).join('–'));
}

describe('analyzeMatrix on the golden model', () => {
  test('covers 6 of 11 pairs with rows 000 and 111, missing exactly five', () => {
    const analysis = analyzeMatrix({ model: golden, cases: goldenRows('000', '111') });
    expect(analysis.metrics.declared).toEqual({ covered: 6, total: 11, percentage: 600 / 11 });
    expect(analysis.metrics.declared.percentage.toFixed(2)).toBe('54.55');
    expect(pairs(analysis.missing.declared)).toEqual(['A0–B1', 'A0–C1', 'A1–C0', 'B0–C1', 'B1–C0']);
    expect(analysis.universe).toEqual({
      rawConfigurations: 8,
      validConfigurations: 6,
      interactions: 11,
    });
  });

  test('reports exact counts per parameter group', () => {
    const analysis = analyzeMatrix({ model: golden, cases: goldenRows('000', '111') });
    expect(analysis.groups.map((g) => [g.parameters.join('–'), g.declared.covered, g.declared.total])).toEqual([
      ['A–B', 2, 3],
      ['A–C', 2, 4],
      ['B–C', 2, 4],
    ]);
  });

  test('covers 2 of 6 triples at strength three', () => {
    const analysis = analyzeMatrix({
      model: { ...golden, strength: 3 },
      cases: goldenRows('000', '111'),
    });
    expect(analysis.metrics.declared).toMatchObject({ covered: 2, total: 6 });
    expect(analysis.groups).toHaveLength(1);
  });

  test('gives zero declared coverage for an empty matrix and leaves runtime metrics null', () => {
    const analysis = analyzeMatrix({ model: golden, cases: [] });
    expect(analysis.metrics).toEqual({
      declared: { covered: 0, total: 11, percentage: 0 },
      observed: null,
      passed: null,
    });
    expect(analysis.missing.declared).toHaveLength(11);
  });

  test('ignores row order and counts repeated configurations once, with a diagnostic', () => {
    const base = analyzeMatrix({ model: golden, cases: goldenRows('000', '111') });
    const shuffled = analyzeMatrix({
      model: golden,
      cases: [...goldenRows('111', '000'), { id: 'again', values: { A: 0, B: 0, C: 0 } }],
    });
    expect(shuffled.metrics).toEqual(base.metrics);
    expect(shuffled.groups).toEqual(base.groups);
    expect(shuffled.missing).toEqual(base.missing);
    expect(shuffled.diagnostics).toEqual([
      expect.objectContaining({
        code: 'REDUNDANT_CONFIGURATION',
        severity: 'warning',
        caseIds: ['again', 'row-1-000'],
      }),
    ]);
  });

  test('reaches 100% with every valid configuration', () => {
    const analysis = analyzeMatrix({
      model: golden,
      cases: goldenRows('000', '001', '010', '011', '110', '111'),
    });
    expect(analysis.metrics.declared).toEqual({ covered: 11, total: 11, percentage: 100 });
    expect(analysis.missing.declared).toEqual([]);
  });

  test('identifies the inputs by hash', () => {
    const analysis = analyzeMatrix({ model: golden, cases: goldenRows('000') });
    expect(analysis.modelHash).toMatch(/^[0-9a-f]{64}$/);
    expect(analysis.matrixHash).toMatch(/^[0-9a-f]{64}$/);
    expect(analysis.matrixHash).not.toBe(analysis.modelHash);
  });
});

describe('analyzeMatrix strength profile', () => {
  const profile = (analysis: ReturnType<typeof analyzeMatrix>) =>
    analysis.profile.map((p) => [p.strength, p.declared.covered, p.declared.total]);

  test('shows each value covered while pairs are still missing', () => {
    const analysis = analyzeMatrix({ model: golden, cases: goldenRows('000', '111') });
    expect(profile(analysis)).toEqual([
      [1, 6, 6],
      [2, 6, 11],
    ]);
    expect(analysis.profile.at(-1)?.declared).toEqual(analysis.metrics.declared);
    expect(analysis.profile.every((p) => p.observed === null && p.passed === null)).toBe(true);
  });

  test('runs from single values up to three-way interactions at strength three', () => {
    const analysis = analyzeMatrix({
      model: { ...golden, strength: 3 },
      cases: goldenRows('000', '111'),
    });
    expect(profile(analysis)).toEqual([
      [1, 6, 6],
      [2, 6, 11],
      [3, 2, 6],
    ]);
  });

  test('measures single values at strength one', () => {
    const analysis = analyzeMatrix({ model: { ...golden, strength: 1 }, cases: goldenRows('000') });
    expect(profile(analysis)).toEqual([[1, 3, 6]]);
    expect(analysis.groups.map((g) => g.parameters)).toEqual([['A'], ['B'], ['C']]);
    expect(pairs(analysis.missing.declared)).toEqual(['A1', 'B1', 'C1']);
  });

  test('measures every strength up to the number of parameters', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const parameters = Object.fromEntries(names.map((n) => [n, [0, 1]]));
    const model = { schemaVersion: 1, id: 'eight', strength: 8, parameters };
    const row = { id: 'zeros', values: Object.fromEntries(names.map((n) => [n, 0])) };
    const analysis = analyzeMatrix({ model, cases: [row] });
    // C(8, k) parameter groups with 2^k value combinations each; one row covers one per group.
    expect(profile(analysis)).toEqual([
      [1, 8, 16],
      [2, 28, 112],
      [3, 56, 448],
      [4, 70, 1120],
      [5, 56, 1792],
      [6, 28, 1792],
      [7, 8, 1024],
      [8, 1, 256],
    ]);
    expect(analysis.groups).toHaveLength(1);
    expect(analysis.missing.declared).toHaveLength(255);
  });

  test('is exhaustive at full strength: each valid configuration is one interaction', () => {
    const analysis = analyzeMatrix({
      model: { ...golden, strength: 3 },
      cases: goldenRows('000', '111'),
    });
    expect(analysis.universe.interactions).toBe(analysis.universe.validConfigurations);
    expect(analysis.metrics.declared).toMatchObject({ covered: 2, total: 6 });
  });

  test('finds a four-way gap that three-way coverage hides', () => {
    // Every row has an even number of ones, so all triples appear but half of the quadruples do not.
    const parameters = Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [n, [0, 1]]));
    const cases = Array.from({ length: 16 }, (_, i) => [i >> 3, (i >> 2) & 1, (i >> 1) & 1, i & 1])
      .filter((bits) => bits.reduce((sum, bit) => sum + bit, 0) % 2 === 0)
      .map((bits, i) => ({
        id: `even-${String(i)}`,
        values: { a: bits[0] ?? 0, b: bits[1] ?? 0, c: bits[2] ?? 0, d: bits[3] ?? 0 },
      }));
    const analysis = analyzeMatrix({
      model: { schemaVersion: 1, id: 'parity', strength: 4, parameters },
      cases,
    });
    expect(profile(analysis)).toEqual([
      [1, 8, 8],
      [2, 24, 24],
      [3, 32, 32],
      [4, 8, 16],
    ]);
  });

  test('counts only valid single values', () => {
    const model = { ...golden, constraints: [{ id: 'no-c1', rule: { eq: ['C', 0] } }] };
    const analysis = analyzeMatrix({ model, cases: [] });
    expect(profile(analysis)[0]).toEqual([1, 0, 5]);
  });

  test('applies the interaction limit to the model strength only', () => {
    // Strength three has 6 valid triples but 11 valid pairs.
    const model = { ...golden, strength: 3 };
    const analysis = analyzeMatrix({ model, cases: [], limits: { maxInteractions: 6 } });
    expect(analysis.metrics.declared.total).toBe(6);
  });
});

describe('analyzeMatrix feasibility', () => {
  test('reports an unsatisfiable model instead of a percentage', () => {
    const model = {
      ...golden,
      constraints: [
        { id: 'a', rule: { eq: ['A', 1] } },
        { id: 'not-a', rule: { not: { eq: ['A', 1] } } },
      ],
    };
    const error = rejection(() => analyzeMatrix({ model, cases: [] }));
    expect(error.code).toBe('UNSATISFIABLE_MODEL');
  });

  test('excludes a pair ruled out only through a chain of constraints', () => {
    const model = {
      ...golden,
      constraints: [
        { id: 'a-b', rule: { implies: [{ eq: ['A', 1] }, { eq: ['B', 1] }] } },
        { id: 'b-c', rule: { implies: [{ eq: ['B', 1] }, { eq: ['C', 1] }] } },
      ],
    };
    const analysis = analyzeMatrix({ model, cases: [] });
    const ac = analysis.missing.declared.filter((m) => m.parameters.join() === 'A,C');
    expect(pairs(ac)).toEqual(['A0–C0', 'A0–C1', 'A1–C1']);
  });

  test('warns about domain values no valid configuration uses', () => {
    const model = { ...golden, constraints: [{ id: 'no-c1', rule: { eq: ['C', 0] } }] };
    const analysis = analyzeMatrix({ model, cases: [] });
    expect(analysis.diagnostics).toEqual([
      expect.objectContaining({ code: 'UNREACHABLE_VALUE', severity: 'warning', path: '/parameters/C/1' }),
    ]);
  });

  test('weights the overall percentage by group size, not by group average', () => {
    const model = {
      schemaVersion: 1,
      id: 'weighted',
      strength: 2,
      parameters: { A: [0, 1], B: [0, 1, 2, 3], C: [0] },
    };
    // Groups: A–B has 8 valid pairs, A–C 2, B–C 4. One row covers one pair of each.
    const analysis = analyzeMatrix({ model, cases: [{ id: 'r', values: { A: 0, B: 0, C: 0 } }] });
    expect(analysis.metrics.declared).toMatchObject({ covered: 3, total: 14 });
    const groupAverage = analysis.groups.reduce((sum, g) => sum + g.declared.percentage, 0) / 3;
    expect(analysis.metrics.declared.percentage).not.toBeCloseTo(groupAverage);
  });
});

describe('analyzeMatrix limits', () => {
  const wide = {
    schemaVersion: 1,
    id: 'wide',
    strength: 2,
    parameters: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`p${String(i)}`, [0, 1, 2, 3]]),
    ),
  };

  test('rejects a raw product over the limit before enumerating', () => {
    let clockReads = 0;
    const error = rejection(() =>
      analyzeInputs(prepareInputs(wide, [], { maxRawConfigurations: 1_000_000 }), {
        now: () => clockReads++,
      }),
    );
    expect(error.code).toBe('LIMIT_EXCEEDED');
    expect(error.message).toContain('1048576 raw configurations');
    expect(clockReads).toBe(1);
  });

  test('accepts a model exactly at each limit and rejects one past it', () => {
    // The golden model has 8 raw configurations, 6 valid ones and 11 valid pairs.
    const atLimits = { maxRawConfigurations: 8, maxValidConfigurations: 6, maxInteractions: 11 };
    expect(analyzeMatrix({ model: golden, cases: [], limits: atLimits }).universe).toEqual({
      rawConfigurations: 8,
      validConfigurations: 6,
      interactions: 11,
    });
    const overRaw = rejection(() =>
      analyzeMatrix({ model: golden, cases: [], limits: { maxRawConfigurations: 7 } }),
    );
    expect(overRaw.code).toBe('LIMIT_EXCEEDED');
  });

  test('stops with an incomplete analysis when valid configurations exceed the limit', () => {
    const error = rejection(() =>
      analyzeMatrix({ model: golden, cases: [], limits: { maxValidConfigurations: 5 } }),
    );
    expect(error.code).toBe('ANALYSIS_INCOMPLETE');
    expect(error.diagnostics[0]?.code).toBe('VALID_CONFIGURATIONS_EXCEEDED');
  });

  test('stops with an incomplete analysis when interactions exceed the limit', () => {
    const error = rejection(() =>
      analyzeMatrix({ model: golden, cases: [], limits: { maxInteractions: 10 } }),
    );
    expect(error.code).toBe('ANALYSIS_INCOMPLETE');
    expect(error.diagnostics[0]?.code).toBe('INTERACTIONS_EXCEEDED');
  });

  test('refuses a strength that needs too many parameter groups', () => {
    const single = (count: number) => ({
      schemaVersion: 1,
      id: 'deep',
      strength: count,
      parameters: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${String(i)}`, [0]])),
    });
    // Full strength over n parameters has 2^n - 1 groups; the bound is 2^17.
    expect(analyzeMatrix({ model: single(17), cases: [] }).universe.interactions).toBe(1);
    const error = rejection(() => analyzeMatrix({ model: single(18), cases: [] }));
    expect(error.code).toBe('ANALYSIS_INCOMPLETE');
    expect(error.diagnostics[0]?.code).toBe('PARAMETER_GROUPS_EXCEEDED');
    expect(error.diagnostics[0]?.hint).toBe('Lower the strength or remove parameters.');
  });

  test('looks at the clock more often when each configuration updates many groups', () => {
    // 2^11 configurations of 2^11 - 1 groups each: far more work than 2^11 pairwise rows.
    const parameters = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`p${String(i).padStart(2, '0')}`, [0, 1]]),
    );
    const reads = (strength: number): number => {
      let count = 0;
      analyzeInputs(prepareInputs({ schemaVersion: 1, id: 'clock', strength, parameters }, []), {
        now: () => {
          count++;
          return 0;
        },
      });
      return count;
    };
    expect(reads(2)).toBeLessThan(40);
    expect(reads(11)).toBeGreaterThan(1000);
  });

  test('stops with an incomplete analysis when the time limit passes', () => {
    let t = 0;
    const error = rejection(() =>
      analyzeInputs(
        prepareInputs({ ...wide, parameters: { ...wide.parameters, p9: [0] } }, [], {
          analysisTimeMs: 50,
        }),
        { now: () => (t += 100) },
      ),
    );
    expect(error.code).toBe('ANALYSIS_INCOMPLETE');
    expect(error.diagnostics[0]?.code).toBe('ANALYSIS_TIME_EXCEEDED');
  });

  test('rejects invalid rows before analysing', () => {
    const error = rejection(() =>
      analyzeMatrix({ model: golden, cases: [{ id: 'bad', values: { A: 1, B: 0, C: 0 } }] }),
    );
    expect(error.code).toBe('INVALID_MATRIX');
    expect(error.diagnostics[0]?.code).toBe('CONSTRAINT_VIOLATION');
  });
});
