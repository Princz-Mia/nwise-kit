import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import type { Interaction, Metric } from '../coverage/coverage.js';
import { CoverageSet } from '../coverage/coverage.js';
import { meetsThreshold, parseThreshold } from '../coverage/threshold.js';
import type { Universe } from '../coverage/universe.js';
import { buildUniverse, cellOf } from '../coverage/universe.js';
import type { Diagnostic } from '../errors.js';
import { NwiseKitError } from '../errors.js';
import { contribution } from '../evidence/lifecycle.js';
import { validateEvidence } from '../evidence/validate.js';
import { matrixHash, modelHash } from '../model/canonical.js';
import type { TestCase } from '../model/cases.js';
import { caseValues, validateCases } from '../model/cases.js';
import type { Limits } from '../model/limits.js';
import { resolveLimits } from '../model/limits.js';
import type { DomainValue, Strength } from '../model/types.js';
import { compareCodeUnits } from '../model/types.js';
import { validateModel } from '../model/validate-model.js';

/**
 * Identifies the selection rule and how work is counted. Changing either
 * changes the identifier, so results stay comparable across versions.
 */
export const ALGORITHM = 'greedy-v1';

export type Basis = 'declared' | 'observed' | 'passed';

/**
 * `add-case`: a configuration the matrix does not contain yet.
 * `rerun-existing`: a configuration the matrix already has, whose coverage
 * only counts once its test runs successfully.
 */
export type RecommendationKind = 'add-case' | 'rerun-existing';

export type StopReason = 'target-reached' | 'case-budget' | 'work-budget';

export interface Recommendation {
  readonly kind: RecommendationKind;
  readonly values: Readonly<Record<string, DomainValue>>;
  /** Domain index of each parameter, in canonical order. */
  readonly indices: readonly number[];
  /** Existing cases with the same configuration, sorted. */
  readonly matchedCaseIds: readonly string[];
  /**
   * For `rerun-existing` from a runtime basis: how each matched case ended
   * in the run. Rerunning is not assumed to succeed.
   */
  readonly previousOutcomes: readonly { readonly caseId: string; readonly outcome: string }[];
  /** Interactions this recommendation adds to the ones before it. */
  readonly gain: number;
  /** Coverage once this and every earlier recommendation are in place. */
  readonly projected: Metric;
}

export interface SuggestionResult {
  readonly algorithm: typeof ALGORITHM;
  readonly basis: Basis;
  /** The run whose evidence was the starting point, or null for the declared basis. */
  readonly runId: string | null;
  readonly modelId: string;
  readonly strength: Strength;
  readonly modelHash: string;
  readonly matrixHash: string;
  /** The target as given, such as "100". */
  readonly target: string;
  readonly maxNewCases: number;
  readonly baseline: Metric;
  readonly recommendations: readonly Recommendation[];
  /** Coverage with every recommendation in place; hypothetical until the tests exist and run. */
  readonly projected: Metric;
  readonly targetReached: boolean;
  /** Whether the requested target was reached, not merely whether the search ended. */
  readonly suggestionComplete: boolean;
  readonly stopReason: StopReason;
  /** Interactions still missing after the recommendations. */
  readonly remaining: readonly Interaction[];
  /** Candidate-interaction membership checks used, and the budget. */
  readonly work: { readonly used: number; readonly budget: number };
  readonly diagnostics: readonly Diagnostic[];
  readonly limits: Limits;
  readonly durationMs: number;
}

export interface SuggestCasesOptions {
  readonly model: unknown;
  readonly cases: unknown;
  /**
   * Coverage to start from: the declared matrix (default), or what a run
   * observed or passed. A runtime basis needs that run's evidence.
   */
  readonly basis?: Basis;
  /** Run evidence for the matrix, required with the observed and passed bases. */
  readonly evidence?: unknown;
  /** Percentage to reach, at most three decimals. Defaults to 100. */
  readonly targetCoverage?: number | string;
  /** Most recommendations to return. Defaults to 10. */
  readonly maxNewCases?: number;
  readonly limits?: Partial<Limits>;
}

/**
 * Recommends configurations to add to an existing matrix, greedily: each
 * step picks the valid configuration that covers the most interactions
 * still missing, breaking ties by canonical order of domain indices,
 * until the target, the case budget or the work budget is reached. The
 * result is deterministic but not guaranteed to be the smallest set.
 * Nothing is written and no test is run.
 */
export function suggestCases(options: SuggestCasesOptions): SuggestionResult {
  const started = performance.now();
  const basis = options.basis ?? 'declared';
  if (basis !== 'declared' && options.evidence === undefined) {
    throw new NwiseKitError('INVALID_ARGUMENTS', `The ${basis} basis needs runtime evidence`, [
      {
        code: 'BASIS_NEEDS_EVIDENCE',
        severity: 'error',
        message: `Suggestions from ${basis} coverage start from what a test run recorded`,
        hint: 'Pass the evidence of a complete run, or use the declared basis.',
      },
    ]);
  }
  const target = String(options.targetCoverage ?? 100);
  const targetThousandths = parseThreshold(target);
  const maxNewCases = options.maxNewCases ?? 10;
  if (!Number.isSafeInteger(maxNewCases) || maxNewCases < 1) {
    throw new NwiseKitError('INVALID_ARGUMENTS', 'The case budget must be a positive integer', [
      {
        code: 'INVALID_CASE_BUDGET',
        severity: 'error',
        message: `${String(maxNewCases)} is not a positive integer`,
      },
    ]);
  }

  const limits = resolveLimits(options.limits);
  const model = validateModel(options.model, limits);
  const cases = validateCases(options.cases, model);
  checkCasesSatisfyConstraints(model, cases);
  const hashes = { modelHash: modelHash(model), matrixHash: matrixHash(model, cases) };
  const run =
    basis === 'declared' ? undefined : runtimeBasis(basis, options.evidence, hashes, cases);
  const universe = buildUniverse(model, limits);

  const covered = new CoverageSet(universe);
  for (const testCase of run?.counted ?? cases) {
    covered.add(testCase.indices);
  }
  const baseline = covered.metric();
  const search = supplement(
    universe,
    covered,
    targetThousandths,
    maxNewCases,
    limits.suggestionWork,
  );
  const matches = casesByConfiguration(cases);

  return {
    algorithm: ALGORITHM,
    basis,
    runId: run?.runId ?? null,
    modelId: model.id,
    strength: model.strength,
    ...hashes,
    target,
    maxNewCases,
    baseline,
    recommendations: search.picks.map((pick) => {
      const matchedCaseIds = matches.get(pick.indices.join(',')) ?? [];
      return {
        kind: matchedCaseIds.length > 0 ? 'rerun-existing' : 'add-case',
        values: caseValues(model, pick.indices),
        indices: pick.indices,
        matchedCaseIds,
        previousOutcomes:
          run === undefined
            ? []
            : matchedCaseIds.map((caseId) => ({
                caseId,
                outcome: run.outcomes.get(caseId) ?? 'unregistered',
              })),
        gain: pick.gain,
        projected: pick.projected,
      };
    }),
    projected: covered.metric(),
    targetReached: search.stopReason === 'target-reached',
    suggestionComplete: search.stopReason === 'target-reached',
    stopReason: search.stopReason,
    remaining: covered.missing(),
    work: { used: search.work, budget: limits.suggestionWork },
    diagnostics: universe.diagnostics,
    limits,
    durationMs: performance.now() - started,
  };
}

interface Pick {
  readonly indices: readonly number[];
  readonly gain: number;
  readonly projected: Metric;
}

interface Search {
  readonly picks: readonly Pick[];
  readonly stopReason: StopReason;
  readonly work: number;
}

/**
 * The greedy loop. Each step scores every remaining candidate in a full
 * pass, counting one unit of work per candidate-interaction membership
 * check, before committing to a choice. If the work budget runs out
 * part-way through a pass, that pass is discarded: no candidate is ever
 * chosen from a partial scan. `covered` is updated in place.
 */
export function supplement(
  universe: Universe,
  covered: CoverageSet,
  targetThousandths: number,
  maxNewCases: number,
  workBudget: number,
): Search {
  const n = universe.model.parameters.length;
  const count = universe.validConfigurations;
  const groups = universe.groups;
  const chosen = new Uint8Array(count);
  const candidate = (i: number): Int32Array => universe.configurations.subarray(i * n, i * n + n);
  const picks: Pick[] = [];
  let work = 0;

  for (;;) {
    if (meetsThreshold(covered.metric(), targetThousandths)) {
      return { picks, stopReason: 'target-reached', work };
    }
    if (picks.length >= maxNewCases) {
      return { picks, stopReason: 'case-budget', work };
    }
    let best = -1;
    let bestGain = 0;
    for (let i = 0; i < count; i++) {
      if (chosen[i] === 1) {
        continue;
      }
      if (work + groups.length > workBudget) {
        return { picks, stopReason: 'work-budget', work };
      }
      const x = candidate(i);
      let gain = 0;
      for (let g = 0; g < groups.length; g++) {
        work++;
        if (!covered.has(g, cellOf(groups[g] as (typeof groups)[number], x))) {
          gain++;
        }
      }
      // Strictly greater keeps the earliest candidate, which is the canonical tie-break.
      if (gain > bestGain) {
        best = i;
        bestGain = gain;
      }
    }
    if (best < 0) {
      throw new Error(
        'Internal error: valid interactions remain but no candidate covers any of them',
      );
    }
    chosen[best] = 1;
    const x = candidate(best);
    covered.add(x);
    picks.push({ indices: Array.from(x), gain: bestGain, projected: covered.metric() });
  }
}

function casesByConfiguration(cases: readonly TestCase[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const testCase of cases) {
    const key = testCase.indices.join(',');
    map.set(key, [...(map.get(key) ?? []), testCase.id].sort(compareCodeUnits));
  }
  return map;
}

interface RuntimeBasis {
  readonly runId: string;
  /** Cases that count toward the chosen basis. */
  readonly counted: readonly TestCase[];
  /** Final outcome of each registered case. */
  readonly outcomes: ReadonlyMap<string, string>;
}

/**
 * The cases a complete run observed or passed. An incomplete run is
 * refused: suggestions from partial evidence would look authoritative.
 */
function runtimeBasis(
  basis: 'observed' | 'passed',
  input: unknown,
  hashes: { readonly modelHash: string; readonly matrixHash: string },
  cases: readonly TestCase[],
): RuntimeBasis {
  const evidence = validateEvidence(input, { ...hashes, cases });
  const complete =
    evidence.infrastructureErrors.length === 0 &&
    evidence.tests.every((test) => test.outcome !== 'missing');
  if (!complete) {
    throw new NwiseKitError('RUNTIME_INCOMPLETE', `Run ${evidence.runId} is incomplete`, [
      {
        code: 'RUNTIME_INCOMPLETE',
        severity: 'error',
        message: 'Suggestions need the evidence of a complete run',
        hint: 'Fix the run and test again, or use the declared basis.',
      },
    ]);
  }
  const byId = new Map(cases.map((c) => [c.id, c]));
  const counted: TestCase[] = [];
  const outcomes = new Map<string, string>();
  for (const test of evidence.tests) {
    outcomes.set(test.caseId, test.outcome);
    const result = contribution(test);
    const testCase = byId.get(test.caseId);
    if (testCase !== undefined && (basis === 'observed' ? result.observed : result.passed)) {
      counted.push(testCase);
    }
  }
  return { runId: evidence.runId, counted, outcomes };
}
