/** A single value of a parameter domain. Each domain holds one type. */
export type DomainValue = string | number | boolean;

/**
 * How many parameters an interaction combines: 2 is pairwise, 3 is
 * three-way, and so on up to 6, the highest interaction strength at
 * which empirical studies have found faults.
 */
export type Strength = 2 | 3 | 4 | 5 | 6;

export const MIN_STRENGTH = 2;
export const MAX_STRENGTH = 6;

/** A constraint expression. Each expression object has exactly one operator. */
export type Expression =
  | { readonly eq: readonly [string, DomainValue] }
  | { readonly not: Expression }
  | { readonly and: readonly Expression[] }
  | { readonly or: readonly Expression[] }
  | { readonly implies: readonly [Expression, Expression] };

export interface Constraint {
  readonly id: string;
  readonly rule: Expression;
}

/** A model as written in JSON, before validation. */
export interface ModelInput {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly strength: Strength;
  readonly parameters: Readonly<Record<string, readonly DomainValue[]>>;
  readonly constraints?: readonly Constraint[];
}

export interface Parameter {
  readonly name: string;
  /** Domain values in their declared order. */
  readonly values: readonly DomainValue[];
  /** Position of each value in `values`; lookups are type-strict. */
  readonly valueIndex: ReadonlyMap<DomainValue, number>;
}

/**
 * A validated model. Parameters are in canonical order: sorted by name
 * using UTF-16 code units, independent of locale. Domain and constraint
 * order are kept as declared.
 */
export interface Model {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly strength: Strength;
  readonly parameters: readonly Parameter[];
  readonly parameterIndex: ReadonlyMap<string, number>;
  readonly constraints: readonly Constraint[];
}

/** Locale-independent ordering by UTF-16 code units. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
