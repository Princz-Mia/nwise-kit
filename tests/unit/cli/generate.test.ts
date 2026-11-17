import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { exampleDir, runCli } from './helpers.js';

let dir: string;
let model: string;
let out: string;

beforeEach(() => {
  dir = exampleDir('os-cpu-protocol', ['model.json']);
  model = join(dir, 'model.json');
  out = join(dir, 'generated.json');
});

function generate(...extra: string[]) {
  return runCli('generate', '--model', model, '--out', out, ...extra);
}

function writtenIds(path = out): string[] {
  const matrix = JSON.parse(readFileSync(path, 'utf8')) as { cases: { id: string }[] };
  return matrix.cases.map((c) => c.id);
}

/** Rewrites the copied model with another strength. */
function setStrength(strength: number): void {
  const input = JSON.parse(readFileSync(model, 'utf8')) as Record<string, unknown>;
  writeFileSync(model, JSON.stringify({ ...input, strength }));
}

describe('nwise-kit generate', () => {
  test('writes a pairwise suite that an analysis confirms', () => {
    const result = generate();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Model os-cpu-protocol, strength 2, target 100%');
    expect(result.stdout).toContain('Cases: 0 existing, 4 added');
    expect(result.stdout).toContain(
      'Coverage: 0/12 (0.00%) before, 12/12 (100.00%) with the added cases',
    );
    expect(result.stdout).toContain(`Matrix written to ${out}`);
    expect(writtenIds()).toEqual([
      'suggested-001',
      'suggested-002',
      'suggested-003',
      'suggested-004',
    ]);
    const analysed = runCli('analyze', '--model', model, '--cases', out);
    expect(analysed.stdout).toContain('declared  12/12 (100.00%)');
  });

  test.each([
    [1, 2, '6/6'],
    [2, 4, '12/12'],
    [3, 8, '8/8'],
  ])('at strength %i writes %i cases', (strength, cases, coverage) => {
    setStrength(strength);
    expect(generate().code).toBe(0);
    expect(writtenIds()).toHaveLength(cases);
    const analysed = runCli('analyze', '--model', model, '--cases', out);
    expect(analysed.stdout).toContain(`declared  ${coverage} (100.00%)`);
  });

  test('adds as many cases as the target needs, without a default cap', () => {
    const checkout = exampleDir('checkout', ['model.json']);
    const checkoutModel = join(checkout, 'model.json');
    const input = JSON.parse(readFileSync(checkoutModel, 'utf8')) as Record<string, unknown>;
    writeFileSync(checkoutModel, JSON.stringify({ ...input, strength: 4 }));
    const target = join(checkout, 'all.json');
    const result = runCli('generate', '--model', checkoutModel, '--out', target);
    expect(result.code).toBe(0);
    // 24 configurations, of which the four with a guest on the premium plan are invalid.
    expect(writtenIds(target)).toHaveLength(20);
  });

  test('keeps existing cases and adds only what they miss', () => {
    const golden = exampleDir('golden', ['model.json', 'cases.json']);
    const combined = join(golden, 'combined.json');
    const result = runCli(
      'generate',
      '--model',
      join(golden, 'model.json'),
      '--cases',
      join(golden, 'cases.json'),
      '--out',
      combined,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Cases: 2 existing, 3 added');
    expect(result.stdout).toContain('Coverage: 6/11 (54.55%) before, 11/11 (100.00%)');
    expect(writtenIds(combined).slice(2)).toEqual([
      'suggested-001',
      'suggested-002',
      'suggested-003',
    ]);
  });

  test('writes a partial matrix and exits 1 when the case budget ends first', () => {
    const result = generate('--max-new-cases', '2');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'Target not reached: the case budget ran out before the target. Still missing: 6',
    );
    expect(writtenIds()).toHaveLength(2);
  });

  test('stops at a lower target', () => {
    const result = generate('--target', '50');
    expect(result.code).toBe(0);
    expect(writtenIds()).toHaveLength(2);
  });

  test.each([
    [['--max-new-cases', '0'], 'Invalid --max-new-cases "0"'],
    [['--target', '101'], 'INVALID_ARGUMENTS'],
    [['--basis', 'observed'], "Unknown option '--basis'"],
  ])('rejects %j', (extra, message) => {
    const result = generate(...extra);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  test('requires --model and --out', () => {
    expect(runCli('generate', '--out', out).stderr).toContain('Missing --model');
    const result = runCli('generate', '--model', model);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Missing --out');
  });

  test('refuses to replace an existing file without --force, and never an input', () => {
    expect(generate().code).toBe(0);
    expect(generate().code).toBe(2);
    expect(generate('--force').code).toBe(0);
    const before = readFileSync(model, 'utf8');
    const overInput = runCli('generate', '--model', model, '--out', model, '--force');
    expect(overInput.code).toBe(2);
    expect(overInput.stderr).toContain('OUTPUT_IS_INPUT');
    expect(readFileSync(model, 'utf8')).toBe(before);
  });

  test('shows help and exits 0', () => {
    const result = runCli('generate', '--help');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: nwise-kit generate');
  });
});
