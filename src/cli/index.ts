#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from './run.js';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

process.exitCode = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  toolVersion: manifest.version,
});
