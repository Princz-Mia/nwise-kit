import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../src/errors.js';
import { validateMatrix } from '../../src/model/cases.js';
import { parseJson } from '../../src/model/json.js';
import { validateModel } from '../../src/model/validate-model.js';
import { checkout, golden } from '../fixtures/models.js';

function read(path: string): unknown {
  return parseJson(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
const modelSchema = ajv.compile(read('schemas/model.schema.json') as object);
const matrixSchema = ajv.compile(read('schemas/matrix.schema.json') as object);

function rejectedByValidator(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return true;
    }
    throw error;
  }
}

const examples = readdirSync(new URL('../../examples/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('model schema', () => {
  test.each(examples)('accepts the %s example model', (dir) => {
    expect(modelSchema(read(`examples/${dir}/model.json`))).toBe(true);
  });

  // Structural mistakes must be caught by both the schema and the validator.
  test.each<[string, unknown]>([
    ['an unknown key', { ...golden, strenght: 2 }],
    ['a missing id', { ...golden, id: undefined }],
    ['schema version 2', { ...golden, schemaVersion: 2 }],
    ['strength 4', { ...golden, strength: 4 }],
    ['an empty domain', { ...golden, parameters: { ...golden.parameters, A: [] } }],
    ['a repeated value', { ...golden, parameters: { ...golden.parameters, A: [0, 0] } }],
    ['mixed value types', { ...golden, parameters: { ...golden.parameters, A: [0, '1'] } }],
    ['a null value', { ...golden, parameters: { ...golden.parameters, A: [null] } }],
    ['a nested value', { ...golden, parameters: { ...golden.parameters, A: [[0]] } }],
    ['an empty parameter name', { ...golden, parameters: { ...golden.parameters, '': [0] } }],
    [
      'two operators in one rule',
      { ...golden, constraints: [{ id: 'c', rule: { eq: ['A', 0], not: { eq: ['A', 1] } } }] },
    ],
    ['an unknown operator', { ...golden, constraints: [{ id: 'c', rule: { xor: [] } }] }],
    [
      'a one-operand and',
      { ...golden, constraints: [{ id: 'c', rule: { and: [{ eq: ['A', 0] }] } }] },
    ],
    [
      'a three-operand implies',
      {
        ...golden,
        constraints: [
          { id: 'c', rule: { implies: [{ eq: ['A', 0] }, { eq: ['A', 0] }, { eq: ['A', 0] }] } },
        ],
      },
    ],
    ['a short eq', { ...golden, constraints: [{ id: 'c', rule: { eq: ['A'] } }] }],
    [
      'an extra constraint key',
      { ...golden, constraints: [{ id: 'c', rule: { eq: ['A', 0] }, note: '' }] },
    ],
  ])('rejects %s', (_name, input) => {
    const cleaned = JSON.parse(JSON.stringify(input)) as unknown;
    expect(modelSchema(cleaned)).toBe(false);
    expect(rejectedByValidator(() => validateModel(cleaned))).toBe(true);
  });

  test('leaves semantic checks to the validator', () => {
    const unknownParameter = { ...golden, constraints: [{ id: 'c', rule: { eq: ['D', 0] } }] };
    expect(modelSchema(unknownParameter)).toBe(true);
    expect(rejectedByValidator(() => validateModel(unknownParameter))).toBe(true);
  });
});

describe('matrix schema', () => {
  const matrices = examples.flatMap((dir) =>
    readdirSync(new URL(`../../examples/${dir}/`, import.meta.url))
      .filter((name) => name.startsWith('cases'))
      .map((name) => `${dir}/${name}`),
  );

  test.each(matrices)('accepts %s', (path) => {
    expect(matrixSchema(read(`examples/${path}`))).toBe(true);
  });

  const model = validateModel(checkout);
  const values = { role: 'guest', plan: 'free', newCheckout: false, region: 'EU' };
  const matrix = { schemaVersion: 1, modelId: 'checkout-access', cases: [{ id: 'a', values }] };

  test.each<[string, unknown]>([
    ['an unknown key', { ...matrix, extra: 1 }],
    ['a missing model id', { schemaVersion: 1, cases: [] }],
    ['an unknown case key', { ...matrix, cases: [{ id: 'a', values, note: '' }] }],
    ['an empty case id', { ...matrix, cases: [{ id: '', values }] }],
    ['a null value', { ...matrix, cases: [{ id: 'a', values: { ...values, region: null } }] }],
  ])('rejects %s', (_name, input) => {
    expect(matrixSchema(input)).toBe(false);
    expect(rejectedByValidator(() => validateMatrix(input, model))).toBe(true);
  });
});
