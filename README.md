# NwiseKit

Combinatorial coverage for the tests you already have.

NwiseKit measures which valid combinations of explicitly modelled
parameter values (roles, plans, feature flags, regions and other finite
dimensions) an existing test suite covers, lists the missing
interactions, and recommends extra configurations to close the gaps.

> **Status:** under development. Nothing has been published to npm yet.
> From a checkout of this repository, every command (`analyze`, `check`,
> `suggest`, `report`), the library and the Vitest integration work today.
> The npm release is being prepared.

## The problem

A suite can try every value of every parameter and still miss the
combinations that matter. Line and branch coverage say which code ran,
not which combinations of inputs were tried. NwiseKit answers a
different question: _of all valid pairs (or triples, or combinations of
any number of parameters) of parameter values, which ones does my suite
exercise, and which are missing?_

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
  parameters, so the strength is yours to choose: from one up to the
  number of parameters, where every valid configuration must be tested.
- **Finding a smallest suite that covers every combination (a covering
  array) is NP-hard.** Generators such as PICT and ACTS build suites from
  scratch. NwiseKit can do that too, but it starts from the suite you
  already have when there is one, and uses a deterministic greedy
  heuristic to supplement it, which is not guaranteed to be minimal.
- **Coverage can be an exit criterion.** A coverage threshold can gate a
  CI pipeline, as statement coverage often does.

## Concepts

| Term                | Meaning                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Parameter, domain   | A named input dimension and its finite list of values.                                                            |
| Constraint          | A rule that excludes impossible combinations, such as "guests are always on the free plan".                       |
| Valid configuration | A value for every parameter that satisfies every constraint.                                                      |
| Interaction         | Values for `t` distinct parameters, such as `role=guest` and `region=US`.                                         |
| Strength `t`        | How many parameters an interaction combines: 1 for single values, 2 for pairwise, up to the number of parameters. |
| Valid interaction   | One that appears in at least one valid configuration, considering all constraints at once.                        |
| Coverage            | Covered valid interactions divided by all valid interactions, summed over every group.                            |

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
binary with Node.js 22.13 or later:

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

`generate` writes the test cases themselves: a matrix that covers every
valid interaction of the model strength, ready for `analyze` or the
Vitest integration.

```bash
node dist/cli/index.js generate --model examples/os-cpu-protocol/model.json --out cases.json
```

For that model it writes four test cases that cover all 12 pairs, where
testing every combination would need eight. The strength in the model
decides how thorough the suite is: at 1 every value appears in some test
(two cases here), and at the number of parameters every valid
configuration is a test (eight here). With `--cases` it keeps your
existing cases and adds only what they miss. New cases are named
`suggested-001`, `suggested-002` and so on; they are configurations, so
the assertions are still yours to write. It adds as many cases as the
target needs unless you pass `--max-new-cases`, and exits 1 if the matrix
it wrote falls short of `--target`.

`suggest` can write the same matrix next to its recommendations with
`--matrix-out <file>`, and builds a suite from scratch when `--cases` is
left out.

After a test run, `--basis observed --run <runtime report>` or `--basis passed`
starts from what the run actually counted. A useful configuration that is
already in the matrix is then listed as `rerun-existing`, with its case id
and how it ended in the run, instead of being added again.

`report` turns a static or runtime report into one self-contained HTML
page that opens offline and makes no network requests:

```bash
node dist/cli/index.js report --input report.json --html report.html --suggestions suggestions.json
```

The page shows every metric and its completeness, coverage by strength and
by parameter group, a searchable list of missing interactions, the cases
(and their outcome in the run) that contain any combination of values you
pick, diagnostics, and, with `--suggestions`, the projected recommendations.
Very long lists are cut short on the page with a notice; the exact counts
and the JSON report stay complete.

| Exit code | Meaning                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| 0         | Success; any requested gate passed                                                            |
| 1         | A coverage gate, a target required with `--require-target` or a `generate` target was not met |
| 2         | Invalid arguments, model, matrix or report, an unavailable metric, unsatisfiable model        |
| 3         | Incomplete analysis, a resource limit, an I/O failure or an internal error                    |

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

## Compatibility

- **Any application.** The command line and the library work on JSON files
  that describe your parameters and test cases, so they do not depend on
  what you build: React, Vue, Angular or Svelte front ends, APIs and
  services are all the same to them.
- **JavaScript and TypeScript.** The package ships compiled JavaScript with
  type declarations. It is an ES module; CommonJS code can also
  `require('nwise-kit')` on the supported Node.js versions.
- **Node.js** 22.13 or later (the 22, 24 and 26 lines).
- **Package managers.** Installing the packed archive is tested with npm on
  every change, and was checked by hand with pnpm, Yarn 1 and Yarn 4 (with
  `nodeLinker: node-modules`). `npx nwise-kit` runs the command line without
  installing it.
- **Test runners.** Declared coverage, recommendations and reports work
  with any runner, since they only read your matrix. Observed and passed
  coverage need Vitest 5.1. That was checked with React and Vue component
  tests in a DOM environment; Angular's Vitest setup, Vitest's browser and
  watch modes, Jest, Mocha and Playwright are not supported for runtime
  coverage.

## Library

Everything the command line does is available as functions. They are
synchronous, do no file or network access, and throw a `NwiseKitError`
with a `code` and path-specific `diagnostics` for invalid input.

```ts
import { analyzeMatrix, suggestCases } from 'nwise-kit';

const analysis = analyzeMatrix({ model, cases: matrix.cases });
console.log(analysis.metrics.declared, analysis.missing.declared);

const suggestions = suggestCases({
  model,
  cases: matrix.cases,
  targetCoverage: 100,
  maxNewCases: 10,
});
```

| Function                                    | What it does                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `analyzeMatrix`                             | Exact declared coverage, missing interactions and the coverage profile |
| `analyzeRun`                                | Declared, observed and passed coverage from a test run's evidence      |
| `suggestCases`                              | Recommendations from declared, observed or passed coverage             |
| `matrixWithSuggestions`                     | The existing cases plus the recommended new ones, as a matrix          |
| `createStaticReport`, `createRuntimeReport` | Versioned reports that embed their inputs                              |
| `readReport`                                | Reads a report and recomputes every count, rejecting edited ones       |
| `checkCoverage`                             | Compares one metric of a report with a threshold, exactly              |
| `parseJson`                                 | `JSON.parse` that rejects duplicate keys                               |
| `validateModel`, `validateMatrix`           | Validation on its own, with every problem reported                     |
| `createMatrixSuite` (`nwise-kit/vitest`)    | Binds Vitest tests to matrix cases                                     |
| `NwiseKitReporter` (`nwise-kit/reporter`)   | Writes runtime reports during a Vitest run                             |

All options and result types are exported and documented in the type
declarations.

## Performance

Analysis is exact, so its cost grows with the size of the model. On the
reference machine, ten three-valued parameters with 1,000 rows take about
31 ms at strength two, 84 ms at strength three and 194 ms at strength four. The method, all
scenarios and the measured numbers are in [benchmarks/](benchmarks/);
`npm run bench` reruns them on your machine.

## Security

- The package has no runtime dependencies, makes no network requests and
  collects no telemetry. Nothing runs when it is installed.
- The command line reads only the files you name and writes only the
  outputs you name: atomically, never over an input, and over an existing
  file only with `--force`.
- Input is treated as untrusted. Models, matrices and reports are validated
  strictly, analysis is bounded by explicit limits, and reading a report
  recomputes its counts instead of trusting them, with a ceiling on the
  resources a report may ask for.
- Values from your files are shown as data: escaped in HTML pages, which
  also block all network access, and with control characters neutralised
  in terminal output.

Please report a suspected vulnerability privately to the maintainer rather
than in a public issue.

## Limitations

- Full pairwise coverage is not proof of correctness, and it does not
  guarantee finding faults that need three or more parameters.
- Domains must be finite and chosen by you; there is no automatic
  partitioning or boundary discovery.
- Strength is any whole number from one (every value) to the number of
  parameters (every valid configuration); every interaction in a model has
  the same strength. Higher strengths grow quickly, so large models may
  exceed the limits. The strengths up to the chosen one may span at most
  131,072 parameter groups, a bound first passed by full strength over 18
  parameters or strength 7 over 20.
- Analysis is exact and bounded: models over the
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

Requires Node.js 22.13 or later; CI tests the 22, 24 and 26 release lines.

```bash
npm ci
npm run verify
```

`verify` runs the format check, lint, type check, unit tests, integration
tests (the built CLI and real Vitest runs) and the build. To check the
package as users would install it, in fresh projects with and without
Vitest:

```bash
npm run package:check
```

After cloning, enable the commit message hook and template:

```bash
git config core.hooksPath .githooks
git config commit.template .gitmessage.txt
```

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
