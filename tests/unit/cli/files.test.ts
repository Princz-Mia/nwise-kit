import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  checkOutputPath,
  FileError,
  readJsonFile,
  writeOutputFile,
} from '../../../src/cli/files.js';
import { NwiseKitError } from '../../../src/errors.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nwise-kit-files-'));
});

describe('readJsonFile', () => {
  test('parses strictly and names the file on a syntax error', () => {
    const path = join(dir, 'model.json');
    writeFileSync(path, '{"a": 1, "a": 2}');
    expect(() => readJsonFile(path)).toThrow(NwiseKitError);
    expect(() => readJsonFile(path)).toThrow(/model\.json: Duplicate key "a"/);
  });

  test('reports a missing file as a file error', () => {
    expect(() => readJsonFile(join(dir, 'absent.json'))).toThrow(FileError);
  });
});

describe('checkOutputPath', () => {
  test('refuses an output that is also an input, even with force', () => {
    const input = join(dir, 'model.json');
    writeFileSync(input, '{}');
    expect(() => {
      checkOutputPath(join(dir, '.', 'model.json'), [input], true);
    }).toThrow(/Refusing to write over the input/);
  });

  test('refuses an existing output without force and allows it with force', () => {
    const output = join(dir, 'report.json');
    writeFileSync(output, 'keep');
    expect(() => {
      checkOutputPath(output, [], false);
    }).toThrow(/already exists/);
    expect(() => {
      checkOutputPath(output, [], true);
    }).not.toThrow();
  });

  test('refuses a directory', () => {
    mkdirSync(join(dir, 'out'));
    expect(() => {
      checkOutputPath(join(dir, 'out'), [], true);
    }).toThrow(/is a directory/);
  });
});

describe('writeOutputFile', () => {
  test('writes a new file and leaves no temporary files behind', () => {
    const output = join(dir, 'report.json');
    writeOutputFile(output, 'new', false);
    expect(readFileSync(output, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['report.json']);
  });

  test('never replaces an existing file without force', () => {
    const output = join(dir, 'report.json');
    writeFileSync(output, 'keep');
    expect(() => {
      writeOutputFile(output, 'new', false);
    }).toThrow(/already exists/);
    expect(readFileSync(output, 'utf8')).toBe('keep');
    expect(readdirSync(dir)).toEqual(['report.json']);
  });

  test('replaces an existing file with force', () => {
    const output = join(dir, 'report.json');
    writeFileSync(output, 'old');
    writeOutputFile(output, 'new', true);
    expect(readFileSync(output, 'utf8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['report.json']);
  });

  test('reports an unwritable location as a file error', () => {
    expect(() => {
      writeOutputFile(join(dir, 'missing-dir', 'report.json'), 'x', false);
    }).toThrow(FileError);
  });
});
