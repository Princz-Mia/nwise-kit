import type { Diagnostic } from '../errors.js';
import { appendPointer } from './pointer.js';
import type { DomainValue } from './types.js';

/** Collects input errors so one run reports every problem it can find. */
export class Issues {
  readonly diagnostics: Diagnostic[] = [];

  error(code: string, path: string, message: string, hint?: string): void {
    this.diagnostics.push({
      code,
      severity: 'error',
      message,
      path,
      ...(hint === undefined ? {} : { hint }),
    });
  }

  get count(): number {
    return this.diagnostics.length;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'an array' : `a ${typeof value}`;
}

/**
 * Checks that `value` is an object with only the allowed own keys and all
 * the required ones. Unknown keys are errors so typos are not ignored.
 */
export function checkObject(
  issues: Issues,
  value: unknown,
  path: string,
  what: string,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.error('INVALID_TYPE', path, `${what} must be an object, not ${describe(value)}`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      const known = [...required, ...optional].map((k) => `"${k}"`).join(', ');
      issues.error(
        'UNKNOWN_KEY',
        appendPointer(path, key),
        `Unknown key "${key}" in ${what}`,
        `Allowed keys: ${known}.`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      issues.error('MISSING_KEY', path, `${what} is missing "${key}"`);
    }
  }
  return true;
}

export function checkIdentifier(
  issues: Issues,
  value: unknown,
  path: string,
  what: string,
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    issues.error('INVALID_IDENTIFIER', path, `${what} must be a non-empty string`);
    return false;
  }
  if (!value.isWellFormed()) {
    issues.error('INVALID_IDENTIFIER', path, `${what} contains an unpaired surrogate`);
    return false;
  }
  return true;
}

/**
 * Validates one domain value and normalises -0 to 0. Returns undefined
 * after recording an error.
 */
export function checkDomainValue(
  issues: Issues,
  value: unknown,
  path: string,
): DomainValue | undefined {
  switch (typeof value) {
    case 'boolean':
      return value;
    case 'string':
      if (!value.isWellFormed()) {
        issues.error('INVALID_VALUE', path, 'String values must not contain unpaired surrogates');
        return undefined;
      }
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        issues.error('INVALID_VALUE', path, 'Numbers must be finite');
        return undefined;
      }
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        issues.error(
          'UNSAFE_INTEGER',
          path,
          `${String(value)} is outside the safe integer range`,
          'Use a string for large identifiers.',
        );
        return undefined;
      }
      return value === 0 ? 0 : value;
    default:
      issues.error(
        'INVALID_VALUE',
        path,
        `Values must be strings, booleans or finite numbers, not ${describe(value)}`,
      );
      return undefined;
  }
}
