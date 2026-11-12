import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { readReport } from '../../../src/reports/read-report.js';
import { createStaticReport, formatReport } from '../../../src/reports/report.js';
import type { StaticReport } from '../../../src/reports/report.js';
import { golden, goldenRows } from '../../fixtures/models.js';

const report = createStaticReport({
  model: golden,
  matrix: { schemaVersion: 1, modelId: 'golden', cases: goldenRows('000', '111') },
  toolVersion: '1.2.3',
});

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

/** A fresh, mutable copy of the report as it would be read from disk. */
function stored(): Mutable<StaticReport> {
  return JSON.parse(formatReport(report)) as Mutable<StaticReport>;
}

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`no item at ${String(index)}`);
  }
  return item;
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

function issues(input: unknown): [string, string | undefined][] {
  const error = rejection(input);
  expect(error.code).toBe('INVALID_REPORT');
  return error.diagnostics.map((d) => [d.code, d.path]);
}

describe('readReport', () => {
  test('reads back a report unchanged', () => {
    expect(readReport(stored())).toEqual(report);
  });

  test('rejects an edited percentage', () => {
    const edited = stored();
    edited.metrics.declared.percentage = 100;
    expect(issues(edited)).toEqual([['REPORT_INCONSISTENT', '/metrics']]);
  });

  test('rejects edited counts in the profile and groups', () => {
    const edited = stored();
    at(edited.profile, 1).declared.covered = 11;
    at(edited.groups, 0).declared.covered = 3;
    expect(issues(edited)).toEqual([
      ['REPORT_INCONSISTENT', '/profile'],
      ['REPORT_INCONSISTENT', '/groups'],
    ]);
  });

  test('rejects a missing list with entries removed', () => {
    const edited = stored();
    edited.missing.declared.pop();
    expect(issues(edited)).toEqual([['REPORT_INCONSISTENT', '/missing']]);
  });

  test('rejects a row added to the embedded matrix without new counts', () => {
    const edited = stored();
    edited.matrix.cases.push({ id: 'extra', values: { A: 0, B: 0, C: 1 } });
    expect(issues(edited).map(([, path]) => path)).toEqual([
      '/matrixHash',
      '/metrics',
      '/profile',
      '/groups',
      '/missing',
    ]);
  });

  test('rejects a changed hash', () => {
    const edited = stored();
    edited.modelHash = '0'.repeat(64);
    expect(issues(edited)).toEqual([['REPORT_INCONSISTENT', '/modelHash']]);
  });

  test('reports errors in the embedded inputs at their path in the report', () => {
    const badModel = stored();
    badModel.model.parameters['A'] = [];
    expect(issues(badModel)).toEqual([['EMPTY_DOMAIN', '/model/parameters/A']]);

    const badRow = stored();
    at(badRow.matrix.cases, 0).values['A'] = 1;
    expect(issues(badRow)).toEqual([['CONSTRAINT_VIOLATION', '/matrix/cases/0']]);

    const badLimits = stored();
    badLimits.limits.maxParameters = 0;
    expect(issues(badLimits)).toEqual([['INVALID_LIMIT', '/limits']]);
  });

  test('rejects unknown keys, other kinds and bad metadata', () => {
    expect(issues({ ...stored(), note: 'x' })).toEqual([['UNKNOWN_KEY', '/note']]);
    expect(issues({ ...stored(), kind: 'other' })).toEqual([['UNSUPPORTED_REPORT_KIND', '/kind']]);
    expect(issues({ ...stored(), kind: 'runtime' })).toEqual([['MISSING_KEY', '']]);
    expect(issues({ ...stored(), toolVersion: '' })).toEqual([
      ['INVALID_IDENTIFIER', '/toolVersion'],
    ]);
    expect(issues({ ...stored(), durationMs: -1 })).toEqual([['INVALID_TYPE', '/durationMs']]);
  });

  test('rejects an unsupported schema version', () => {
    expect(rejection({ ...stored(), schemaVersion: 2 }).code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  test('stops as incomplete when the embedded limits are too low to recompute', () => {
    const edited = stored();
    edited.limits.maxValidConfigurations = 2;
    expect(rejection(edited).code).toBe('ANALYSIS_INCOMPLETE');
  });
});
