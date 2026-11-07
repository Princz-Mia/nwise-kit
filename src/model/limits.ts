import { NwiseKitError } from '../errors.js';
import type { Diagnostic } from '../errors.js';

/** Resource bounds applied to every analysis. Exceeding one never yields an approximate result. */
export interface Limits {
  readonly maxParameters: number;
  readonly maxRawConfigurations: number;
  readonly maxValidConfigurations: number;
  readonly maxInteractions: number;
  readonly maxConstraintDepth: number;
  readonly maxConstraintNodes: number;
  readonly analysisTimeMs: number;
  /** Candidate-interaction membership checks allowed while generating suggestions. */
  readonly suggestionWork: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxParameters: 20,
  maxRawConfigurations: 1_000_000,
  maxValidConfigurations: 100_000,
  maxInteractions: 500_000,
  maxConstraintDepth: 32,
  maxConstraintNodes: 10_000,
  analysisTimeMs: 30_000,
  suggestionWork: 20_000_000,
});

const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS) as (keyof Limits)[];

/** Applies overrides to the defaults; each limit must be a positive safe integer. */
export function resolveLimits(overrides: Partial<Limits> = {}): Limits {
  const diagnostics: Diagnostic[] = [];
  const resolved: Record<string, number> = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(overrides)) {
    const value: unknown = (overrides as Record<string, unknown>)[key];
    if (!LIMIT_KEYS.includes(key as keyof Limits)) {
      diagnostics.push({
        code: 'UNKNOWN_LIMIT',
        severity: 'error',
        message: `Unknown limit "${key}"`,
        hint: `Known limits: ${LIMIT_KEYS.join(', ')}.`,
      });
    } else if (value === undefined) {
      continue;
    } else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      diagnostics.push({
        code: 'INVALID_LIMIT',
        severity: 'error',
        message: `Limit "${key}" must be a positive integer`,
      });
    } else {
      resolved[key] = value;
    }
  }
  if (diagnostics.length > 0) {
    throw new NwiseKitError('INVALID_LIMITS', 'Invalid resource limits', diagnostics);
  }
  return resolved as unknown as Limits;
}
