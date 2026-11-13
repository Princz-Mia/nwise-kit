import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { exampleDir, runCli } from './helpers.js';

let dir: string;
let report: string;
let html: string;

beforeEach(() => {
  dir = exampleDir('golden', ['model.json', 'cases.json']);
  report = join(dir, 'report.json');
  html = join(dir, 'report.html');
  const model = join(dir, 'model.json');
  const cases = join(dir, 'cases.json');
  expect(runCli('analyze', '--model', model, '--cases', cases, '--json', report).code).toBe(0);
  expect(
    runCli('suggest', '--model', model, '--cases', cases, '--out', join(dir, 's.json')).code,
  ).toBe(0);
});

describe('nwise-kit report', () => {
  test('writes an offline HTML page', () => {
    const result = runCli('report', '--input', report, '--html', html);
    expect(result).toEqual({ code: 0, stdout: `HTML report written to ${html}\n`, stderr: '' });
    expect(readFileSync(html, 'utf8')).toContain('<!doctype html>');
  });

  test('includes suggestions for the same matrix', () => {
    const result = runCli(
      'report',
      '--input',
      report,
      '--html',
      html,
      '--suggestions',
      join(dir, 's.json'),
    );
    expect(result.code).toBe(0);
    expect(readFileSync(html, 'utf8')).toContain('Recommendations');
  });

  test('refuses suggestions for another matrix', () => {
    const other = JSON.parse(readFileSync(join(dir, 's.json'), 'utf8')) as { matrixHash: string };
    other.matrixHash = '0'.repeat(64);
    writeFileSync(join(dir, 'other.json'), JSON.stringify(other));
    const result = runCli(
      'report',
      '--input',
      report,
      '--html',
      html,
      '--suggestions',
      join(dir, 'other.json'),
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('MATRIX_HASH_MISMATCH');
  });

  test('refuses an edited report and an existing output without --force', () => {
    writeFileSync(html, 'keep');
    expect(runCli('report', '--input', report, '--html', html).code).toBe(2);
    expect(readFileSync(html, 'utf8')).toBe('keep');
    const stored = JSON.parse(readFileSync(report, 'utf8')) as {
      metrics: { declared: { covered: number } };
    };
    stored.metrics.declared.covered = 11;
    writeFileSync(report, JSON.stringify(stored));
    expect(runCli('report', '--input', report, '--html', join(dir, 'new.html')).code).toBe(2);
  });

  test('requires --html and shows help', () => {
    expect(runCli('report', '--input', report).stderr).toContain('Missing --html');
    expect(runCli('report', '--help').code).toBe(0);
  });
});
