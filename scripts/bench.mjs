// Reproducible benchmarks of the built package. Each scenario runs in its
// own Node process: two warm-up runs, then the measured runs, reporting
// the duration of each and the peak resident memory of the process.
//
//   npm run bench                 run every scenario, print a Markdown table
//   npm run bench -- --json f     also write the raw numbers to a file
//   npm run bench -- --runs 20    measured runs per scenario (default 10)
//
// Inputs are generated from fixed seeds, so every machine measures the
// same models and rows.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem, type } from 'node:os';
import { fileURLToPath } from 'node:url';

const WARM_UP = 2;
const self = fileURLToPath(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** A small seeded generator (mulberry32), so inputs never depend on Math.random. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function model(id, strength, parameterCount, domainSize, constraints = []) {
  const parameters = Object.fromEntries(
    Array.from({ length: parameterCount }, (_, i) => [
      `p${String(i).padStart(2, '0')}`,
      Array.from({ length: domainSize }, (_, v) => v),
    ]),
  );
  return { schemaVersion: 1, id, strength, parameters, constraints };
}

const implies = (id, [a, av], [b, bv]) => ({
  id,
  rule: { implies: [{ eq: [a, av] }, { eq: [b, bv] }] },
});

/** `count` rows drawn with a fixed seed; `repair` makes a row satisfy the constraints. */
function rows(m, count, seed, repair = (row) => row, duplicates = 0) {
  const next = random(seed);
  const names = Object.keys(m.parameters);
  const cases = [];
  for (let i = 0; i < count - duplicates; i++) {
    const values = Object.fromEntries(
      names.map((name) => [name, Math.floor(next() * m.parameters[name].length)]),
    );
    cases.push({ id: `case-${String(i)}`, values: repair(values) });
  }
  for (let i = 0; i < duplicates; i++) {
    cases.push({ id: `duplicate-${String(i)}`, values: cases[i].values });
  }
  return cases;
}

const chain = [
  implies('p00-2-needs-p01-0', ['p00', 2], ['p01', 0]),
  implies('p02-1-needs-p03-1', ['p02', 1], ['p03', 1]),
  implies('p04-0-needs-p05-2', ['p04', 0], ['p05', 2]),
];
const repairChain = (row) => ({
  ...row,
  ...(row.p00 === 2 ? { p01: 0 } : {}),
  ...(row.p02 === 1 ? { p03: 1 } : {}),
  ...(row.p04 === 0 ? { p05: 2 } : {}),
});
const pinned = [
  { id: 'p00-is-0', rule: { eq: ['p00', 0] } },
  { id: 'p01-is-0', rule: { eq: ['p01', 0] } },
];

/** name → { description, build(): { run(kit) } } */
const SCENARIOS = {
  'pairwise-10x3': {
    description: '10 parameters x 3 values, strength 2, 1,000 rows (the stated target)',
    build() {
      const m = model('pairwise-10x3', 2, 10, 3);
      const cases = rows(m, 1000, 1);
      return (kit) => kit.analyzeMatrix({ model: m, cases });
    },
  },
  'pairwise-10x3-constrained': {
    description: '10 x 3, strength 2, three implications, 1,000 rows of which 100 are duplicates',
    build() {
      const m = model('pairwise-10x3-constrained', 2, 10, 3, chain);
      const cases = rows(m, 1000, 2, repairChain, 100);
      return (kit) => kit.analyzeMatrix({ model: m, cases });
    },
  },
  'threeway-10x3': {
    description: '10 x 3, strength 3, 1,000 rows',
    build() {
      const m = model('threeway-10x3', 3, 10, 3);
      const cases = rows(m, 1000, 3);
      return (kit) => kit.analyzeMatrix({ model: m, cases });
    },
  },
  'near-limit-12x3': {
    description:
      '12 x 3, strength 2, 531,441 raw and 59,049 valid configurations (two parameters pinned), 1,000 rows',
    build() {
      const m = model('near-limit-12x3', 2, 12, 3, pinned);
      const cases = rows(m, 1000, 4, (row) => ({ ...row, p00: 0, p01: 0 }));
      return (kit) => kit.analyzeMatrix({ model: m, cases });
    },
  },
  'threeway-16x2': {
    description:
      '16 parameters x 2 values, strength 3, 65,536 valid configurations in 696 parameter groups, 1,000 rows',
    build() {
      const m = model('threeway-16x2', 3, 16, 2);
      const cases = rows(m, 1000, 7);
      return (kit) => kit.analyzeMatrix({ model: m, cases });
    },
  },
  'suggest-10x3': {
    description: '10 x 3, strength 2, suggestions from 20 rows to 100% (up to 50 cases)',
    build() {
      const m = model('suggest-10x3', 2, 10, 3);
      const cases = rows(m, 20, 5);
      return (kit) => kit.suggestCases({ model: m, cases, targetCoverage: 100, maxNewCases: 50 });
    },
  },
  'report-roundtrip-10x3': {
    description: '10 x 3, strength 2, 1,000 rows: build a report, serialise it and read it back',
    build() {
      const m = model('report-roundtrip-10x3', 2, 10, 3);
      const matrix = { schemaVersion: 1, modelId: m.id, cases: rows(m, 1000, 6) };
      return (kit) => {
        const report = kit.createStaticReport({ model: m, matrix, toolVersion: 'bench' });
        return kit.readReport(kit.parseJson(kit.formatReport(report)));
      };
    },
  },
};

async function child(name, runs) {
  const kit = await import('../dist/index.js');
  const run = SCENARIOS[name].build();
  for (let i = 0; i < WARM_UP; i++) {
    run(kit);
  }
  const durations = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    run(kit);
    durations.push(performance.now() - started);
  }
  // maxRSS is in kilobytes.
  process.stdout.write(
    JSON.stringify({ durations, peakRssMiB: process.resourceUsage().maxRSS / 1024 }),
  );
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function main() {
  const runs = Number(option('--runs', '10'));
  const only = option('--only', undefined);
  const machine = {
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    logicalCores: cpus().length,
    ramGiB: Math.round(totalmem() / 2 ** 30),
    os: `${type()} ${release()}`,
    node: process.version,
    package: `${manifest.name} ${manifest.version}`,
  };
  const results = [];
  for (const name of Object.keys(SCENARIOS).filter((n) => only === undefined || n === only)) {
    const result = spawnSync(process.execPath, [self, '--child', name, '--runs', String(runs)], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      console.error(result.stderr);
      throw new Error(`scenario ${name} failed`);
    }
    const { durations, peakRssMiB } = JSON.parse(result.stdout);
    const sorted = [...durations].sort((a, b) => a - b);
    results.push({
      name,
      description: SCENARIOS[name].description,
      runs,
      medianMs: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted.at(-1),
      peakRssMiB,
    });
  }
  console.log(
    `Machine: ${machine.cpu}, ${String(machine.logicalCores)} logical cores, ${String(machine.ramGiB)} GiB RAM`,
  );
  console.log(`System: ${machine.os}, Node.js ${machine.node}, ${machine.package}`);
  console.log(
    `Policy: ${String(WARM_UP)} warm-up runs, then ${String(runs)} measured runs, one process per scenario\n`,
  );
  console.log('| Scenario | Median (ms) | p95 (ms) | Max (ms) | Peak RSS (MiB) |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.medianMs.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.maxMs.toFixed(1)} | ${r.peakRssMiB.toFixed(0)} |`,
    );
  }
  const json = option('--json', undefined);
  if (json !== undefined) {
    writeFileSync(json, `${JSON.stringify({ machine, warmUp: WARM_UP, results }, null, 2)}\n`);
  }
}

const childName = option('--child', undefined);
if (childName === undefined) {
  main();
} else {
  await child(childName, Number(option('--runs', '10')));
}
