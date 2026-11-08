import type { CompiledConstraint } from '../constraints/compile.js';
import { compileConstraints, satisfiesAll } from '../constraints/compile.js';
import { NwiseKitError } from '../errors.js';
import type { Diagnostic } from '../errors.js';
import type { Limits } from '../model/limits.js';
import { appendPointer } from '../model/pointer.js';
import type { Model } from '../model/types.js';

/**
 * Upper bound on interaction cells (valid or not) held in memory across
 * all parameter groups, so the bitmaps can never grow without limit.
 */
export const MAX_INTERACTION_CELLS = 1 << 26;

/** How often, in enumerated assignments, the wall clock is checked. */
const CLOCK_INTERVAL = 4096;

/** A set of `t` parameters whose value combinations form interactions. */
export interface Group {
  /** Parameter positions in canonical order, ascending. */
  readonly parameters: readonly number[];
  /** Mixed-radix weight of each parameter; the first is most significant. */
  readonly strides: readonly number[];
  /** Number of value combinations, valid or not. */
  readonly size: number;
}

/** The exact set of valid configurations and interactions of a model. */
export interface Universe {
  readonly model: Model;
  readonly strength: number;
  readonly rawConfigurations: number;
  /** Valid configurations in canonical enumeration order, `n` indices each. */
  readonly configurations: Int32Array;
  readonly validConfigurations: number;
  readonly groups: readonly Group[];
  /** Per group, 1 for each cell that is a valid interaction. */
  readonly valid: readonly Uint8Array[];
  readonly groupTotals: readonly number[];
  readonly interactions: number;
  /** Warnings such as domain values no valid configuration uses. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface UniverseOptions {
  /** Millisecond clock; replaceable so tests can exercise the time limit. */
  readonly now?: () => number;
}

/**
 * Enumerates every complete assignment in canonical order, keeps those
 * that satisfy all constraints and derives every valid interaction of
 * the model strength. An interaction is valid only if some valid
 * configuration contains it, so feasibility is global.
 *
 * Throws instead of returning a partial universe when a limit is hit.
 */
export function buildUniverse(
  model: Model,
  limits: Limits,
  options: UniverseOptions = {},
): Universe {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const sizes = model.parameters.map((p) => p.values.length);
  const n = sizes.length;
  const strength = model.strength;

  const raw = sizes.reduce((product, size) => product * BigInt(size), 1n);
  if (raw > BigInt(limits.maxRawConfigurations)) {
    throw new NwiseKitError(
      'LIMIT_EXCEEDED',
      `The model has ${raw.toString()} raw configurations; the limit is ${String(limits.maxRawConfigurations)}`,
      [
        {
          code: 'RAW_CONFIGURATIONS_EXCEEDED',
          severity: 'error',
          message: 'The Cartesian product is too large to enumerate exactly',
          path: '/parameters',
          hint: 'Reduce parameters or domain values, or raise maxRawConfigurations.',
        },
      ],
    );
  }

  const groups = buildGroups(sizes, strength);
  const cells = groups.reduce((sum, g) => sum + g.size, 0);
  if (cells > MAX_INTERACTION_CELLS) {
    throw incomplete(
      'INTERACTION_CELLS_EXCEEDED',
      `The parameter groups have ${String(cells)} value combinations; at most ${String(MAX_INTERACTION_CELLS)} fit in memory`,
    );
  }
  const valid = groups.map((g) => new Uint8Array(g.size));
  const groupTotals = groups.map(() => 0);
  const reachable = sizes.map((size) => new Uint8Array(size));
  const constraints: readonly CompiledConstraint[] = compileConstraints(model);

  const found: number[] = [];
  let validCount = 0;
  let interactions = 0;
  const x = new Int32Array(n);
  let visited = 0;
  const total = Number(raw);

  for (let k = 0; k < total; k++) {
    if (++visited === CLOCK_INTERVAL) {
      visited = 0;
      if (now() - started > limits.analysisTimeMs) {
        throw incomplete(
          'ANALYSIS_TIME_EXCEEDED',
          `Enumeration did not finish within ${String(limits.analysisTimeMs)} ms`,
        );
      }
    }
    if (satisfiesAll(constraints, x)) {
      if (++validCount > limits.maxValidConfigurations) {
        throw incomplete(
          'VALID_CONFIGURATIONS_EXCEEDED',
          `The model has more than ${String(limits.maxValidConfigurations)} valid configurations`,
        );
      }
      for (let i = 0; i < n; i++) {
        found.push(x[i] ?? 0);
        const seen = reachable[i];
        if (seen !== undefined) {
          seen[x[i] ?? 0] = 1;
        }
      }
      for (let g = 0; g < groups.length; g++) {
        const cell = cellOf(groups[g] as Group, x);
        const bits = valid[g] as Uint8Array;
        if (bits[cell] === 0) {
          bits[cell] = 1;
          groupTotals[g] = (groupTotals[g] ?? 0) + 1;
          if (++interactions > limits.maxInteractions) {
            throw incomplete(
              'INTERACTIONS_EXCEEDED',
              `The model has more than ${String(limits.maxInteractions)} valid interactions`,
            );
          }
        }
      }
    }
    advance(x, sizes);
  }
  if (now() - started > limits.analysisTimeMs) {
    throw incomplete(
      'ANALYSIS_TIME_EXCEEDED',
      `Enumeration did not finish within ${String(limits.analysisTimeMs)} ms`,
    );
  }

  if (validCount === 0) {
    throw new NwiseKitError('UNSATISFIABLE_MODEL', 'No configuration satisfies every constraint', [
      {
        code: 'UNSATISFIABLE_MODEL',
        severity: 'error',
        message: 'The constraints together exclude every configuration',
        path: '/constraints',
        hint: 'Relax or remove a constraint; coverage of an empty space is undefined.',
      },
    ]);
  }

  return {
    model,
    strength,
    rawConfigurations: total,
    configurations: Int32Array.from(found),
    validConfigurations: validCount,
    groups,
    valid,
    groupTotals,
    interactions,
    diagnostics: unreachableValues(model, reachable),
  };
}

/** All `t`-element parameter sets in lexicographic order of positions. */
function buildGroups(sizes: readonly number[], t: number): Group[] {
  const groups: Group[] = [];
  const pick: number[] = [];
  const visit = (start: number): void => {
    if (pick.length === t) {
      const strides = pick.map(() => 1);
      let size = 1;
      for (let i = t - 1; i >= 0; i--) {
        strides[i] = size;
        size *= sizes[pick[i] ?? 0] ?? 1;
      }
      groups.push({ parameters: [...pick], strides, size });
      return;
    }
    for (let p = start; p < sizes.length; p++) {
      pick.push(p);
      visit(p + 1);
      pick.pop();
    }
  };
  visit(0);
  return groups;
}

/** The cell of a group that a complete assignment falls into. */
export function cellOf(group: Group, x: ArrayLike<number>): number {
  let cell = 0;
  for (let i = 0; i < group.parameters.length; i++) {
    cell += (x[group.parameters[i] ?? 0] ?? 0) * (group.strides[i] ?? 0);
  }
  return cell;
}

/** Domain indices of each group parameter for a cell. */
export function decodeCell(group: Group, cell: number): number[] {
  let rest = cell;
  return group.strides.map((stride) => {
    const index = Math.floor(rest / stride);
    rest -= index * stride;
    return index;
  });
}

/** Moves to the next assignment; the last parameter changes fastest. */
function advance(x: Int32Array, sizes: readonly number[]): void {
  for (let i = sizes.length - 1; i >= 0; i--) {
    const next = (x[i] ?? 0) + 1;
    if (next < (sizes[i] ?? 0)) {
      x[i] = next;
      return;
    }
    x[i] = 0;
  }
}

function unreachableValues(model: Model, reachable: readonly Uint8Array[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  model.parameters.forEach((parameter, p) => {
    parameter.values.forEach((value, v) => {
      if (reachable[p]?.[v] === 0) {
        diagnostics.push({
          code: 'UNREACHABLE_VALUE',
          severity: 'warning',
          message: `No valid configuration has ${parameter.name}=${JSON.stringify(value)}`,
          path: appendPointer(appendPointer('/parameters', parameter.name), v),
          hint: 'The constraints exclude this value entirely; remove it or relax a constraint.',
        });
      }
    });
  });
  return diagnostics;
}

function incomplete(code: string, message: string): NwiseKitError {
  return new NwiseKitError('ANALYSIS_INCOMPLETE', message, [
    {
      code,
      severity: 'error',
      message: `${message}; no partial result is reported`,
      hint: 'Reduce the model, or raise the corresponding limit if resources allow.',
    },
  ]);
}
