/**
 * A deliberately naive reference for the recommendation search. Like the
 * brute-force coverage reference it shares no code with the engine: it
 * works on value maps and JSON-string keys, rescans every candidate on
 * every step and keeps sets instead of bitmaps.
 */
import type { Assignment, ReferenceModel } from './brute-force.js';
import { holds } from './brute-force.js';

export interface NaivePick {
  values: Assignment;
  gain: number;
}

/** Valid assignments in canonical order: names sorted, first name most significant. */
function validInCanonicalOrder(model: ReferenceModel): Assignment[] {
  const names = Object.keys(model.parameters).sort();
  let partials: Assignment[] = [{}];
  for (const name of names) {
    const next: Assignment[] = [];
    for (const partial of partials) {
      for (const value of model.parameters[name] ?? []) {
        next.push({ ...partial, [name]: value });
      }
    }
    partials = next;
  }
  return partials.filter((a) => model.constraints.every((c) => holds(c.rule, a)));
}

function combinations(names: string[], size: number): string[][] {
  if (size === 0) {
    return [[]];
  }
  return names.flatMap((name, i) =>
    combinations(names.slice(i + 1), size - 1).map((rest) => [name, ...rest]),
  );
}

function keysOf(a: Assignment, groups: string[][]): string[] {
  return groups.map((group) => JSON.stringify(group.map((name) => [name, a[name]])));
}

/**
 * Greedy supplementation to full coverage: repeatedly take the valid
 * assignment that adds the most uncovered interactions, the earliest in
 * canonical order on ties, until nothing is uncovered or the budget is
 * used up.
 */
export function naiveGreedy(
  model: ReferenceModel,
  rows: Assignment[],
  budget: number,
): NaivePick[] {
  const groups = combinations(Object.keys(model.parameters).sort(), model.strength);
  const candidates = validInCanonicalOrder(model);
  const uncovered = new Set(candidates.flatMap((a) => keysOf(a, groups)));
  for (const row of rows) {
    for (const key of keysOf(row, groups)) {
      uncovered.delete(key);
    }
  }
  const picks: NaivePick[] = [];
  while (uncovered.size > 0 && picks.length < budget) {
    let best: Assignment | undefined;
    let bestGain = 0;
    for (const candidate of candidates) {
      const gain = keysOf(candidate, groups).filter((key) => uncovered.has(key)).length;
      if (gain > bestGain) {
        best = candidate;
        bestGain = gain;
      }
    }
    if (best === undefined) {
      throw new Error('reference: uncovered interactions remain but no candidate helps');
    }
    for (const key of keysOf(best, groups)) {
      uncovered.delete(key);
    }
    picks.push({ values: best, gain: bestGain });
  }
  return picks;
}
