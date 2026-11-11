import { describe, expect, test } from 'vitest';
import { metric } from '../../../src/coverage/coverage.js';
import { NwiseKitError } from '../../../src/errors.js';
import { checkCoverage, meetsThreshold, parseThreshold } from '../../../src/reports/check.js';
import { createStaticReport } from '../../../src/reports/report.js';
import { golden, goldenRows } from '../../fixtures/models.js';

describe('parseThreshold', () => {
  test.each([
    ['0', 0],
    ['95', 95_000],
    ['99.5', 99_500],
    ['99.125', 99_125],
    ['100', 100_000],
    ['100.000', 100_000],
  ])('reads %s as %d thousandths', (text, expected) => {
    expect(parseThreshold(text)).toBe(expected);
  });

  test.each(['', '100.001', '101', '-1', '95.1234', '1e2', ' 95', '95.', '.5', 'abc'])(
    'rejects %j',
    (text) => {
      expect(() => parseThreshold(text)).toThrow(NwiseKitError);
    },
  );
});

describe('meetsThreshold', () => {
  test('fails 94,999 of 100,000 at 95% even though it displays as 95.00%', () => {
    const almost = metric(94_999, 100_000);
    expect(almost.percentage.toFixed(2)).toBe('95.00');
    expect(meetsThreshold(almost, parseThreshold('95'))).toBe(false);
    expect(meetsThreshold(metric(95_000, 100_000), parseThreshold('95'))).toBe(true);
  });

  test('compares at thousandth precision', () => {
    // 6/11 is 54.5454...%.
    expect(meetsThreshold(metric(6, 11), parseThreshold('54.545'))).toBe(true);
    expect(meetsThreshold(metric(6, 11), parseThreshold('54.546'))).toBe(false);
  });
});

describe('checkCoverage', () => {
  const report = createStaticReport({
    model: golden,
    matrix: { schemaVersion: 1, modelId: 'golden', cases: goldenRows('000', '111') },
    toolVersion: '1.2.3',
  });

  test('returns a verdict with the exact counts', () => {
    expect(checkCoverage(report, 'declared', '50')).toEqual({
      passed: true,
      metric: 'declared',
      covered: 6,
      total: 11,
      percentage: 600 / 11,
      threshold: '50',
      thresholdThousandths: 50_000,
    });
    expect(checkCoverage(report, 'declared', 60).passed).toBe(false);
  });

  test('refuses a metric the static report does not have', () => {
    let error: unknown;
    try {
      checkCoverage(report, 'observed', '95');
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(NwiseKitError);
    expect((error as NwiseKitError).code).toBe('METRIC_UNAVAILABLE');
    expect((error as NwiseKitError).diagnostics[0]?.hint).toContain('--metric declared');
  });
});
