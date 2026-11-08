import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { analyzeMatrix } from '../../../src/coverage/analyze.js';
import type { StaticAnalysis } from '../../../src/coverage/analyze.js';
import { NwiseKitError } from '../../../src/errors.js';
import type { Assignment, ReferenceModel, Rule, Value } from '../../reference/brute-force.js';
import { referenceCoverage, validAssignments } from '../../reference/brute-force.js';

const NAMES = ['zeta', 'alpha', 'Beta', 'é', 'm/n'];

const domainArb = fc.oneof(
  fc.integer({ min: 1, max: 3 }).map((size) => Array.from({ length: size }, (_, i): Value => i)),
  fc.integer({ min: 1, max: 3 }).map((size) => Array.from({ length: size }, (_, i): Value => `v${String(i)}`)),
  fc.constantFrom<Value[]>([false, true], [true]),
);

function ruleArb(parameters: Record<string, Value[]>): fc.Arbitrary<Rule> {
  const leaves = Object.entries(parameters).flatMap(([name, values]) =>
    values.map((value): Rule => ({ eq: [name, value] })),
  );
  const { rule } = fc.letrec<{ rule: Rule }>((tie) => ({
    rule: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      fc.constantFrom(...leaves),
      tie('rule').map((r): Rule => ({ not: r })),
      fc.array(tie('rule'), { minLength: 2, maxLength: 3 }).map((rs): Rule => ({ and: rs })),
      fc.array(tie('rule'), { minLength: 2, maxLength: 3 }).map((rs): Rule => ({ or: rs })),
      fc.tuple(tie('rule'), tie('rule')).map(([p, q]): Rule => ({ implies: [p, q] })),
    ),
  }));
  return rule;
}

const modelArb: fc.Arbitrary<ReferenceModel> = fc
  .integer({ min: 2, max: 4 })
  .chain((n) => fc.tuple(fc.shuffledSubarray(NAMES, { minLength: n, maxLength: n }), fc.array(domainArb, { minLength: n, maxLength: n })))
  .chain(([names, domains]) => {
    const parameters = Object.fromEntries(names.map((name, i) => [name, domains[i] ?? [0]]));
    return fc.record({
      strength: fc.integer({ min: 2, max: Math.min(3, names.length) }),
      parameters: fc.constant(parameters),
      constraints: fc
        .array(ruleArb(parameters), { maxLength: 2 })
        .map((rules) => rules.map((rule, i) => ({ id: `c${String(i)}`, rule }))),
    });
  });

/** A model with at least one valid configuration, plus rows drawn from its valid set. */
const scenarioArb = modelArb
  .map((model) => ({ model, valid: validAssignments(model) }))
  .filter(({ valid }) => valid.length > 0)
  .chain(({ model, valid }) =>
    fc.record({
      model: fc.constant(model),
      valid: fc.constant(valid),
      rows: fc.array(fc.constantFrom(...valid), { maxLength: 6 }),
    }),
  );

function asInput(model: ReferenceModel): unknown {
  return { schemaVersion: 1, id: 'generated', ...model };
}

function analyze(model: ReferenceModel, rows: Assignment[]): StaticAnalysis {
  return analyzeMatrix({
    model: asInput(model),
    cases: rows.map((values, i) => ({ id: `case-${String(i)}`, values })),
  });
}

function missingKeys(analysis: StaticAnalysis): Set<string> {
  return new Set(
    analysis.missing.declared.map((m) => JSON.stringify(m.parameters.map((p, i) => [p, m.values[i]]))),
  );
}

describe('exact coverage against the brute-force reference', () => {
  test('agrees on totals, covered counts, groups and missing interactions', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, rows }) => {
        const expected = referenceCoverage(model, rows);
        const actual = analyze(model, rows);
        expect(actual.metrics.declared.total).toBe(expected.total);
        expect(actual.metrics.declared.covered).toBe(expected.covered);
        expect(actual.universe.validConfigurations).toBe(expected.valid.length);
        expect(missingKeys(actual)).toEqual(expected.missing);
        for (const group of actual.groups) {
          const counts = expected.groups.get(JSON.stringify(group.parameters));
          expect([group.declared.covered, group.declared.total]).toEqual([counts?.covered, counts?.total]);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('reports an unsatisfiable model exactly when the reference finds no valid configuration', () => {
    fc.assert(
      fc.property(modelArb, (model) => {
        const satisfiable = validAssignments(model).length > 0;
        let code: string | undefined;
        try {
          analyze(model, []);
        } catch (error) {
          if (!(error instanceof NwiseKitError)) {
            throw error;
          }
          code = error.code;
        }
        expect(code).toBe(satisfiable ? undefined : 'UNSATISFIABLE_MODEL');
      }),
      { numRuns: 300 },
    );
  });
});

describe('coverage properties', () => {
  test('group totals add up to the overall counts', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, rows }) => {
        const { groups, metrics } = analyze(model, rows);
        expect(groups.reduce((sum, g) => sum + g.declared.total, 0)).toBe(metrics.declared.total);
        expect(groups.reduce((sum, g) => sum + g.declared.covered, 0)).toBe(metrics.declared.covered);
      }),
    );
  });

  test('adding a valid row never lowers coverage', () => {
    fc.assert(
      fc.property(
        scenarioArb.chain((s) => fc.record({ s: fc.constant(s), extra: fc.constantFrom(...s.valid) })),
        ({ s, extra }) => {
          const before = analyze(s.model, s.rows).metrics.declared.covered;
          const after = analyze(s.model, [...s.rows, extra]).metrics.declared.covered;
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
    );
  });

  test('row order and duplicates do not change any count', () => {
    fc.assert(
      fc.property(
        scenarioArb.chain((s) =>
          fc.record({
            s: fc.constant(s),
            reordered: fc.shuffledSubarray(s.rows, { minLength: s.rows.length, maxLength: s.rows.length }),
          }),
        ),
        ({ s, reordered }) => {
          const base = analyze(s.model, s.rows);
          const other = analyze(s.model, [...reordered, ...s.rows.slice(0, 2)]);
          expect(other.metrics).toEqual(base.metrics);
          expect(other.groups).toEqual(base.groups);
          expect(other.missing).toEqual(base.missing);
        },
      ),
    );
  });

  test('the complete valid set covers 100%', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, valid }) => {
        const { metrics, missing } = analyze(model, valid);
        expect(metrics.declared.covered).toBe(metrics.declared.total);
        expect(metrics.declared.percentage).toBe(100);
        expect(missing.declared).toEqual([]);
      }),
    );
  });

  test('gives identical results for identical inputs', () => {
    fc.assert(
      fc.property(scenarioArb, ({ model, rows }) => {
        const { durationMs: _a, ...first } = analyze(model, rows);
        const { durationMs: _b, ...second } = analyze(model, rows);
        expect(second).toEqual(first);
      }),
      { numRuns: 50 },
    );
  });
});
