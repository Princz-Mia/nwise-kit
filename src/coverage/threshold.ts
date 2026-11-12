import { NwiseKitError } from '../errors.js';
import type { Metric } from './coverage.js';

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
