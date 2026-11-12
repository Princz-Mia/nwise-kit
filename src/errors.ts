export type Severity = 'error' | 'warning';

/** A typed issue found in an input, an analysis or a run. */
export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  /** JSON Pointer to the offending value, such as `/constraints/0/rule/eq/0`. */
  readonly path?: string;
  readonly caseIds?: readonly string[];
  /** What the user can do about it. */
  readonly hint?: string;
}

export type ErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_MODEL'
  | 'INVALID_MATRIX'
  | 'INVALID_LIMITS'
  | 'INVALID_REPORT'
  | 'INVALID_EVIDENCE'
  | 'INVALID_ARGUMENTS'
  | 'METRIC_UNAVAILABLE'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNSATISFIABLE_MODEL'
  | 'LIMIT_EXCEEDED'
  | 'ANALYSIS_INCOMPLETE'
  | 'RUNTIME_INCOMPLETE';

/**
 * Thrown for invalid inputs and for analyses that cannot finish exactly.
 * Unmet coverage gates and exhausted recommendation budgets are ordinary
 * results, not errors.
 */
export class NwiseKitError extends Error {
  override readonly name = 'NwiseKitError';
  readonly code: ErrorCode;
  readonly diagnostics: readonly Diagnostic[];

  constructor(code: ErrorCode, message: string, diagnostics: readonly Diagnostic[] = []) {
    super(message);
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
