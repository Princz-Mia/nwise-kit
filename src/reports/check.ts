import { meetsThreshold, parseThreshold } from '../coverage/threshold.js';
import { NwiseKitError } from '../errors.js';
import type { StaticReport } from './report.js';

export { meetsThreshold, parseThreshold } from '../coverage/threshold.js';

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
