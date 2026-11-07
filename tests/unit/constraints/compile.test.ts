import { describe, expect, test } from 'vitest';
import {
  checkCasesSatisfyConstraints,
  compileConstraints,
  satisfiesAll,
} from '../../../src/constraints/compile.js';
import { NwiseKitError } from '../../../src/errors.js';
import { validateCases } from '../../../src/model/cases.js';
import type { Expression } from '../../../src/model/types.js';
import { validateModel } from '../../../src/model/validate-model.js';
import { checkout, golden, goldenRows } from '../../fixtures/models.js';

const p = { eq: ['A', 1] } as const;
const q = { eq: ['B', 1] } as const;

function truthTable(rule: Expression): string {
  const model = validateModel({ ...golden, constraints: [{ id: 'r', rule }] });
  const [compiled] = compileConstraints(model);
  const rows = ['00', '01', '10', '11'];
  return rows.map((ab) => (compiled?.test([Number(ab[0]), Number(ab[1]), 0]) ? '1' : '0')).join('');
}

describe('compileConstraints', () => {
  // Rows are (A, B) = 00, 01, 10, 11.
  test.each<[string, Expression, string]>([
    ['eq', p, '0011'],
    ['not', { not: p }, '1100'],
    ['and', { and: [p, q] }, '0001'],
    ['or', { or: [p, q] }, '0111'],
    ['implies', { implies: [p, q] }, '1101'],
    ['and of three', { and: [p, q, { not: { eq: ['C', 1] } }] }, '0001'],
    ['nested', { not: { implies: [p, { not: q }] } }, '0001'],
  ])('evaluates %s', (_name, rule, expected) => {
    expect(truthTable(rule)).toBe(expected);
  });

  test('compares values type-strictly through domain indices', () => {
    const model = validateModel({
      schemaVersion: 1,
      id: 'm',
      strength: 2,
      parameters: { flag: [false, true], n: [0, 1] },
      constraints: [{ id: 'c', rule: { eq: ['flag', true] } }],
    });
    const [compiled] = compileConstraints(model);
    expect(compiled?.test([1, 0])).toBe(true);
    expect(compiled?.test([0, 1])).toBe(false);
  });

  test('combines top-level constraints with AND, and an empty list allows all', () => {
    const both = validateModel({
      ...golden,
      constraints: [
        { id: 'a', rule: p },
        { id: 'b', rule: q },
      ],
    });
    expect(satisfiesAll(compileConstraints(both), [1, 1, 0])).toBe(true);
    expect(satisfiesAll(compileConstraints(both), [1, 0, 0])).toBe(false);
    const none = validateModel({ ...golden, constraints: [] });
    expect(satisfiesAll(compileConstraints(none), [1, 0, 0])).toBe(true);
  });
});

describe('checkCasesSatisfyConstraints', () => {
  test('accepts rows that satisfy every constraint', () => {
    const model = validateModel(golden);
    const cases = validateCases(goldenRows('000', '011', '110', '111'), model);
    expect(() => {
      checkCasesSatisfyConstraints(model, cases);
    }).not.toThrow();
  });

  test('rejects the matrix and names each broken constraint', () => {
    const model = validateModel(checkout);
    const rows = [
      { id: 'ok', values: { role: 'guest', plan: 'free', newCheckout: false, region: 'EU' } },
      { id: 'bad', values: { role: 'guest', plan: 'premium', newCheckout: false, region: 'EU' } },
    ];
    let error: unknown;
    try {
      checkCasesSatisfyConstraints(model, validateCases(rows, model));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(NwiseKitError);
    const { code, diagnostics } = error as NwiseKitError;
    expect(code).toBe('INVALID_MATRIX');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'CONSTRAINT_VIOLATION',
        path: '/cases/1',
        caseIds: ['bad'],
        message: 'Case "bad" violates "guest-has-free-plan"',
      }),
    ]);
  });
});
