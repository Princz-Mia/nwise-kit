# Examples

Each folder holds a model and one or more matrices of existing test cases.
The numbers below are what `analyzeMatrix` reports for them; a unit test
keeps them in sync.

Every matrix here uses each value of each parameter at least once, so its
single-value coverage is 100%. The pair column shows what each one still misses.

| Example                             | Matrix                   | Valid configurations | Single values |           Pairs |
| ----------------------------------- | ------------------------ | -------------------: | ------------: | --------------: |
| [golden](golden/)                   | `cases.json`             |               6 of 8 |           6/6 |   6/11 (54.55%) |
| [os-cpu-protocol](os-cpu-protocol/) | `cases.each-option.json` |               8 of 8 |           6/6 |   6/12 (50.00%) |
| [os-cpu-protocol](os-cpu-protocol/) | `cases.pairwise.json`    |               8 of 8 |           6/6 | 12/12 (100.00%) |
| [discount](discount/)               | `cases.json`             |             12 of 18 |           8/8 |   9/19 (47.37%) |
| [checkout](checkout/)               | `cases.json`             |             20 of 24 |           9/9 |  20/29 (68.97%) |

## golden

Three parameters `A`, `B` and `C` over `[0, 1]`, with the constraint
`A=1 implies B=1`. Six of the eight combinations are valid, giving 3 valid
`A–B` pairs and 4 each for `A–C` and `B–C`. The rows `000` and `111` cover
6 of the 11 pairs; the missing ones are `A0–B1`, `A0–C1`, `A1–C0`,
`B0–C1` and `B1–C0`. Small enough to check by hand.

## os-cpu-protocol

The textbook pairwise exercise: three two-valued parameters, eight
combinations in total. Two tests are enough to try every value once, but
they cover only half of the pairs. Four well-chosen tests cover all 12
pairs, half of the eight tests exhaustive testing would need.

## discount

An order discount defined by a decision table: a membership card (none,
silver or gold) gives a global discount, and the order total gives a
second one above 100 and above 200. The order total is modelled by its
equivalence classes, and the decision table's rule that guests cannot
hold a card becomes a constraint. Three tests, one per discount level,
look complete but cover fewer than half of the valid pairs: no
registered customer without a card, no small order with a card, and no
guest with a larger order.

## checkout

Access to a checkout flow by role, plan, feature flag and region, where
guests are always on the free plan. Four tests cover 20 of the 29 valid
pairs; the gaps include every `US` pair with `guest` or `admin`.

## Running them

The command-line interface is not available yet. From a checkout of this
repository the library can analyse an example directly:

```ts
import { readFileSync } from 'node:fs';
import { analyzeMatrix, parseJson } from './src/index.js';

const model = parseJson(readFileSync('examples/discount/model.json', 'utf8'));
const matrix = parseJson(readFileSync('examples/discount/cases.json', 'utf8')) as {
  cases: unknown;
};
const analysis = analyzeMatrix({ model, cases: matrix.cases });
console.log(analysis.profile, analysis.missing.declared);
```
