import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { Manifest } from '../../src/reporter/index.js';
import { readReport } from '../../src/reports/read-report.js';
import type { RuntimeReport } from '../../src/reports/report.js';
import { run as runCli } from '../../src/cli/run.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const vitestBin = join(root, 'node_modules', 'vitest', 'vitest.mjs');

interface FixtureRun {
  readonly code: number | null;
  readonly output: string;
  readonly out: string;
}

/** Runs a fixture project with real Vitest in a child process. */
function runFixture(name: string, ...args: string[]): FixtureRun {
  const out = mkdtempSync(join(tmpdir(), `nwise-kit-${name}-`));
  const cwd = join(root, 'tests', 'integration', 'fixtures', name);
  const result = spawnSync(process.execPath, [vitestBin, 'run', '--root', '.', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NWISE_KIT_OUT: out, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}`, out };
}

function manifests(out: string): Manifest[] {
  return readdirSync(out).map(
    (dir) => JSON.parse(readFileSync(join(out, dir, 'manifest.json'), 'utf8')) as Manifest,
  );
}

function onlyReport(out: string): { path: string; report: RuntimeReport } {
  const [manifest] = manifests(out);
  const entry = manifest?.reports[0];
  if (manifest === undefined || entry === undefined) {
    throw new Error('no report written');
  }
  const path = join(out, manifest.runId, entry.report);
  return { path, report: JSON.parse(readFileSync(path, 'utf8')) as RuntimeReport };
}

function outcomes(report: RuntimeReport): Record<string, string> {
  return Object.fromEntries(
    report.evidence.tests.map((t) => [
      t.caseId,
      `${t.outcome}:${String(t.attempts)}:${t.checkpointAttempts.join(',')}`,
    ]),
  );
}

function check(path: string, ...args: string[]): number {
  return runCli(['check', '--input', path, ...args], {
    stdout: () => undefined,
    stderr: () => undefined,
    toolVersion: 'test',
  });
}

describe('the Vitest adapter and reporter in real runs', { timeout: 120_000 }, () => {
  test('record each lifecycle situation and keep Vitest failing', () => {
    const run = runFixture('lifecycle');
    expect(run.code).toBe(1);
    const { path, report } = onlyReport(run.out);
    expect(report.runtimeComplete).toBe(true);
    expect(outcomes(report)).toEqual({
      passes: 'passed:1:0',
      'fails-before': 'failed:1:',
      'fails-after': 'failed:1:0',
      skipped: 'skipped:0:',
      todo: 'todo:0:',
      'retry-recovers': 'passed:2:1',
      'first-attempt-only': 'failed:2:0',
      'late-cover': 'passed:1:',
      'teardown-fails': 'failed:1:0',
      'concurrent-a': 'passed:1:0',
      'concurrent-b': 'passed:1:0',
    });
    const late = report.evidence.tests.find((t) => t.caseId === 'late-cover');
    expect(late?.lateCheckpoints).toBe(1);
    const workers = new Set(
      report.evidence.tests.filter((t) => t.attempts > 0).map((t) => t.workerId),
    );
    expect(workers.size).toBe(2);
    expect(report.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        'FAILED_BEFORE_CHECKPOINT',
        'FAILED_AFTER_CHECKPOINT',
        'CHECKPOINT_ABSENT_IN_FINAL_ATTEMPT',
        'RETRY_RECOVERED',
        'LATE_CHECKPOINT',
        'TEST_SKIPPED',
        'TEST_TODO',
        'UNREGISTERED_CASE',
      ]),
    );
    const { declared, observed, passed } = report.metrics;
    expect(passed?.covered).toBeLessThanOrEqual(observed?.covered ?? -1);
    expect(observed?.covered).toBeLessThanOrEqual(declared.covered);

    // The written report reads back with every count recomputed, and gates work on it.
    expect(readReport(JSON.parse(readFileSync(path, 'utf8')))).toMatchObject({ kind: 'runtime' });
    expect(check(path, '--metric', 'observed', '--min-coverage', '0')).toBe(0);
  });

  test('record a name-filtered run as filtered, keeping the full denominator', () => {
    const run = runFixture('lifecycle', '-t', '^passes$');
    expect(run.code).toBe(0);
    const { report } = onlyReport(run.out);
    expect(report.filters).toEqual({ testNamePattern: '^passes$', files: [] });
    expect(report.runtimeComplete).toBe(true);
    const values = Object.values(outcomes(report));
    expect(values.filter((v) => v.startsWith('filtered'))).toHaveLength(10);
    expect(values.filter((v) => v.startsWith('passed'))).toHaveLength(1);
    expect(report.metrics.declared.covered).toBe(report.metrics.declared.total);
  });

  test('mark a run incomplete when a worker crashes, so no gate can pass', () => {
    const run = runFixture('crash');
    expect(run.code).not.toBe(0);
    const { path, report } = onlyReport(run.out);
    expect(report.runtimeComplete).toBe(false);
    expect(report.metrics.observed).toBeNull();
    expect(report.metrics.passed).toBeNull();
    expect(check(path, '--metric', 'declared', '--min-coverage', '0')).toBe(3);
  });

  test('fail loudly when the reporter is not configured', () => {
    const run = runFixture('no-reporter');
    expect(run.code).toBe(1);
    expect(run.output).toContain('The NwiseKit reporter is not configured');
    expect(readdirSync(run.out)).toEqual([]);
  });

  test('keep every run in its own directory', () => {
    const run = runFixture('lifecycle', '-t', '^passes$');
    const again = spawnSync(process.execPath, [vitestBin, 'run', '--root', '.', '-t', '^passes$'], {
      cwd: join(root, 'tests', 'integration', 'fixtures', 'lifecycle'),
      env: { ...process.env, NWISE_KIT_OUT: run.out },
    });
    expect(again.status).toBe(0);
    const runs = manifests(run.out);
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map((m) => m.runId)).size).toBe(2);
    for (const manifest of runs) {
      expect(existsSync(join(run.out, manifest.runId, manifest.reports[0]?.report ?? ''))).toBe(
        true,
      );
    }
  });
});
