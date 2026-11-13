# NwiseKit

Combinatorial coverage for the tests you already have.

NwiseKit measures which valid combinations of explicitly modelled
parameter values (roles, plans, feature flags, regions and other finite
dimensions) an existing test suite covers, lists the missing
interactions, and recommends extra configurations to close the gaps.

> **Status:** under development. Nothing has been published to npm yet.
> From a checkout of this repository, the `analyze`, `check` and `suggest`
> commands, the library and the Vitest integration work today. HTML reports
> and the npm release are being built.

## The problem

A suite can try every value of every parameter and still miss the
combinations that matter. Line and branch coverage say which code ran,
not which combinations of inputs were tried. NwiseKit answers a
different question: _of all valid pairs (or triples) of parameter
values, which ones does my suite exercise, and which are missing?_

## Background

The project grew out of the **Automated Verification Techniques** course
at the Budapest University of Technology and Economics (BME VIK). It
puts these ideas from the course's test design material into a tool:

- **A coverage metric is the share of testable elements that were
  tested.** Here the testable elements are valid interactions. It is not
  fault coverage: full coverage says the combinations were tried, not
  that the software is correct.
- **Coverage serves two purposes:** _evaluation_, measuring an existing
  suite and finding missing tests, and _selection_, designing tests to
  meet a goal. NwiseKit does both: it analyses the suite you have and
  recommends what to add, without rewriting your tests.
- **Combinatorial techniques form a ladder.** _Each option_ tries every
  value of every parameter in at least one test. _N-wise_ testing tries,
  for any `n` parameters, every combination of their values; `n = 2` is
  _pairwise_ testing. Each option can miss important combinations, which
  is why NwiseKit reports both side by side.
- **Many failures need two or more interacting parameters**, sometimes up
  to six, according to the empirical studies by Kuhn et al. Pairwise
  coverage does not guarantee finding faults that involve three or more
  parameters; strength three is supported for that reason.
- **Finding a smallest suite that covers every combination (a covering
  array) is NP-hard.** Generators such as PICT and ACTS build suites from
  scratch; NwiseKit starts from the suite you already have and uses a
  deterministic greedy heuristic to supplement it, which is not
  guaranteed to be minimal.
- **Coverage can be an exit criterion.** A coverage threshold can gate a
  CI pipeline, as statement coverage often does.

## Concepts

| Term                | Meaning                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Parameter, domain   | A named input dimension and its finite list of values.                                      |
| Constraint          | A rule that excludes impossible combinations, such as "guests are always on the free plan". |
| Valid configuration | A value for every parameter that satisfies every constraint.                                |
| Interaction         | Values for `t` distinct parameters, such as `role=guest` and `region=US`.                   |
| Strength `t`        | How many parameters an interaction combines: 2 for pairwise, 3 for three-way.               |
| Valid interaction   | One that appears in at least one valid configuration, considering all constraints at once.  |
| Coverage            | Covered valid interactions divided by all valid interactions, summed over every group.      |

Every analysis also reports a **coverage profile** from single values (each
option) up to the model strength, so you can see how coverage drops as
interactions grow.

Coverage comes in three flavours. **Declared** coverage counts the rows of
your test matrix. **Observed** coverage will count the configurations whose
test actually reached its measurement point during a run, and **passed**
coverage the ones whose final attempt also passed. Observed and passed
coverage come from a Vitest run; a static analysis reports them as
unavailable, never as zero.

## A worked example

Take three parameters `A`, `B` and `C`, each `0` or `1`, and the constraint
`A=1 implies B=1`. Six of the eight combinations are valid: `000`, `001`,
`010`, `011`, `110` and `111`. They contain 11 valid pairs: 3 for `A–B`
(`A1–B0` is impossible) and 4 each for `A–C` and `B–C`.

A suite with the rows `000` and `111` uses every value, so its single-value
coverage is 6/6. Its pairwise coverage is only 6/11 (54.55%). The missing
pairs are `A0–B1`, `A0–C1`, `A1–C0`, `B0–C1` and `B1–C0`. Adding `001`,
`010` and `110` covers them all.

More examples, including the classic OS/CPU/protocol exercise and a
discount decision table, are in [examples/](examples/).

## Modelling guide

NwiseKit does not find parameters or values in your code; you choose them.

- **Choose values by equivalence class.** One representative per class of
  inputs that should behave the same, such as `up-to-100`, `100-to-200`
  and `over-200` for an order total. Add **boundary values** as their own
  values when the edges matter, such as `100` and `100.01`.
- **Turn business rules into constraints.** A decision table or a
  cause–effect graph combines conditions with AND, OR and NOT; the same
  operators, plus implication, express which combinations are possible.
- **Keep a matrix to one behaviour.** Do not merge unrelated tests just
  because their parameters share names.

Models and matrices are JSON:

```json
{
  "schemaVersion": 1,
  "id": "order-discount",
  "strength": 2,
  "parameters": {
    "customer": ["guest", "registered"],
    "membership": ["none", "silver", "gold"],
    "orderTotal": ["up-to-100", "100-to-200", "over-200"]
  },
  "constraints": [
    {
      "id": "guests-have-no-card",
      "rule": { "implies": [{ "eq": ["customer", "guest"] }, { "eq": ["membership", "none"] }] }
    }
  ]
}
```

| Operator    | Shape                                   | Meaning                                |
| ----------- | --------------------------------------- | -------------------------------------- |
| Equality    | `{"eq": ["parameter", value]}`          | The parameter has exactly this value   |
| Negation    | `{"not": expression}`                   | NOT                                    |
| Conjunction | `{"and": [expression, ...]}`            | AND, at least two operands             |
| Disjunction | `{"or": [expression, ...]}`             | OR, at least two operands              |
| Implication | `{"implies": [expression, expression]}` | If the first holds, so does the second |

Values are strings, booleans or finite numbers, one type per parameter, and
comparison is type-strict: `true` and `"true"` are different values. A
matrix row must assign every parameter and satisfy every constraint;
invalid rows are rejected, never dropped.

## Command line

Until the package is published, build it from a checkout and run the
binary with Node.js 24:

```bash
npm ci
npm run build
node dist/cli/index.js analyze --model examples/discount/model.json --cases examples/discount/cases.json
```

`analyze` prints a summary: the model and matrix identity, declared
coverage, coverage by strength and the first missing interactions.
Observed and passed coverage show as `N/A` because they need a test run.
Add `--json report.json` to write the full report; an existing file is
only replaced with `--force`, and an input file never is.

```bash
node dist/cli/index.js analyze --model model.json --cases cases.json --json report.json
node dist/cli/index.js check --input report.json --metric declared --min-coverage 95
```

`check` recomputes every count in the report, so an edited report is
rejected, and compares exact counts with the threshold: 94,999 of 100,000
interactions fails a 95% gate. Its default metric is `observed`; for a
report from `analyze`, pass `--metric declared`. A met threshold says
nothing about whether the tests themselves passed, so keep your test
runner's exit code as a separate CI step.

`suggest` recommends configurations to add, without touching your files
or tests:

```bash
node dist/cli/index.js suggest --model model.json --cases cases.json --out suggestions.json --target 100 --max-new-cases 10
```

Each step picks the valid configuration that covers the most interactions
still missing, so the first recommendations matter most. On the worked
example above it recommends `001`, `010` and `110`, adding 2, 2 and 1 pairs.
The result is deterministic but not guaranteed to be the smallest possible
set, since finding that is NP-hard. Projected coverage is hypothetical: it
counts once you have added the cases, written their assertions and run
them. A search that stops early, at `--max-new-cases` or at the work limit,
still exits 0 and says why; add `--require-target` to make an unmet target
exit 1.

After a test run, `--basis observed --run <runtime report>` or `--basis passed`
starts from what the run actually counted. A useful configuration that is
already in the matrix is then listed as `rerun-existing`, with its case id
and how it ended in the run, instead of being added again.

| Exit code | Meaning                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| 0         | Success; any requested gate passed                                                     |
| 1         | A coverage gate, or a target required with `--require-target`, was not met             |
| 2         | Invalid arguments, model, matrix or report, an unavailable metric, unsatisfiable model |
| 3         | Incomplete analysis, a resource limit, an I/O failure or an internal error             |

Models, matrices, reports and suggestions have JSON Schemas in [schemas/](schemas/),
which editors can use for validation and completion. The tool checks more
than a schema can, such as references to unknown parameters.

## Vitest integration

Declared coverage says what your matrix _could_ cover. To know what your
tests actually exercised, bind them to the matrix and add the reporter.
Vitest 5.1 is supported; it is an optional peer dependency.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { NwiseKitReporter } from 'nwise-kit/reporter';

export default defineConfig({
  test: {
    reporters: ['default', new NwiseKitReporter({ outputDir: './nwise-kit-results' })],
  },
});
```

```ts
// checkout.test.ts
import { expect } from 'vitest';
import { createMatrixSuite } from 'nwise-kit/vitest';
import model from './model.json';
import matrix from './cases.json';

const checkout = createMatrixSuite({ model, cases: matrix.cases });

checkout.test('guest-eu-legacy', async ({ values, cover }) => {
  const result = await evaluateCheckout(values);
  cover();
  expect(result.allowed).toBe(false);
});
```

Each test is bound to one case id and receives that case's values. Call
`cover()` once the test has reached the point it measures, usually right
after the operation under test. `test.skip`, `test.todo` and
`test.concurrent` work as in Vitest, and retries use Vitest's own `retry`
option. If the reporter is missing, `createMatrixSuite` throws instead of
letting the run look measured.

After `vitest run`, the reporter writes one runtime report per matrix and a
`manifest.json` to `nwise-kit-results/<run id>/`. Each run gets its own
directory and runs are never merged. A configuration counts as:

- **observed** when its test reached `cover()` in any attempt of the run;
- **passed** when the final attempt reached `cover()` and the test passed,
  including its hooks.

A test that recovers on a retry counts and is flagged as flaky. Skipped,
todo, filtered and unregistered rows stay in the denominator. If a worker
crashes or the run is interrupted, the report is marked incomplete:
observed and passed become unavailable and `check` exits 3. The reporter
never changes Vitest's own exit code, so keep that as a separate CI step:

```bash
npx vitest run
node dist/cli/index.js check --input nwise-kit-results/<run id>/<hash>.json --metric passed --min-coverage 90
```

## Limitations

- Full pairwise coverage is not proof of correctness, and it does not
  guarantee finding faults that need three or more parameters.
- Domains must be finite and chosen by you; there is no automatic
  partitioning or boundary discovery.
- Strength is two or three. Analysis is exact and bounded: models over the
  resource limits are rejected rather than approximated.
- Generated configurations are test data. You still arrange the state,
  exercise the behaviour and write the assertions.

## References

- D. R. Kuhn et al., "Combinatorial Software Testing", _IEEE Computer_,
  42(8), 2009.
- D. R. Kuhn, R. N. Kacker and Y. Lei, _Practical Combinatorial Testing_,
  NIST Special Publication 800-142, 2010.
- NIST, [Combinatorial Coverage Measurement](https://csrc.nist.gov/Projects/automated-combinatorial-testing-for-software/combinatorial-coverage-measurement/coverage-measurement).
- Pairwise testing tools, including Microsoft PICT and NIST ACTS:
  [pairwise.org](https://www.pairwise.org/).

## Development

Requires Node.js 24.

```bash
npm ci
npm run verify
```

`verify` runs the format check, lint, type check, unit tests and build.

After cloning, enable the commit message hook and template:

```bash
git config core.hooksPath .githooks
git config commit.template .gitmessage.txt
```

## License

[MIT](LICENSE)
