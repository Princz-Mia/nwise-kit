import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import * as kit from '../../src/index.js';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

/** The function names in the first column of the Library table. */
function documentedFunctions(): string[] {
  const start = readme.indexOf('## Library');
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1));
  return section
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .flatMap((line) => [...(line.split('|')[1] ?? '').matchAll(/`([A-Za-z]+)`/g)])
    .map((match) => match[1] ?? '');
}

describe('README', () => {
  test('documents only functions the package exports', () => {
    const names = documentedFunctions();
    expect(names.length).toBeGreaterThan(8);
    // These two live in their own entry points, which need Vitest.
    const core = names.filter((name) => !['createMatrixSuite', 'NwiseKitReporter'].includes(name));
    for (const name of core) {
      expect(typeof (kit as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  test('lists every command the CLI has', () => {
    for (const command of ['analyze', 'check', 'suggest', 'report']) {
      expect(readme).toContain(`node dist/cli/index.js ${command} `);
    }
  });
});
