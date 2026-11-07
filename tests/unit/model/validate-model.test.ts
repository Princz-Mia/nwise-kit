import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { DEFAULT_LIMITS, resolveLimits } from '../../../src/model/limits.js';
import { parseJson } from '../../../src/model/json.js';
import { validateModel } from '../../../src/model/validate-model.js';

const checkout = {
  schemaVersion: 1,
  id: 'checkout-access',
  strength: 2,
  parameters: {
    role: ['guest', 'member', 'admin'],
    plan: ['free', 'premium'],
    newCheckout: [false, true],
    region: ['EU', 'US'],
  },
  constraints: [
    {
      id: 'guest-has-free-plan',
      rule: { implies: [{ eq: ['role', 'guest'] }, { eq: ['plan', 'free'] }] },
    },
  ],
};

function withChanges(changes: Record<string, unknown>): Record<string, unknown> {
  return { ...checkout, ...changes };
}

function rejection(input: unknown, limits = DEFAULT_LIMITS): NwiseKitError {
  try {
    validateModel(input, limits);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected validateModel to throw');
}

function issues(input: unknown, limits = DEFAULT_LIMITS): [string, string | undefined][] {
  return rejection(input, limits).diagnostics.map((d) => [d.code, d.path]);
}

describe('validateModel', () => {
  test('returns parameters in UTF-16 code unit order with declared domain order', () => {
    const model = validateModel(checkout);
    expect(model.parameters.map((p) => p.name)).toEqual(['newCheckout', 'plan', 'region', 'role']);
    expect(model.parameters[3]?.values).toEqual(['guest', 'member', 'admin']);
    expect(model.parameterIndex.get('role')).toBe(3);
    expect(model.constraints).toEqual(checkout.constraints);
  });

  test('sorts names by code unit, not by locale', () => {
    const model = validateModel(
      withChanges({ parameters: { b: [1], B: [1], a: [1], é: [1] }, constraints: [] }),
    );
    expect(model.parameters.map((p) => p.name)).toEqual(['B', 'a', 'b', 'é']);
  });

  test('treats missing constraints as an empty list', () => {
    const { constraints: _omitted, ...rest } = checkout;
    expect(validateModel(rest).constraints).toEqual([]);
  });

  test('normalises -0 in domains and constraints', () => {
    const model = validateModel(
      parseJson(
        '{"schemaVersion":1,"id":"m","strength":2,"parameters":{"a":[-0,1],"b":[1]},' +
          '"constraints":[{"id":"c","rule":{"eq":["a",-0]}}]}',
      ),
    );
    expect(Object.is(model.parameters[0]?.values[0], 0)).toBe(true);
    expect(model.constraints[0]?.rule).toEqual({ eq: ['a', 0] });
  });

  test('rejects an unsupported schema version on its own', () => {
    const error = rejection(withChanges({ schemaVersion: 2 }));
    expect(error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  test('rejects unknown and missing keys', () => {
    const { id: _id, ...noId } = checkout;
    expect(issues({ ...noId, strenght: 2 })).toEqual([
      ['UNKNOWN_KEY', '/strenght'],
      ['MISSING_KEY', ''],
    ]);
  });

  test.each([
    [{ a: [], b: [1] }, 'EMPTY_DOMAIN', '/parameters/a'],
    [{ a: [1, 2, 1], b: [1] }, 'DUPLICATE_VALUE', '/parameters/a/2'],
    [{ a: [0, -0], b: [1] }, 'DUPLICATE_VALUE', '/parameters/a/1'],
    [{ a: [1, '1'], b: [1] }, 'MIXED_DOMAIN_TYPES', '/parameters/a/1'],
    [{ a: [null], b: [1] }, 'INVALID_VALUE', '/parameters/a/0'],
    [{ a: [[1]], b: [1] }, 'INVALID_VALUE', '/parameters/a/0'],
    [{ a: [{}], b: [1] }, 'INVALID_VALUE', '/parameters/a/0'],
    [{ a: [Infinity], b: [1] }, 'INVALID_VALUE', '/parameters/a/0'],
    [{ a: [2 ** 53], b: [1] }, 'UNSAFE_INTEGER', '/parameters/a/0'],
    [{ a: ['\uD800'], b: [1] }, 'INVALID_VALUE', '/parameters/a/0'],
    [{ a: 'x', b: [1] }, 'INVALID_TYPE', '/parameters/a'],
    [{ '': [1], b: [1] }, 'INVALID_IDENTIFIER', '/parameters/'],
  ])('rejects domain %j', (parameters, code, path) => {
    expect(issues(withChanges({ parameters, constraints: [] }))).toEqual([[code, path]]);
  });

  test('accepts non-integer numbers and booleans', () => {
    const model = validateModel(
      withChanges({ parameters: { a: [0.1, 0.2], b: [true, false] }, constraints: [] }),
    );
    expect(model.parameters[0]?.values).toEqual([0.1, 0.2]);
  });

  test.each([
    [1, 'UNSUPPORTED_STRENGTH'],
    [4, 'UNSUPPORTED_STRENGTH'],
    ['2', 'UNSUPPORTED_STRENGTH'],
  ])('rejects strength %j', (strength, code) => {
    expect(issues(withChanges({ strength }))).toEqual([[code, '/strength']]);
  });

  test('rejects a strength above the parameter count', () => {
    expect(
      issues(withChanges({ strength: 3, parameters: { a: [1], b: [1] }, constraints: [] })),
    ).toEqual([['STRENGTH_EXCEEDS_PARAMETERS', '/strength']]);
  });

  test('rejects more parameters than the limit allows', () => {
    const limits = resolveLimits({ maxParameters: 3 });
    expect(issues(checkout, limits)).toEqual([['TOO_MANY_PARAMETERS', '/parameters']]);
  });

  test.each([
    [{ eq: ['tier', 'gold'] }, 'UNKNOWN_PARAMETER', '/constraints/0/rule/eq/0'],
    [{ eq: ['role', 'owner'] }, 'VALUE_NOT_IN_DOMAIN', '/constraints/0/rule/eq/1'],
    [{ eq: ['newCheckout', 'true'] }, 'VALUE_NOT_IN_DOMAIN', '/constraints/0/rule/eq/1'],
    [{ eq: ['role'] }, 'INVALID_ARITY', '/constraints/0/rule/eq'],
    [{ eq: [1, 'guest'] }, 'INVALID_TYPE', '/constraints/0/rule/eq/0'],
    [{ and: [{ eq: ['role', 'guest'] }] }, 'INVALID_ARITY', '/constraints/0/rule/and'],
    [{ or: [] }, 'INVALID_ARITY', '/constraints/0/rule/or'],
    [{ implies: [{ eq: ['role', 'guest'] }] }, 'INVALID_ARITY', '/constraints/0/rule/implies'],
    [{ not: { xor: [] } }, 'INVALID_EXPRESSION', '/constraints/0/rule/not'],
    [
      { eq: ['role', 'guest'], not: { eq: ['role', 'guest'] } },
      'INVALID_EXPRESSION',
      '/constraints/0/rule',
    ],
    [{}, 'INVALID_EXPRESSION', '/constraints/0/rule'],
    ['role=guest', 'INVALID_EXPRESSION', '/constraints/0/rule'],
  ])('rejects rule %j', (rule, code, path) => {
    expect(issues(withChanges({ constraints: [{ id: 'c', rule }] }))).toEqual([[code, path]]);
  });

  test('reports every invalid operand, not only the first', () => {
    const rule = { or: [{ eq: ['tier', 1] }, { eq: ['role', 'owner'] }] };
    expect(issues(withChanges({ constraints: [{ id: 'c', rule }] }))).toEqual([
      ['UNKNOWN_PARAMETER', '/constraints/0/rule/or/0/eq/0'],
      ['VALUE_NOT_IN_DOMAIN', '/constraints/0/rule/or/1/eq/1'],
    ]);
  });

  test('rejects duplicate constraint ids and unknown constraint keys', () => {
    const rule = { eq: ['role', 'guest'] };
    expect(
      issues(
        withChanges({
          constraints: [
            { id: 'c', rule },
            { id: 'c', rule, note: 'x' },
          ],
        }),
      ),
    ).toEqual([
      ['UNKNOWN_KEY', '/constraints/1/note'],
      ['DUPLICATE_CONSTRAINT_ID', '/constraints/1/id'],
    ]);
  });

  test('rejects constraints nested deeper than the limit', () => {
    let rule: unknown = { eq: ['role', 'guest'] };
    for (let i = 1; i < 32; i++) {
      rule = { not: rule };
    }
    expect(() => validateModel(withChanges({ constraints: [{ id: 'c', rule }] }))).not.toThrow();
    const tooDeep = withChanges({ constraints: [{ id: 'c', rule: { not: rule } }] });
    expect(issues(tooDeep)[0]?.[0]).toBe('CONSTRAINT_TOO_DEEP');
  });

  test('rejects more constraint nodes than the limit, counted across constraints', () => {
    const rule = { and: [{ eq: ['role', 'guest'] }, { eq: ['plan', 'free'] }] };
    const constraints = [
      { id: 'a', rule },
      { id: 'b', rule },
    ];
    expect(() =>
      validateModel(withChanges({ constraints }), resolveLimits({ maxConstraintNodes: 6 })),
    ).not.toThrow();
    expect(issues(withChanges({ constraints }), resolveLimits({ maxConstraintNodes: 5 }))).toEqual([
      ['TOO_MANY_CONSTRAINT_NODES', '/constraints/1/rule/and/1'],
    ]);
  });

  test('ignores inherited properties', () => {
    const input = Object.create({ constraints: 'inherited' }) as Record<string, unknown>;
    Object.assign(input, { ...checkout, constraints: undefined });
    delete input['constraints'];
    expect(validateModel(input).constraints).toEqual([]);
  });
});
