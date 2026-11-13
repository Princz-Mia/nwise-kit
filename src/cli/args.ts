import { parseArgs } from 'node:util';
import { NwiseKitError } from '../errors.js';
import { neutralize } from '../reports/terminal.js';

export type OptionTypes = Readonly<Record<string, 'string' | 'boolean'>>;

export type OptionValues<T extends OptionTypes> = {
  readonly [K in keyof T]?: T[K] extends 'string' ? string : boolean;
};

/**
 * Parses a command's options. Unknown options, positional arguments,
 * missing option values and repeated options are rejected rather than
 * guessed at.
 */
export function parseOptions<T extends OptionTypes>(
  argv: readonly string[],
  types: T,
): OptionValues<T> {
  const options = Object.fromEntries(Object.entries(types).map(([name, type]) => [name, { type }]));
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
  } catch (error) {
    throw invalidArguments(error instanceof Error ? error.message : String(error));
  }
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind === 'option') {
      if (seen.has(token.name)) {
        throw invalidArguments(`Option --${token.name} is given more than once`);
      }
      seen.add(token.name);
    }
  }
  return parsed.values as OptionValues<T>;
}

/** Returns a required string option or explains that it is missing. */
export function requireOption(value: string | undefined, name: string, command: string): string {
  if (value === undefined || value === '') {
    throw invalidArguments(`Missing --${name}`, `Run "nwise-kit ${command} --help" for usage.`);
  }
  return value;
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** Parses the value of an option that must be a positive whole number. */
export function parsePositiveInteger(text: string, name: string): number {
  const value = Number(text);
  if (!POSITIVE_INTEGER.test(text) || !Number.isSafeInteger(value)) {
    throw invalidArguments(
      `Invalid --${name} "${neutralize(text)}"`,
      'Use a positive whole number.',
    );
  }
  return value;
}

export function invalidArguments(message: string, hint?: string): NwiseKitError {
  return new NwiseKitError('INVALID_ARGUMENTS', message, [
    {
      code: 'INVALID_ARGUMENTS',
      severity: 'error',
      message,
      ...(hint === undefined ? {} : { hint }),
    },
  ]);
}
