import fc from 'fast-check';
import type { ReferenceModel, Rule, Value } from '../reference/brute-force.js';
import { validAssignments } from '../reference/brute-force.js';

const NAMES = ['zeta', 'alpha', 'Beta', 'é', 'm/n'];

const domainArb = fc.oneof(
  fc.integer({ min: 1, max: 3 }).map((size) => Array.from({ length: size }, (_, i): Value => i)),
  fc
    .integer({ min: 1, max: 3 })
    .map((size) => Array.from({ length: size }, (_, i): Value => `v${String(i)}`)),
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

export const modelArb: fc.Arbitrary<ReferenceModel> = fc
  .integer({ min: 2, max: 4 })
  .chain((n) =>
    fc.tuple(
      fc.shuffledSubarray(NAMES, { minLength: n, maxLength: n }),
      fc.array(domainArb, { minLength: n, maxLength: n }),
    ),
  )
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
export const scenarioArb = modelArb
  .map((model) => ({ model, valid: validAssignments(model) }))
  .filter(({ valid }) => valid.length > 0)
  .chain(({ model, valid }) =>
    fc.record({
      model: fc.constant(model),
      valid: fc.constant(valid),
      rows: fc.array(fc.constantFrom(...valid), { maxLength: 6 }),
    }),
  );

export function asInput(model: ReferenceModel): unknown {
  return { schemaVersion: 1, id: 'generated', ...model };
}
