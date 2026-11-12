import { randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { NwiseKitError } from '../errors.js';
import { parseJson } from '../model/json.js';

/** A file could not be read or written. Maps to exit code 3. */
export class FileError extends Error {
  override readonly name = 'FileError';
}

/** Reads and strictly parses a JSON file; parse errors name the file. */
export function readJsonFile(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new FileError(`Cannot read ${path}: ${reason(error)}`);
  }
  try {
    return parseJson(text);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      throw new NwiseKitError(error.code, `${path}: ${error.message}`, error.diagnostics);
    }
    throw error;
  }
}

/** A comparable identity for a path, following links and ignoring case where the platform does. */
function identity(path: string): string {
  let full = resolve(path);
  try {
    full = realpathSync.native(full);
  } catch {
    // A path that does not exist yet is compared as written.
  }
  return process.platform === 'win32' || process.platform === 'darwin' ? full.toLowerCase() : full;
}

/**
 * Checks an output path before any work is done: it must not be one of
 * the inputs, even with --force, and it must not exist unless --force
 * is given.
 */
export function checkOutputPath(target: string, inputs: readonly string[], force: boolean): void {
  const id = identity(target);
  if (inputs.some((input) => identity(input) === id)) {
    throw new NwiseKitError('INVALID_ARGUMENTS', `Refusing to write over the input ${target}`, [
      {
        code: 'OUTPUT_IS_INPUT',
        severity: 'error',
        message: `${target} is also an input file`,
        hint: 'Choose a different output path; inputs are never overwritten.',
      },
    ]);
  }
  if (existsSync(target)) {
    if (statSync(target).isDirectory()) {
      throw new NwiseKitError('INVALID_ARGUMENTS', `${target} is a directory`);
    }
    if (!force) {
      throw new NwiseKitError('INVALID_ARGUMENTS', `${target} already exists`, [
        {
          code: 'OUTPUT_EXISTS',
          severity: 'error',
          message: `${target} already exists and was left untouched`,
          hint: 'Pass --force to replace it, or choose another path.',
        },
      ]);
    }
  }
}

/**
 * Writes a file atomically: the content goes to a temporary file next to
 * the target, which then takes the target's place in one step. Without
 * `force`, an existing target is never replaced, even if it appears
 * after `checkOutputPath`.
 */
export function writeOutputFile(target: string, content: string, force: boolean): void {
  const temporary = join(
    dirname(resolve(target)),
    `.${basename(target)}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(temporary, content, { flag: 'wx' });
    if (force) {
      renameSync(temporary, target);
      return;
    }
    try {
      // Creating a hard link fails if the target exists, so nothing is replaced.
      linkSync(temporary, target);
    } catch (error) {
      if (codeOf(error) === 'EEXIST') {
        throw new NwiseKitError('INVALID_ARGUMENTS', `${target} already exists`);
      }
      // Some file systems have no hard links; fall back to check-then-rename.
      if (existsSync(target)) {
        throw new NwiseKitError('INVALID_ARGUMENTS', `${target} already exists`);
      }
      renameSync(temporary, target);
    }
  } catch (error) {
    if (error instanceof NwiseKitError) {
      throw error;
    }
    throw new FileError(`Cannot write ${target}: ${reason(error)}`);
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary);
    }
  }
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function reason(error: unknown): string {
  const code = codeOf(error);
  if (code === 'ENOENT') {
    return 'no such file or directory';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'permission denied';
  }
  return error instanceof Error ? error.message : String(error);
}
