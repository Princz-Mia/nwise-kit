import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bin = join(root, 'dist', 'cli', 'index.js');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
};

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the built nwise-kit binary', () => {
  test('is the declared bin and starts with a Node shebang', () => {
    expect(join(root, manifest.bin['nwise-kit'] ?? '')).toBe(bin);
    expect(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  test('reports the package version', () => {
    expect(cli('--version')).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: '' });
  });

  test('analyses an example, writes a report and gates on it', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'nwise-kit-bin-')), 'report.json');
    const analysed = cli(
      'analyze',
      '--model',
      'examples/os-cpu-protocol/model.json',
      '--cases',
      'examples/os-cpu-protocol/cases.each-option.json',
      '--json',
      out,
    );
    expect(analysed.code).toBe(0);
    expect(analysed.stdout).toContain('declared  6/12 (50.00%)');

    expect(cli('check', '--input', out, '--metric', 'declared', '--min-coverage', '50').code).toBe(
      0,
    );
    expect(
      cli('check', '--input', out, '--metric', 'declared', '--min-coverage', '50.001').code,
    ).toBe(1);
    expect(cli('check', '--input', out, '--min-coverage', '50').code).toBe(2);
  });

  test('exits 2 for an unknown option', () => {
    const result = cli('analyze', '--bogus');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown option '--bogus'");
  });
});
