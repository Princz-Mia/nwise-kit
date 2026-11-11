import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { exampleDir, runCli } from './helpers.js';

let dir: string;
let report: string;

beforeEach(() => {
  dir = exampleDir('golden', ['model.json', 'cases.json']);
  report = join(dir, 'report.json');
  const analysed = runCli(
    'analyze',
    '--model',
    join(dir, 'model.json'),
    '--cases',
    join(dir, 'cases.json'),
    '--json',
    report,
  );
  expect(analysed.code).toBe(0);
});

describe('nwise-kit check', () => {
  test('exits 0 when declared coverage meets the threshold', () => {
    const result = runCli(
      'check',
      '--input',
      report,
      '--metric',
      'declared',
      '--min-coverage',
      '54.545',
    );
    expect(result).toEqual({
      code: 0,
      stdout: 'PASS: declared coverage 6/11 (54.545%) meets the 54.545% threshold\n',
      stderr: '',
    });
  });

  test('exits 1 when it does not', () => {
    const result = runCli(
      'check',
      '--input',
      report,
      '--metric',
      'declared',
      '--min-coverage',
      '54.546',
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      'FAIL: declared coverage 6/11 (54.545%) is below the 54.546% threshold\n',
    );
  });

  test('exits 2 for the default observed metric on a static report, saying what to do', () => {
    const result = runCli('check', '--input', report, '--min-coverage', '95');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('METRIC_UNAVAILABLE');
    expect(result.stderr).toContain('--metric declared');
    expect(result.stdout).toBe('');
  });

  test('exits 2 for an edited report', () => {
    const stored = JSON.parse(readFileSync(report, 'utf8')) as {
      metrics: { declared: { covered: number } };
    };
    stored.metrics.declared.covered = 11;
    writeFileSync(report, JSON.stringify(stored));
    const result = runCli(
      'check',
      '--input',
      report,
      '--metric',
      'declared',
      '--min-coverage',
      '50',
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`INVALID_REPORT: ${report}:`);
    expect(result.stderr).toContain('REPORT_INCONSISTENT: /metrics');
  });

  test('exits 2 for an unsupported report version', () => {
    const stored = JSON.parse(readFileSync(report, 'utf8')) as { schemaVersion: number };
    stored.schemaVersion = 2;
    writeFileSync(report, JSON.stringify(stored));
    const result = runCli(
      'check',
      '--input',
      report,
      '--metric',
      'declared',
      '--min-coverage',
      '50',
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('UNSUPPORTED_SCHEMA_VERSION');
  });

  test.each([
    [['--input', 'r.json'], 'Missing --min-coverage'],
    [['--min-coverage', '95'], 'Missing --input'],
    [['--input', 'r.json', '--min-coverage', '101'], 'Invalid coverage threshold "101"'],
    [['--input', 'r.json', '--min-coverage', '95.1234'], 'Invalid coverage threshold'],
    [['--input', 'r.json', '--min-coverage', '95', '--metric', 'lines'], 'Unknown metric "lines"'],
  ])('rejects arguments %j with exit 2 before reading files', (args, message) => {
    const result = runCli('check', ...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  test('exits 3 when the report cannot be read', () => {
    const result = runCli(
      'check',
      '--input',
      join(dir, 'absent.json'),
      '--metric',
      'declared',
      '--min-coverage',
      '50',
    );
    expect(result.code).toBe(3);
  });

  test('shows help and exits 0', () => {
    const result = runCli('check', '--help');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: nwise-kit check');
  });
});
