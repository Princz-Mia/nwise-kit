import type { DomainValue } from '../model/types.js';
import type { Group, Level, Universe } from './universe.js';
import { cellOf, decodeCell } from './universe.js';

/** Exact coverage counts. `percentage` is derived; the counts are authoritative. */
export interface Metric {
  readonly covered: number;
  readonly total: number;
  readonly percentage: number;
}

/** A combination of values for `t` distinct parameters. */
export interface Interaction {
  /** Parameter names in canonical order. */
  readonly parameters: readonly string[];
  readonly values: readonly DomainValue[];
  /** Domain index of each value, which identifies the interaction exactly. */
  readonly indices: readonly number[];
}

export function metric(covered: number, total: number): Metric {
  return { covered, total, percentage: (covered * 100) / total };
}

/**
 * The interactions of one strength covered by a set of valid
 * configurations, by default at the model strength. Adding the same
 * configuration twice changes nothing, so duplicates never count.
 */
export class CoverageSet {
  private readonly bits: Uint8Array[];
  private readonly perGroup: number[];
  private count = 0;

  constructor(
    private readonly universe: Universe,
    private readonly level: Level = universe,
  ) {
    this.bits = level.groups.map((g) => new Uint8Array(g.size));
    this.perGroup = level.groups.map(() => 0);
  }

  /** Marks the interactions of a valid configuration; returns how many were new. */
  add(x: ArrayLike<number>): number {
    let added = 0;
    this.level.groups.forEach((group, g) => {
      const cell = cellOf(group, x);
      const bits = this.bits[g] as Uint8Array;
      if (bits[cell] === 0) {
        if (this.level.valid[g]?.[cell] !== 1) {
          throw new Error('Internal error: a validated configuration projects to an invalid interaction');
        }
        bits[cell] = 1;
        this.perGroup[g] = (this.perGroup[g] ?? 0) + 1;
        added++;
      }
    });
    this.count += added;
    return added;
  }

  /** Whether an interaction, given by group and cell, is covered. */
  has(group: number, cell: number): boolean {
    return this.bits[group]?.[cell] === 1;
  }

  get covered(): number {
    return this.count;
  }

  /** Overall coverage: covered interactions over valid interactions, summed across groups. */
  metric(): Metric {
    return metric(this.count, this.level.interactions);
  }

  groupMetrics(): Metric[] {
    return this.level.groupTotals.map((total, g) => metric(this.perGroup[g] ?? 0, total));
  }

  /** Valid interactions not covered, by group order and then by domain indices. */
  missing(): Interaction[] {
    const result: Interaction[] = [];
    this.level.groups.forEach((group, g) => {
      const valid = this.level.valid[g] as Uint8Array;
      const bits = this.bits[g] as Uint8Array;
      for (let cell = 0; cell < group.size; cell++) {
        if (valid[cell] === 1 && bits[cell] === 0) {
          result.push(describeInteraction(this.universe, group, cell));
        }
      }
    });
    return result;
  }
}

export function describeInteraction(universe: Universe, group: Group, cell: number): Interaction {
  const indices = decodeCell(group, cell);
  const parameters = group.parameters.map((p) => universe.model.parameters[p]);
  return {
    parameters: parameters.map((p) => p?.name ?? ''),
    values: parameters.map((p, i) => p?.values[indices[i] ?? 0] ?? ''),
    indices,
  };
}
