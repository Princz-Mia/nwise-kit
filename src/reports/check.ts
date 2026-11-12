import type { Metric } from '../coverage/coverage.js';
import { NwiseKitError } from '../errors.js';
import type { StaticReport } from './report.js';

export type MetricName = 'declared' | 'observed' | 'passed';

export const METRIC_NAMES: readonly MetricName[] = ['declared', 'observed', 'passed'];

/** The outcome of a coverage gate. An unmet threshold is a result, not an error. */
export interface CoverageVerdict {
  readonly passed: boolean;
  readonly metric: MetricName;
  readonly covered: number;
  readonly total: number;
  readonly percentage: number;
  /** The threshold as given, such as "95" or "99.5". */
  readonly threshold: string;
  /** The threshold in thousandths of a percent, as compared. */
  readonly thresholdThousandths: number;
}

const THRESHOLD = /^(?:100(?:\.0{1,3})?|\d{1,2}(?:\.\d{1,3})?)$/;

/**
 * Parses a percentage in [0, 100] with at most three decimals into
 * thousandths of a percent, so comparisons never use floating point.
 */
export function parseThreshold(text: string): number {
  if (!THRESHOLD.test(text)) {
    throw new NwiseKitError('INVALID_ARGUMENTS', `Invalid coverage threshold "${text}"`, [
      {
        code: 'INVALID_THRESHOLD',
        severity: 'error',
        message: `"${text}" is not a percentage between 0 and 100`,
        hint: 'Use a number such as 95 or 99.125, with at most three decimals.',
      },
    ]);
  }
  const [whole = '0', fraction = ''] = text.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}

/**
 * Exact comparison: covered / total >= q / 100000, evaluated as
 * covered * 100000 >= total * q. A display rounded to 95.00% can still fail
 * a 95% gate.
 */
export function meetsThreshold(metric: Metric, thousandths: number): boolean {
  return BigInt(metric.covered) * 100_000n >= BigInt(metric.total) * BigInt(thousandths);
}

/**
 * Compares one metric of a validated report with a threshold. A metric
 * that the report does not have is an error, never a pass or a zero.
 */
export function checkCoverage(
  report: StaticReport,
  metric: MetricName,
  threshold: string | number,
): CoverageVerdict {
  const text = String(threshold);
  const thousandths = parseThreshold(text);
  const value = report.metrics[metric];
  if (value === null) {
    throw new NwiseKitError(
      'METRIC_UNAVAILABLE',
      `The report has no ${metric} coverage: it is a ${report.kind} report`,
      [
        {
          code: 'METRIC_UNAVAILABLE',
          severity: 'error',
          message: `Static reports carry declared coverage only; ${metric} coverage needs runtime evidence`,
          path: `/metrics/${metric}`,
          hint: 'Check the declared metric (--metric declared), or check a report from a test run.',
        },
      ],
    );
  }
  return {
    passed: meetsThreshold(value, thousandths),
    metric,
    covered: value.covered,
    total: value.total,
    percentage: value.percentage,
    threshold: text,
    thresholdThousandths: thousandths,
  };
}
