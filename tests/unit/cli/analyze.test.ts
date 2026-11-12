import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { parseJson } from '../../../src/model/json.js';
import { readReport } from '../../../src/reports/read-report.js';
import { exampleDir, runCli } from './helpers.js';

let dir: string;
let model: string;
let cases: string;
let report: string;

beforeEach(() => {
  dir = exampleDir('golden', ['model.json', 'cases.json']);
  model = join(dir, 'model.json');
  cases = join(dir, 'cases.json');
  report = join(dir, 'report.json');
});

describe('nwise-kit analyze', () => {
  test('prints the summary on stdout and exits 0', () => {
    const result = runCli('analyze', '--model', model, '--cases', cases);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('  declared  6/11 (54.55%)');
    expect(result.stdout).toContain('  observed  N/A');
    expect(result.stdout).toContain('Missing pairs (5):');
    expect(result.stderr).toBe('');
  });

  test('writes a JSON report that reads back intact', () => {
    const result = runCli('analyze', '--model', model, '--cases', cases, '--json', report);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Report written to ${report}`);
    const written = readReport(parseJson(readFileSync(report, 'utf8')));
    expect(written.toolVersion).toBe('9.9.9-test');
    expect(written.metrics.declared).toMatchObject({ covered: 6, total: 11 });
  });

  test('prints warnings on stderr', () => {
    writeFileSync(
      cases,
      JSON.stringify({
        schemaVersion: 1,
        modelId: 'golden',
        cases: [
          { id: 'a', values: { A: 0, B: 0, C: 0 } },
          { id: 'b', values: { A: 0, B: 0, C: 0 } },
        ],
      }),
    );
    const result = runCli('analyze', '--model', model, '--cases', cases);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('warning REDUNDANT_CONFIGURATION');
  });

  test('refuses to replace an existing report without --force', () => {
    writeFileSync(report, 'keep');
    const result = runCli('analyze', '--model', model, '--cases', cases, '--json', report);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('already exists');
    expect(result.stdout).toBe('');
    expect(readFileSync(report, 'utf8')).toBe('keep');
  });

  test('replaces an existing report with --force', () => {
    writeFileSync(report, 'old');
    const result = runCli(
      'analyze',
      '--model',
      model,
      '--cases',
      cases,
      '--json',
      report,
      '--force',
    );
    expect(result.code).toBe(0);
    expect(readFileSync(report, 'utf8')).toContain('"schemaVersion": 1');
  });

  test('never writes over an input, even with --force', () => {
    const before = readFileSync(cases, 'utf8');
    const result = runCli(
      'analyze',
      '--model',
      model,
      '--cases',
      cases,
      '--json',
      cases,
      '--force',
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('OUTPUT_IS_INPUT');
    expect(readFileSync(cases, 'utf8')).toBe(before);
  });

  test.each([
    [['--model', 'm.json'], 'Missing --cases'],
    [['--model', 'm.json', '--cases', 'c.json', '--bogus'], "Unknown option '--bogus'"],
    [['--model', 'a.json', '--model', 'b.json', '--cases', 'c.json'], 'given more than once'],
    [['--model'], "Option '--model <value>' argument missing"],
    [['extra'], 'positional argument'],
  ])('rejects arguments %j with exit 2', (args, message) => {
    const result = runCli('analyze', ...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  test('names the file and path of an invalid model', () => {
    writeFileSync(
      model,
      JSON.stringify({
        schemaVersion: 1,
        id: 'golden',
        strength: 2,
        parameters: { A: [], B: [0] },
      }),
    );
    const result = runCli('analyze', '--model', model, '--cases', cases);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`INVALID_MODEL: ${model}: The model has 1 error`);
    expect(result.stderr).toContain('error EMPTY_DOMAIN: /parameters/A:');
  });

  test('names the file of a matrix row that breaks a constraint', () => {
    writeFileSync(
      cases,
      JSON.stringify({
        schemaVersion: 1,
        modelId: 'golden',
        cases: [{ id: 'x', values: { A: 1, B: 0, C: 0 } }],
      }),
    );
    const result = runCli('analyze', '--model', model, '--cases', cases);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`INVALID_MATRIX: ${cases}:`);
    expect(result.stderr).toContain('CONSTRAINT_VIOLATION: /cases/0');
  });

  test('rejects duplicate JSON keys with exit 2', () => {
    writeFileSync(cases, '{"schemaVersion": 1, "schemaVersion": 1}');
    const result = runCli('analyze', '--model', model, '--cases', cases);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Duplicate key "schemaVersion"');
  });

  test('exits 2 for an unsatisfiable model', () => {
    writeFileSync(
      model,
      JSON.stringify({
        schemaVersion: 1,
        id: 'golden',
        strength: 2,
        parameters: { A: [0], B: [0] },
        constraints: [
          { id: 'never', rule: { eq: ['A', 0] } },
          { id: 'not', rule: { not: { eq: ['A', 0] } } },
        ],
      }),
    );
    writeFileSync(cases, JSON.stringify({ schemaVersion: 1, modelId: 'golden', cases: [] }));
    expect(runCli('analyze', '--model', model, '--cases', cases).code).toBe(2);
  });

  test('exits 3 when the raw product exceeds the limit', () => {
    const parameters = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`p${String(i)}`, [0, 1]]),
    );
    writeFileSync(model, JSON.stringify({ schemaVersion: 1, id: 'big', strength: 2, parameters }));
    writeFileSync(cases, JSON.stringify({ schemaVersion: 1, modelId: 'big', cases: [] }));
    const result = runCli('analyze', '--model', model, '--cases', cases);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('LIMIT_EXCEEDED');
  });

  test('exits 3 when an input file cannot be read', () => {
    const result = runCli('analyze', '--model', join(dir, 'absent.json'), '--cases', cases);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('no such file or directory');
  });

  test('shows help and exits 0', () => {
    const result = runCli('analyze', '--help');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: nwise-kit analyze');
  });
});

describe('nwise-kit', () => {
  test('shows usage with --help and the version with --version', () => {
    expect(runCli('--help')).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('Commands:') as string,
    });
    expect(runCli('--version')).toEqual({ code: 0, stdout: '9.9.9-test\n', stderr: '' });
  });

  test('exits 2 without a command or with an unknown one', () => {
    expect(runCli().code).toBe(2);
    const unknown = runCli('frobnicate');
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown command "frobnicate"');
  });
});
