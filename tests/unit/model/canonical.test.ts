import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { validateCases } from '../../../src/model/cases.js';
import { canonicalJson, matrixHash, modelHash, sha256 } from '../../../src/model/canonical.js';
import { parseJson } from '../../../src/model/json.js';
import { validateModel } from '../../../src/model/validate-model.js';
import { checkout, golden, goldenRows } from '../../fixtures/models.js';

describe('canonicalJson', () => {
  test('sorts keys by UTF-16 code units, not code points', () => {
    // U+1F600 is stored as the surrogate pair D83D DE00, which sorts before U+FF5E.
    const value = { '～': 2, '\u{1F600}': 1, é: 'x', z: true, B: null };
    expect(canonicalJson(value)).toBe('{"B":null,"z":true,"é":"x","\u{1F600}":1,"～":2}');
  });

  test('keeps array order and nests', () => {
    expect(canonicalJson({ b: [3, 1, { y: 1, x: 2 }], a: [] })).toBe(
      '{"a":[],"b":[3,1,{"x":2,"y":1}]}',
    );
  });

  test('writes -0 as 0 and rejects non-finite numbers', () => {
    expect(canonicalJson([-0, 1.5, 1e21])).toBe('[0,1.5,1e+21]');
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });

  test('is stable through a parse round trip', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonicalJson(value);
        expect(canonicalJson(parseJson(text))).toBe(text);
      }),
    );
  });

  test('hashes the UTF-8 bytes', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const utf8 = createHash('sha256')
      .update(Buffer.from([0xc3, 0xa9]))
      .digest('hex');
    expect(sha256('é')).toBe(utf8);
  });
});

describe('modelHash', () => {
  test('ignores key order', () => {
    const reordered = validateModel({
      constraints: checkout.constraints,
      parameters: {
        region: ['EU', 'US'],
        newCheckout: [false, true],
        plan: ['free', 'premium'],
        role: ['guest', 'member', 'admin'],
      },
      strength: 2,
      id: 'checkout-access',
      schemaVersion: 1,
    });
    expect(modelHash(reordered)).toBe(modelHash(validateModel(checkout)));
  });

  test('depends on constraint order', () => {
    const constraints = [...checkout.constraints, { id: 'eu', rule: { eq: ['region', 'EU'] } }];
    const forward = validateModel({ ...checkout, constraints });
    const backward = validateModel({ ...checkout, constraints: [...constraints].reverse() });
    expect(modelHash(backward)).not.toBe(modelHash(forward));
  });

  test('depends on domain order, strength and id', () => {
    const base = modelHash(validateModel(golden));
    const flipped = { ...golden, parameters: { ...golden.parameters, C: [1, 0] } };
    expect(modelHash(validateModel(flipped))).not.toBe(base);
    expect(modelHash(validateModel({ ...golden, strength: 3 }))).not.toBe(base);
    expect(modelHash(validateModel({ ...golden, id: 'other' }))).not.toBe(base);
  });

  test('treats a missing constraint list like an empty one', () => {
    const { constraints: _constraints, ...bare } = golden;
    const empty = validateModel({ ...golden, constraints: [] });
    expect(modelHash(validateModel(bare))).toBe(modelHash(empty));
  });
});

describe('matrixHash', () => {
  const model = validateModel(golden);

  test('does not depend on row order', () => {
    const rows = goldenRows('000', '111', '011');
    const forward = validateCases(rows, model);
    const backward = validateCases([...rows].reverse(), model);
    expect(matrixHash(model, backward)).toBe(matrixHash(model, forward));
  });

  test('depends on ids, values and the model', () => {
    const base = matrixHash(model, validateCases(goldenRows('000'), model));
    expect(matrixHash(model, validateCases(goldenRows('001'), model))).not.toBe(base);
    const renamed = [{ id: 'other', values: { A: 0, B: 0, C: 0 } }];
    expect(matrixHash(model, validateCases(renamed, model))).not.toBe(base);
    const strength3 = validateModel({ ...golden, strength: 3 });
    expect(matrixHash(strength3, validateCases(goldenRows('000'), strength3))).not.toBe(base);
  });
});
