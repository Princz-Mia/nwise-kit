import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { analyzeMatrix, parseJson, validateMatrix, validateModel } from '../../src/index.js';

function load(path: string): unknown {
  return parseJson(readFileSync(new URL(`../../examples/${path}`, import.meta.url), 'utf8'));
}

function analyze(dir: string, matrixFile: string) {
  const model = load(`${dir}/model.json`);
  const matrix = load(`${dir}/${matrixFile}`);
  // Matrix files must name their model and pass full validation.
  validateMatrix(matrix, validateModel(model));
  return analyzeMatrix({ model, cases: (matrix as { cases: unknown }).cases });
}

function profile(dir: string, matrixFile: string): [number, number, number][] {
  return analyze(dir, matrixFile).profile.map((p) => [
    p.strength,
    p.declared.covered,
    p.declared.total,
  ]);
}

function missing(dir: string, matrixFile: string): string[] {
  return analyze(dir, matrixFile).missing.declared.map((m) =>
    m.parameters.map((p, i) => `${p}=${String(m.values[i])}`).join(' & '),
  );
}

describe('examples', () => {
  test('golden', () => {
    expect(profile('golden', 'cases.json')).toEqual([
      [1, 6, 6],
      [2, 6, 11],
    ]);
    expect(missing('golden', 'cases.json')).toEqual([
      'A=0 & B=1',
      'A=0 & C=1',
      'A=1 & C=0',
      'B=0 & C=1',
      'B=1 & C=0',
    ]);
  });

  test('os-cpu-protocol: each option leaves half of the pairs missing', () => {
    expect(profile('os-cpu-protocol', 'cases.each-option.json')).toEqual([
      [1, 6, 6],
      [2, 6, 12],
    ]);
  });

  test('os-cpu-protocol: four tests cover every pair', () => {
    expect(profile('os-cpu-protocol', 'cases.pairwise.json')).toEqual([
      [1, 6, 6],
      [2, 12, 12],
    ]);
  });

  test('discount', () => {
    const analysis = analyze('discount', 'cases.json');
    expect(analysis.universe.validConfigurations).toBe(12);
    expect(profile('discount', 'cases.json')).toEqual([
      [1, 8, 8],
      [2, 9, 19],
    ]);
    expect(missing('discount', 'cases.json')).toContain('customer=registered & membership=none');
  });

  test('checkout', () => {
    expect(analyze('checkout', 'cases.json').universe.validConfigurations).toBe(20);
    expect(profile('checkout', 'cases.json')).toEqual([
      [1, 9, 9],
      [2, 20, 29],
    ]);
  });
});
