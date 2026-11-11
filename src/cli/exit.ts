import type { ErrorCode } from '../errors.js';
import { NwiseKitError } from '../errors.js';
import { neutralize, renderDiagnostic } from '../reports/terminal.js';
import { FileError } from './files.js';

/** Documented exit codes. */
export const EXIT = {
  /** The operation succeeded and any requested gate passed. */
  ok: 0,
  /** A coverage gate or a required suggestion target was not met. */
  unmet: 1,
  /** Invalid arguments, model, matrix or report, an unavailable metric or an unsatisfiable model. */
  invalid: 2,
  /** Incomplete analysis, a resource limit, an I/O failure or an internal error. */
  incomplete: 3,
} as const;

const INVALID_INPUT: readonly ErrorCode[] = [
  'INVALID_JSON',
  'INVALID_MODEL',
  'INVALID_MATRIX',
  'INVALID_LIMITS',
  'INVALID_REPORT',
  'INVALID_ARGUMENTS',
  'UNSUPPORTED_SCHEMA_VERSION',
  'UNSATISFIABLE_MODEL',
  'METRIC_UNAVAILABLE',
];

export function exitCodeFor(error: unknown): number {
  if (error instanceof NwiseKitError && INVALID_INPUT.includes(error.code)) {
    return EXIT.invalid;
  }
  return EXIT.incomplete;
}

/** An error and its diagnostics for standard error, without a stack trace. */
export function renderError(error: unknown): string {
  if (error instanceof NwiseKitError) {
    const details = error.diagnostics.map(renderDiagnostic).join('');
    return `nwise-kit: ${error.code}: ${neutralize(error.message)}\n${details}`;
  }
  if (error instanceof FileError) {
    return `nwise-kit: ${neutralize(error.message)}\n`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `nwise-kit: internal error: ${neutralize(message)}\n`;
}
