import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { caseValues, validateCases, validateMatrix } from '../../../src/model/cases.js';
import { validateModel } from '../../../src/model/validate-model.js';
import { checkout } from '../../fixtures/models.js';

const model = validateModel(checkout);
const guest = { role: 'guest', plan: 'free', newCheckout: false, region: 'EU' };

function rejection(run: () => unknown): NwiseKitError {
  try {
    run();
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a NwiseKitError');
}

function issues(cases: unknown): [string, string | undefined][] {
  const error = rejection(() => validateCases(cases, model));
  expect(error.code).toBe('INVALID_MATRIX');
  return error.diagnostics.map((d) => [d.code, d.path]);
}

describe('validateCases', () => {
  test('maps values to domain indices in canonical parameter order', () => {
    const [row] = validateCases([{ id: 'g', values: { ...guest, role: 'admin' } }], model);
    // Canonical order: newCheckout, plan, region, role.
    expect(row).toEqual({ id: 'g', indices: [0, 0, 0, 2], path: '/cases/0' });
    expect(caseValues(model, row?.indices ?? [])).toEqual({ ...guest, role: 'admin' });
  });

  test('accepts an empty matrix', () => {
    expect(validateCases([], model)).toEqual([]);
  });

  test('allows identical configurations under different ids', () => {
    const rows = [
      { id: 'a', values: guest },
      { id: 'b', values: guest },
    ];
    expect(validateCases(rows, model)).toHaveLength(2);
  });

  test('rejects a partial row', () => {
    const { region: _region, ...partial } = guest;
    expect(issues([{ id: 'a', values: partial }])).toEqual([
      ['MISSING_PARAMETER', '/cases/0/values'],
    ]);
  });

  test('rejects an extra parameter', () => {
    expect(issues([{ id: 'a', values: { ...guest, tier: 'gold' } }])).toEqual([
      ['UNKNOWN_PARAMETER', '/cases/0/values/tier'],
    ]);
  });

  test('rejects a duplicate case id', () => {
    const rows = [
      { id: 'a', values: guest },
      { id: 'a', values: { ...guest, region: 'US' } },
    ];
    expect(issues(rows)).toEqual([['DUPLICATE_CASE_ID', '/cases/1/id']]);
  });

  test.each([
    [{ ...guest, role: 'owner' }, 'VALUE_NOT_IN_DOMAIN', '/cases/0/values/role'],
    [{ ...guest, newCheckout: 'false' }, 'VALUE_NOT_IN_DOMAIN', '/cases/0/values/newCheckout'],
    [{ ...guest, region: null }, 'INVALID_VALUE', '/cases/0/values/region'],
  ])('rejects values %j', (values, code, path) => {
    expect(issues([{ id: 'a', values }])).toEqual([[code, path]]);
  });

  test.each([
    [{ values: guest }, 'MISSING_KEY', '/cases/0'],
    [{ id: '', values: guest }, 'INVALID_IDENTIFIER', '/cases/0/id'],
    [{ id: 'a', values: guest, note: 'x' }, 'UNKNOWN_KEY', '/cases/0/note'],
    [{ id: 'a', values: [] }, 'INVALID_TYPE', '/cases/0/values'],
    ['a', 'INVALID_TYPE', '/cases/0'],
  ])('rejects row %j', (row, code, path) => {
    expect(issues([row])).toEqual([[code, path]]);
  });

  test('rejects cases that are not an array', () => {
    expect(issues({})).toEqual([['INVALID_TYPE', '/cases']]);
  });

  test('reports problems in every row', () => {
    const rows = [
      { id: 'a', values: { ...guest, role: 1 } },
      { id: 'b', values: {} },
    ];
    expect(issues(rows)).toHaveLength(5);
  });
});

describe('validateMatrix', () => {
  const matrix = {
    schemaVersion: 1,
    modelId: 'checkout-access',
    cases: [{ id: 'g', values: guest }],
  };

  test('returns the validated cases', () => {
    expect(validateMatrix(matrix, model).map((c) => c.id)).toEqual(['g']);
  });

  test('rejects a matrix for another model', () => {
    const error = rejection(() => validateMatrix({ ...matrix, modelId: 'other' }, model));
    expect(error.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['MODEL_ID_MISMATCH', '/modelId'],
    ]);
  });

  test('rejects an unsupported schema version', () => {
    const error = rejection(() => validateMatrix({ ...matrix, schemaVersion: 2 }, model));
    expect(error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  test('rejects unknown keys', () => {
    const error = rejection(() => validateMatrix({ ...matrix, extra: true }, model));
    expect(error.diagnostics.map((d) => d.code)).toEqual(['UNKNOWN_KEY']);
  });
});
