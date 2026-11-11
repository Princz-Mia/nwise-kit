import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../../src/cli/run.js';

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runCli(...argv: string[]): CliResult {
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    toolVersion: '9.9.9-test',
  });
  return { code, stdout, stderr };
}

/** A fresh directory holding a copy of one example's files. */
export function exampleDir(example: string, files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'nwise-kit-cli-'));
  for (const file of files) {
    copyFileSync(
      fileURLToPath(new URL(`../../../examples/${example}/${file}`, import.meta.url)),
      join(dir, file),
    );
  }
  return dir;
}
