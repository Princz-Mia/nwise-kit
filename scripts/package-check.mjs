// Checks the package as consumers receive it. Without arguments it builds,
// packs to a temporary directory and tests that tarball; with
// `--tarball <path>` it tests an existing archive without repacking.
//
// 1. The archive contains every exported, typed and binary target and
//    nothing private (sources, tests, local notes, secrets).
// 2. A fresh project without Vitest installs it, imports the core and
//    runs the CLI.
// 3. A fresh project with the supported Vitest installs it, type-checks a
//    matrix test and its config, runs Vitest and gets a runtime report.
//
// The consumer projects live outside the repository, so nothing resolves
// through workspace links or the repository's node_modules.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const devVersion = (name) => manifest.devDependencies[name];
// npm is a script, not an executable, on Windows; run its CLI with Node instead of a shell.
const npmCli = [
  process.env['npm_execpath'],
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find((path) => path !== undefined && path.endsWith('.js') && existsSync(path));

function run(command, args, cwd, { allowFailure = false } = {}) {
  const shown = `${command} ${args.join(' ')}`;
  const [file, argv] =
    command === 'npm'
      ? [process.execPath, [npmCli ?? fail('cannot find the npm CLI'), ...args]]
      : [command, args];
  const result = spawnSync(file, argv, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    console.error(result.stdout, result.stderr);
    throw new Error(`"${shown}" failed with exit code ${String(result.status)}`);
  }
  return result;
}

function step(message) {
  console.log(`package:check: ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function tarballFromArgs() {
  const index = process.argv.indexOf('--tarball');
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined) {
    fail('--tarball needs a path');
  }
  return resolve(value);
}

function pack(work) {
  step('building');
  run(process.execPath, [join(root, 'scripts', 'build.mjs')], root);
  step('packing');
  const result = run('npm', ['pack', '--json', '--pack-destination', work], root);
  const [info] = JSON.parse(result.stdout);
  return join(work, info.filename);
}

/**
 * Reads a gzipped tar archive into a map of entry name to contents, so the
 * check does not depend on which tar program the platform provides.
 */
function readTarball(tarball) {
  const data = gunzipSync(readFileSync(tarball));
  const entries = new Map();
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const field = (start, length) => {
      const raw = header.subarray(start, start + length);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
    };
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    if (type === '0' || type === '') {
      entries.set(name, data.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function inspect(tarball) {
  step(`inspecting ${basename(tarball)}`);
  const entries = readTarball(tarball);
  const read = (name) =>
    entries.get(`package/${name}`)?.toString('utf8') ?? fail(`the archive lacks ${name}`);
  const listing = [...entries.keys()].map((name) => name.replace(/^package\//, ''));
  const files = new Set(listing);
  const packed = JSON.parse(read('package.json'));

  const targets = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);
  const add = (value) => {
    if (typeof value === 'string') {
      targets.add(value.replace(/^\.\//, ''));
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(add);
    }
  };
  add(packed.exports);
  add(packed.bin);
  add(packed.types);
  for (const schema of readdirSync(join(root, 'schemas'))) {
    targets.add(`schemas/${schema}`);
  }
  const missing = [...targets].filter((target) => !files.has(target));
  if (missing.length > 0) {
    fail(`the archive lacks: ${missing.join(', ')}`);
  }

  // Only these may ship; anything else (sources, tests, notes, secrets) is a leak.
  const allowedRoots = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);
  const forbidden = listing.filter(
    (file) =>
      !(allowedRoots.has(file) || /^(dist|schemas)\//.test(file)) ||
      /(^|\/)\.[^/]+/.test(file) ||
      /\.(tgz|test\.[cm]?[jt]s|tsbuildinfo|map)$/.test(file),
  );
  if (forbidden.length > 0) {
    fail(`the archive contains files that should not ship: ${forbidden.join(', ')}`);
  }
  const hooks = ['preinstall', 'install', 'postinstall', 'prepare'].filter(
    (hook) => packed.scripts?.[hook] !== undefined,
  );
  if (hooks.length > 0) {
    fail(`the package runs install hooks: ${hooks.join(', ')}`);
  }
  const bin = read(packed.bin['nwise-kit'].replace(/^\.\//, ''));
  if (!bin.startsWith('#!/usr/bin/env node')) {
    fail('the CLI entry has no Node shebang');
  }
  step(`archive has ${String(listing.length)} files, all targets present, nothing private`);
}

function consumer(work, name, dependencies) {
  const dir = join(work, name);
  cpSync(join(root, 'examples', 'golden'), join(dir, 'golden'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name, private: true, type: 'module' }, null, 2)}\n`,
  );
  step(`installing into a fresh project (${name})`);
  run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', ...dependencies], dir);
  return dir;
}

function checkCore(work, tarball) {
  const dir = consumer(work, 'core-consumer', [tarball]);
  writeFileSync(
    join(dir, 'check.mjs'),
    `import { readFileSync } from 'node:fs';
import { analyzeMatrix, parseJson } from 'nwise-kit';
const model = parseJson(readFileSync('golden/model.json', 'utf8'));
const matrix = parseJson(readFileSync('golden/cases.json', 'utf8'));
const { metrics } = analyzeMatrix({ model, cases: matrix.cases });
if (metrics.declared.covered !== 6 || metrics.declared.total !== 11 || metrics.observed !== null) {
  throw new Error('unexpected coverage ' + JSON.stringify(metrics));
}
try {
  await import('nwise-kit/vitest');
  throw new Error('nwise-kit/vitest loaded without Vitest');
} catch (error) {
  if (!String(error.message).includes('npm install --save-dev vitest')) throw error;
}
console.log('core ok');
`,
  );
  run(process.execPath, ['check.mjs'], dir);
  const version = run('npm', ['exec', '--no', '--', 'nwise-kit', '--version'], dir).stdout.trim();
  if (version !== manifest.version) {
    fail(`nwise-kit --version printed "${version}", expected "${manifest.version}"`);
  }
  const analyzed = run(
    'npm',
    [
      'exec',
      '--no',
      '--',
      'nwise-kit',
      'analyze',
      '--model',
      'golden/model.json',
      '--cases',
      'golden/cases.json',
      '--json',
      'report.json',
    ],
    dir,
  );
  if (!analyzed.stdout.includes('declared  6/11')) {
    fail('the installed CLI printed an unexpected summary');
  }
  const gate = run(
    'npm',
    [
      'exec',
      '--no',
      '--',
      'nwise-kit',
      'check',
      '--input',
      'report.json',
      '--metric',
      'declared',
      '--min-coverage',
      '60',
    ],
    dir,
    { allowFailure: true },
  );
  if (gate.status !== 1) {
    fail(`check should exit 1 below the threshold, got ${String(gate.status)}`);
  }
  step('core and CLI work without Vitest');
}

function checkVitest(work, tarball) {
  const dir = consumer(work, 'vitest-consumer', [
    tarball,
    `vitest@${devVersion('vitest')}`,
    `typescript@${devVersion('typescript')}`,
    `@types/node@${devVersion('@types/node')}`,
  ]);
  writeFileSync(
    join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2024',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          resolveJsonModule: true,
          skipLibCheck: false,
          types: ['node'],
        },
        include: ['*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config';
import { NwiseKitReporter } from 'nwise-kit/reporter';

export default defineConfig({
  test: { include: ['*.test.ts'], reporters: ['default', new NwiseKitReporter()] },
});
`,
  );
  writeFileSync(
    join(dir, 'golden.test.ts'),
    `import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { createMatrixSuite } from 'nwise-kit/vitest';

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const matrix = read('golden/cases.json') as { cases: unknown };
const golden = createMatrixSuite({ model: read('golden/model.json'), cases: matrix.cases });

golden.test('all-zero', ({ values, cover }) => {
  cover();
  expect(values['A']).toBe(0);
});
golden.test('all-one', ({ cover }) => {
  cover();
  expect(1).toBe(2);
});
`,
  );
  step('type-checking the consumer project');
  run('npm', ['exec', '--no', '--', 'tsc', '-p', '.'], dir);
  step('running Vitest in the consumer project');
  const vitest = run('npm', ['exec', '--no', '--', 'vitest', 'run'], dir, { allowFailure: true });
  if (vitest.status !== 1) {
    fail(
      `Vitest should keep its own exit code 1 for the failing test, got ${String(vitest.status)}`,
    );
  }
  const results = join(dir, 'nwise-kit-results');
  const [runId] = readdirSync(results);
  const runManifest = JSON.parse(readFileSync(join(results, runId, 'manifest.json'), 'utf8'));
  const [entry] = runManifest.reports;
  const report = JSON.parse(readFileSync(join(results, runId, entry.report), 'utf8'));
  const { observed, passed } = report.metrics;
  if (!report.runtimeComplete || observed.covered !== 6 || passed.covered !== 3) {
    fail(`unexpected runtime coverage ${JSON.stringify(report.metrics)}`);
  }
  step('the Vitest adapter and reporter work from the installed package');
}

const work = mkdtempSync(join(tmpdir(), 'nwise-kit-package-'));
try {
  const tarball = tarballFromArgs() ?? pack(work);
  inspect(tarball);
  checkCore(work, tarball);
  checkVitest(work, tarball);
  step('passed');
} catch (error) {
  console.error(`package:check: FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
