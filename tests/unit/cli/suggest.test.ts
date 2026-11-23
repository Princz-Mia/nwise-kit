import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { createRuntimeReport, formatReport } from '../../../src/reports/report.js';
import { golden } from '../../fixtures/models.js';
import { evidence, rows, testEntry } from '../evidence/helpers.js';
import { exampleDir, runCli } from './helpers.js';

let dir: string;
let model: string;
let cases: string;
let out: string;

beforeEach(() => {
  dir = exampleDir('golden', ['model.json', 'cases.json']);
  model = join(dir, 'model.json');
  cases = join(dir, 'cases.json');
  out = join(dir, 'suggestions.json');
});

function suggest(...extra: string[]) {
  return runCli('suggest', '--model', model, '--cases', cases, '--out', out, ...extra);
}

describe('nwise-kit suggest', () => {
  test('prints and writes the recommendations', () => {
    const result = suggest();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Baseline: 6/11 (54.55%)');
    expect(result.stdout).toContain(
      '  1. add-case: A=0, B=0, C=1\n     +2, projected 8/11 (72.73%)',
    );
    expect(result.stdout).toContain(
      '  3. add-case: A=1, B=1, C=0\n     +1, projected 11/11 (100.00%)',
    );
    expect(result.stdout).toContain('Stopped because the target was reached.');
    const written = JSON.parse(readFileSync(out, 'utf8')) as {
      kind: string;
      toolVersion: string;
      recommendations: { indices: number[] }[];
    };
    expect(written.kind).toBe('suggestions');
    expect(written.toolVersion).toBe('9.9.9-test');
    expect(written.recommendations.map((r) => r.indices.join(''))).toEqual(['001', '010', '110']);
  });

  test('returns a partial list with exit 0, or exit 1 with --require-target', () => {
    const partial = suggest('--max-new-cases', '1');
    expect(partial.code).toBe(0);
    expect(partial.stdout).toContain('Stopped because the case budget ran out before the target.');
    expect(partial.stdout).toContain('Still missing: 3');

    const required = runCli(
      'suggest',
      '--model',
      model,
      '--cases',
      cases,
      '--out',
      join(dir, 'required.json'),
      '--max-new-cases',
      '1',
      '--require-target',
    );
    expect(required.code).toBe(1);
  });

  test('stops at a lower target', () => {
    const result = suggest('--target', '72.727');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('  1. add-case');
    expect(result.stdout).not.toContain('  2. ');
  });

  test('refuses to replace an existing file without --force', () => {
    writeFileSync(out, 'keep');
    expect(suggest().code).toBe(2);
    expect(readFileSync(out, 'utf8')).toBe('keep');
    expect(suggest('--force').code).toBe(0);
  });

  test.each([
    [['--max-new-cases', '0'], 'Invalid --max-new-cases "0"'],
    [['--max-new-cases', '2.5'], 'Invalid --max-new-cases'],
    [['--target', '100.5'], 'Invalid coverage threshold'],
    [['--basis', 'lines'], 'Unknown basis "lines"'],
    [['--basis', 'observed'], 'requires --run'],
    [['--run', 'run.json'], '--run is only used with --basis observed or passed'],
  ])('rejects %j with exit 2', (args, message) => {
    const result = suggest(...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  test('starts from a runtime report and recommends reruns', () => {
    const run = join(dir, 'run.json');
    writeFileSync(
      run,
      formatReport(
        createRuntimeReport({
          model: golden,
          matrix: { schemaVersion: 1, modelId: 'golden', cases: rows },
          evidence: evidence([
            testEntry(rows[0]?.id ?? ''),
            testEntry(rows[1]?.id ?? '', { outcome: 'failed', checkpointAttempts: [] }),
          ]),
          toolVersion: 'test',
        }),
      ),
    );
    writeFileSync(cases, JSON.stringify({ schemaVersion: 1, modelId: 'golden', cases: rows }));
    const result = suggest('--basis', 'observed', '--run', run);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('basis observed from run run-1');
    expect(result.stdout).toContain(`rerun-existing (existing: ${rows[1]?.id ?? ''}, failed)`);
  });

  test('refuses a static report or an incomplete run as --run', () => {
    const report = join(dir, 'static.json');
    expect(runCli('analyze', '--model', model, '--cases', cases, '--json', report).code).toBe(0);
    const fromStatic = suggest('--basis', 'observed', '--run', report);
    expect(fromStatic.code).toBe(2);
    expect(fromStatic.stderr).toContain('is a static report');

    const incomplete = join(dir, 'incomplete.json');
    writeFileSync(
      incomplete,
      formatReport(
        createRuntimeReport({
          model: golden,
          matrix: { schemaVersion: 1, modelId: 'golden', cases: rows },
          evidence: evidence([testEntry(rows[0]?.id ?? '', { outcome: 'missing' })]),
          toolVersion: 'test',
        }),
      ),
    );
    writeFileSync(cases, JSON.stringify({ schemaVersion: 1, modelId: 'golden', cases: rows }));
    expect(suggest('--basis', 'passed', '--run', incomplete).code).toBe(3);
  });

  test('builds a pairwise suite from scratch and writes it as a matrix', () => {
    const scratch = exampleDir('os-cpu-protocol', ['model.json']);
    const generated = join(scratch, 'generated.json');
    const result = runCli(
      'suggest',
      '--model',
      join(scratch, 'model.json'),
      '--out',
      join(scratch, 'suggestions.json'),
      '--matrix-out',
      generated,
      '--max-new-cases',
      '20',
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Baseline: 0/12 (0.00%)');
    expect(result.stdout).toContain(`Matrix with 4 added cases written to ${generated}`);
    const matrix = JSON.parse(readFileSync(generated, 'utf8')) as { cases: { id: string }[] };
    expect(matrix.cases.map((c) => c.id)).toEqual([
      'suggested-001',
      'suggested-002',
      'suggested-003',
      'suggested-004',
    ]);
    // The generated matrix is a valid input and covers every pair with four tests.
    const analysed = runCli(
      'analyze',
      '--model',
      join(scratch, 'model.json'),
      '--cases',
      generated,
    );
    expect(analysed.stdout).toContain('declared  12/12 (100.00%)');
  });

  test('appends new cases to the existing ones without reusing an id', () => {
    writeFileSync(
      cases,
      JSON.stringify({
        schemaVersion: 1,
        modelId: 'golden',
        cases: [
          { id: 'suggested-001', values: { A: 0, B: 0, C: 0 } },
          { id: 'all-one', values: { A: 1, B: 1, C: 1 } },
        ],
      }),
    );
    const combined = join(dir, 'combined.json');
    expect(suggest('--matrix-out', combined).code).toBe(0);
    const matrix = JSON.parse(readFileSync(combined, 'utf8')) as { cases: { id: string }[] };
    expect(matrix.cases.map((c) => c.id)).toEqual([
      'suggested-001',
      'all-one',
      'suggested-002',
      'suggested-003',
      'suggested-004',
    ]);
  });

  test('keeps the two outputs apart and requires --cases with --run', () => {
    expect(suggest('--matrix-out', out).stderr).toContain('must be different files');
    expect(suggest('--matrix-out', cases, '--force').stderr).toContain('OUTPUT_IS_INPUT');
    const noCases = runCli(
      'suggest',
      '--model',
      model,
      '--out',
      out,
      '--basis',
      'observed',
      '--run',
      'r.json',
    );
    expect(noCases.code).toBe(2);
    expect(noCases.stderr).toContain('--run needs --cases');
  });

  test('requires --out', () => {
    const result = runCli('suggest', '--model', model, '--cases', cases);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Missing --out');
  });

  test('never writes over an input', () => {
    const before = readFileSync(model, 'utf8');
    const result = runCli('suggest', '--model', model, '--cases', cases, '--out', model, '--force');
    expect(result.code).toBe(2);
    expect(readFileSync(model, 'utf8')).toBe(before);
  });

  test('shows help and exits 0', () => {
    expect(runCli('suggest', '--help')).toMatchObject({ code: 0 });
  });
});
