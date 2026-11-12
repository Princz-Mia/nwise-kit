import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { parseJson } from '../../../src/model/json.js';
import { checkCoverage } from '../../../src/reports/check.js';
import { readReport } from '../../../src/reports/read-report.js';
import type { RuntimeReport } from '../../../src/reports/report.js';
import { createRuntimeReport, formatReport } from '../../../src/reports/report.js';
import { renderSummary } from '../../../src/reports/terminal.js';
import { golden } from '../../fixtures/models.js';
import { runCli } from '../cli/helpers.js';
import { evidence, rows, testEntry } from '../evidence/helpers.js';

const matrix = { schemaVersion: 1, modelId: 'golden', cases: rows };
const zero = rows[0]?.id ?? '';
const one = rows[1]?.id ?? '';

function build(tests = [testEntry(zero), testEntry(one, { outcome: 'failed' })], extra = {}) {
  return createRuntimeReport({
    model: golden,
    matrix,
    evidence: evidence(tests, extra),
    toolVersion: '1.2.3',
  });
}

function read(path: string): unknown {
  return parseJson(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
ajv.addSchema(read('schemas/model.schema.json') as object);
ajv.addSchema(read('schemas/matrix.schema.json') as object);
const schema = ajv.compile(read('schemas/report.schema.json') as object);

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

function stored(report: RuntimeReport): Mutable<RuntimeReport> {
  return JSON.parse(formatReport(report)) as Mutable<RuntimeReport>;
}

function rejection(input: unknown): NwiseKitError {
  try {
    readReport(input);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected readReport to throw');
}

describe('runtime reports', () => {
  const report = build();

  test('carry declared, observed and passed coverage with the evidence', () => {
    expect(report).toMatchObject({
      kind: 'runtime',
      runId: 'run-1',
      runtimeComplete: true,
      filters: null,
      metrics: {
        declared: { covered: 6, total: 11 },
        observed: { covered: 6, total: 11 },
        passed: { covered: 3, total: 11 },
      },
    });
    expect(report.evidence.tests).toHaveLength(2);
    expect(report.missing.passed).toHaveLength(8);
  });

  test('match the report schema, complete or not', () => {
    expect(schema(JSON.parse(formatReport(report)))).toBe(true);
    const incomplete = build([testEntry(zero), testEntry(one, { outcome: 'missing' })]);
    expect(schema(JSON.parse(formatReport(incomplete)))).toBe(true);
  });

  test('read back unchanged', () => {
    expect(readReport(stored(report))).toEqual(report);
  });

  test('reject edited evidence whose counts were not recomputed', () => {
    const edited = stored(report);
    const second = edited.evidence.tests[1];
    if (second === undefined) {
      throw new Error('missing test');
    }
    second.outcome = 'passed';
    const error = rejection(edited);
    expect(error.code).toBe('INVALID_REPORT');
    expect(error.diagnostics.map((d) => d.path)).toEqual([
      '/metrics',
      '/profile',
      '/groups',
      '/missing',
      '/diagnostics',
    ]);
  });

  test('reject evidence for another matrix at its path in the report', () => {
    const edited = stored(report);
    edited.evidence.matrixHash = '0'.repeat(64);
    const error = rejection(edited);
    expect(error.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['MATRIX_HASH_MISMATCH', '/evidence/matrixHash'],
    ]);
  });

  test('pass or fail a gate on observed and passed coverage', () => {
    expect(checkCoverage(report, 'observed', '54.545').passed).toBe(true);
    expect(checkCoverage(report, 'passed', '50').passed).toBe(false);
  });

  test('never pass a gate when the run is incomplete, whatever the metric', () => {
    const incomplete = build([testEntry(zero), testEntry(one, { outcome: 'missing' })]);
    expect(() => checkCoverage(incomplete, 'declared', '0')).toThrow(NwiseKitError);
    try {
      checkCoverage(incomplete, 'declared', '0');
    } catch (error) {
      expect((error as NwiseKitError).code).toBe('RUNTIME_INCOMPLETE');
    }
  });

  test('summarise the run and the gaps in passed coverage', () => {
    const text = renderSummary(report);
    expect(text).toContain('Run run-1: complete; 2 tests registered');
    expect(text).toContain('  observed  6/11 (54.55%)');
    expect(text).toContain('  passed    3/11 (27.27%)');
    expect(text).toContain('Missing pairs for passed coverage (8):');
    const filtered = build([testEntry(zero)], { filters: { testNamePattern: 'guest', files: [] } });
    expect(renderSummary(filtered)).toContain(
      'Filtered run: name pattern guest; the full matrix stays the denominator',
    );
    const incomplete = build([testEntry(zero, { outcome: 'missing' })]);
    expect(renderSummary(incomplete)).toContain('INCOMPLETE, runtime metrics unavailable');
  });
});

describe('nwise-kit check on runtime reports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nwise-kit-runtime-'));

  function write(name: string, report: RuntimeReport): string {
    const path = join(dir, name);
    writeFileSync(path, formatReport(report));
    return path;
  }

  test('uses observed coverage by default', () => {
    const path = write('complete.json', build());
    expect(runCli('check', '--input', path, '--min-coverage', '54.545')).toMatchObject({ code: 0 });
    expect(runCli('check', '--input', path, '--min-coverage', '60')).toMatchObject({ code: 1 });
    expect(
      runCli('check', '--input', path, '--metric', 'passed', '--min-coverage', '27'),
    ).toMatchObject({ code: 0 });
  });

  test('exits 3 for an incomplete run, even on declared coverage', () => {
    const path = write(
      'incomplete.json',
      build([testEntry(zero), testEntry(one, { outcome: 'missing' })]),
    );
    const result = runCli('check', '--input', path, '--metric', 'declared', '--min-coverage', '0');
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('RUNTIME_INCOMPLETE');
  });
});
