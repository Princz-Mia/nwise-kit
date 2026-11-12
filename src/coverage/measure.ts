import type { Interaction, Metric } from './coverage.js';
import { CoverageSet } from './coverage.js';
import type { Universe } from './universe.js';

/** Exact coverage of one set of configurations, at every level the analysis reports. */
export interface Measurement {
  /** At the model strength. */
  readonly metric: Metric;
  /** At each strength from 1 to the model strength. */
  readonly profile: readonly Metric[];
  /** Per parameter group at the model strength. */
  readonly groups: readonly Metric[];
  readonly missing: readonly Interaction[];
}

export function measure(
  universe: Universe,
  configurations: readonly (readonly number[])[],
): Measurement {
  const sets = universe.levels.map((level) => {
    const set = new CoverageSet(universe, level);
    for (const configuration of configurations) {
      set.add(configuration);
    }
    return set;
  });
  const top = sets.at(-1) as CoverageSet;
  return {
    metric: top.metric(),
    profile: sets.map((set) => set.metric()),
    groups: top.groupMetrics(),
    missing: top.missing(),
  };
}
