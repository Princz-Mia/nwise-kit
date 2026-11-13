# Benchmarks

Measured numbers for the exact analysis and the recommendation search. They
describe one machine; rerun them on yours before relying on them.

## Method

```bash
npm run bench
```

The script builds the package and runs each scenario in its own Node.js
process: two warm-up runs, then ten measured runs. It reports the median,
the 95th percentile and the slowest run, and the peak resident memory of
the process across all twelve runs. Models and rows are generated from
fixed seeds, so every machine measures the same inputs. `--runs <n>`
changes the number of measured runs, `--only <scenario>` runs one, and
`--json <file>` also writes the raw numbers.

## Target

Analysing ten three-valued parameters at strength two with 1,000 valid rows
should take at most five seconds at the median and stay below 256 MiB of
peak memory. The `pairwise-10x3` scenario measures exactly that.

## Results

Machine: AMD Ryzen 7 7800X3D (16 logical cores), 31 GiB RAM, Windows 11
(10.0.26200), Node.js 24.22.2, nwise-kit 0.0.0, 13 November 2026.

| Scenario                  | What it measures                                                                            | Median (ms) | p95 (ms) | Peak RSS (MiB) |
| ------------------------- | ------------------------------------------------------------------------------------------- | ----------: | -------: | -------------: |
| pairwise-10x3             | 10 parameters x 3 values, strength 2, 1,000 rows (the target)                               |        31.2 |     35.4 |            148 |
| pairwise-10x3-constrained | The same with three implications; 100 of the 1,000 rows are duplicates                      |        18.4 |     19.7 |            112 |
| threeway-10x3             | 10 x 3 at strength 3, 1,000 rows                                                            |        83.7 |     90.0 |            150 |
| fourway-10x3              | 10 x 3 at strength 4: 385 parameter groups across the four levels, 1,000 rows               |       193.9 |    205.5 |            134 |
| near-limit-12x3           | 12 x 3, strength 2: 531,441 raw and 59,049 valid configurations, 1,000 rows                 |        44.6 |     48.4 |            148 |
| threeway-16x2             | 16 x 2 at strength 3: 65,536 valid configurations in 696 parameter groups, 1,000 rows       |       339.1 |    415.7 |            157 |
| suggest-10x3              | Recommendations for 10 x 3 from 20 rows up to 100% pairwise coverage (at most 50 cases)     |       153.9 |    164.7 |            171 |
| report-roundtrip-10x3     | Build a report for 10 x 3 with 1,000 rows, serialise it and read it back with recomputation |        82.4 |     93.5 |            247 |

The target is met with a wide margin: 31 ms against 5 seconds, and 148 MiB
against 256 MiB.

## Reading the numbers

- Time grows with the number of valid configurations times the number of
  parameter groups, which is why `threeway-16x2` is the slowest analysis
  here. The default limits (a million raw configurations, 100,000 valid
  ones, 30 seconds) bound the worst case.
- Peak memory includes the Node.js runtime itself and garbage from all
  twelve runs in the process, so it overstates what a single analysis
  needs.
- Recommendation time is reported separately from analysis time. It is
  bounded by the work budget (20 million membership checks by default)
  rather than by the clock.
- These are measurements of synthetic models on one machine. They are not
  a promise for other hardware or for models of a different shape.
