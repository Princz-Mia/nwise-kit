// Cleans dist/ and compiles the published sources. Written in Node so the
// same steps run on Windows, Linux and macOS without shell differences.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(root, 'dist'), { recursive: true, force: true });

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json')], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
