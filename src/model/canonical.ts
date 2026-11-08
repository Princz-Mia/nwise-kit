import { createHash } from 'node:crypto';
import type { TestCase } from './cases.js';
import { caseValues } from './cases.js';
import type { Model, ModelInput } from './types.js';
import { compareCodeUnits } from './types.js';

/**
 * Serialises a JSON value canonically: object keys sorted by UTF-16 code
 * units, array order kept, -0 written as 0, no whitespace.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot represent a non-finite number');
    }
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot represent a ${typeof value}`);
}

/** SHA-256 of the UTF-8 encoding of `text`, as lowercase hex. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The normalised model in its JSON form, with constraints always present. */
export function modelToJson(model: Model): ModelInput {
  const parameters: Record<string, readonly (string | number | boolean)[]> = {};
  for (const parameter of model.parameters) {
    Object.defineProperty(parameters, parameter.name, {
      value: parameter.values,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return {
    schemaVersion: model.schemaVersion,
    id: model.id,
    strength: model.strength,
    parameters,
    constraints: model.constraints,
  };
}

/**
 * Identifies the full normalised model: schema version, id, strength,
 * domains and constraints. Reordering constraints changes the hash.
 */
export function modelHash(model: Model): string {
  return sha256(canonicalJson(modelToJson(model)));
}

/** Identifies a matrix under a model. Row order does not affect it. */
export function matrixHash(model: Model, cases: readonly TestCase[]): string {
  const rows = [...cases]
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map((c) => ({ id: c.id, values: caseValues(model, c.indices) }));
  return sha256(canonicalJson({ modelHash: modelHash(model), cases: rows }));
}
