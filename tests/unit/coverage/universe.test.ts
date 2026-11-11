import { describe, expect, test } from 'vitest';
import { CoverageSet } from '../../../src/coverage/coverage.js';
import { buildUniverse, cellOf, decodeCell } from '../../../src/coverage/universe.js';
import { DEFAULT_LIMITS } from '../../../src/model/limits.js';
import { validateModel } from '../../../src/model/validate-model.js';
import { golden } from '../../fixtures/models.js';

const model = validateModel(golden);

describe('buildUniverse', () => {
  test('keeps the six valid golden configurations in canonical order', () => {
    const universe = buildUniverse(model, DEFAULT_LIMITS);
    const configs = Array.from({ length: universe.validConfigurations }, (_, i) =>
      Array.from(universe.configurations.subarray(i * 3, i * 3 + 3)).join(''),
    );
    expect(configs).toEqual(['000', '001', '010', '011', '110', '111']);
    expect(universe.rawConfigurations).toBe(8);
  });

  test('derives 3 + 4 + 4 valid pairs', () => {
    const universe = buildUniverse(model, DEFAULT_LIMITS);
    expect(universe.groups.map((g) => g.parameters)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
    expect(universe.groupTotals).toEqual([3, 4, 4]);
    expect(universe.interactions).toBe(11);
  });

  test('holds every strength from single values up to the model strength', () => {
    const universe = buildUniverse(validateModel({ ...golden, strength: 3 }), DEFAULT_LIMITS);
    expect(universe.levels.map((l) => [l.strength, l.groups.length, l.interactions])).toEqual([
      [1, 3, 6],
      [2, 3, 11],
      [3, 1, 6],
    ]);
    expect(universe.interactions).toBe(6);
    expect(universe.levels.at(-1)?.groups).toBe(universe.groups);
  });

  test('encodes and decodes group cells with the first parameter most significant', () => {
    const wide = validateModel({ ...golden, parameters: { A: [0, 1], B: [0, 1, 2], C: [0, 1] }, constraints: [] });
    const universe = buildUniverse(wide, DEFAULT_LIMITS);
    const ab = universe.groups[0];
    if (ab === undefined) {
      throw new Error('missing group');
    }
    expect(ab.strides).toEqual([3, 1]);
    expect(cellOf(ab, [1, 2, 0])).toBe(5);
    expect(decodeCell(ab, 5)).toEqual([1, 2]);
  });
});

describe('CoverageSet', () => {
  test('counts golden rows 000 and 111 as 6 of 11 and duplicates once', () => {
    const covered = new CoverageSet(buildUniverse(model, DEFAULT_LIMITS));
    expect(covered.add([0, 0, 0])).toBe(3);
    expect(covered.add([1, 1, 1])).toBe(3);
    expect(covered.add([0, 0, 0])).toBe(0);
    expect(covered.metric()).toEqual({ covered: 6, total: 11, percentage: 600 / 11 });
    expect(covered.groupMetrics().map((m) => [m.covered, m.total])).toEqual([
      [2, 3],
      [2, 4],
      [2, 4],
    ]);
    expect(covered.missing().map((m) => `${m.parameters.join('')}=${m.indices.join('')}`)).toEqual([
      'AB=01',
      'AC=01',
      'AC=10',
      'BC=01',
      'BC=10',
    ]);
  });

  test('refuses a configuration outside the valid universe', () => {
    const covered = new CoverageSet(buildUniverse(model, DEFAULT_LIMITS));
    expect(() => covered.add([1, 0, 0])).toThrow(/Internal error/);
  });
});
