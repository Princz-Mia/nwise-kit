import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import type { GroupCoverage, StrengthCoverage } from '../coverage/analyze.js';
import { redundantConfigurations } from '../coverage/analyze.js';
import type { Interaction, Metric } from '../coverage/coverage.js';
import { measure } from '../coverage/measure.js';
import { buildUniverse } from '../coverage/universe.js';
import type { Diagnostic } from '../errors.js';
import { matrixHash, modelHash } from '../model/canonical.js';
import { validateCases } from '../model/cases.js';
import type { Limits } from '../model/limits.js';
import { resolveLimits } from '../model/limits.js';
import type { Strength } from '../model/types.js';
import { compareCodeUnits } from '../model/types.js';
import { validateModel } from '../model/validate-model.js';
import { contribution } from './lifecycle.js';
import type { RunEvidence, RunFilters } from './types.js';
import { validateEvidence } from './validate.js';

export interface AnalyzeRunOptions {
  readonly model: unknown;
  /** The `cases` array of the matrix. */
  readonly cases: unknown;
  readonly evidence: unknown;
  readonly limits?: Partial<Limits>;
}

/**
 * Declared, observed and passed coverage of one matrix in one run. When
 * the run is incomplete, observed and passed are null rather than a
 * partial figure that would look authoritative.
 */
export interface RuntimeAnalysis {
  readonly kind: 'runtime';
  readonly modelId: string;
  readonly strength: Strength;
  readonly modelHash: string;
  readonly matrixHash: string;
  readonly analysisComplete: true;
  readonly runtimeComplete: boolean;
  readonly runId: string;
  readonly filters: RunFilters | null;
  readonly universe: {
    readonly rawConfigurations: number;
    readonly validConfigurations: number;
    readonly interactions: number;
  };
  readonly metrics: {
    readonly declared: Metric;
    readonly observed: Metric | null;
    readonly passed: Metric | null;
  };
  readonly profile: readonly StrengthCoverage[];
  readonly groups: readonly GroupCoverage[];
  readonly missing: {
    readonly declared: readonly Interaction[];
    readonly observed: readonly Interaction[] | null;
    readonly passed: readonly Interaction[] | null;
  };
  /** The validated evidence, kept so every metric can be explained and recomputed. */
  readonly evidence: RunEvidence;
  readonly diagnostics: readonly Diagnostic[];
  readonly limits: Limits;
  readonly durationMs: number;
}

/**
 * Computes runtime coverage. A configuration counts as observed when its
 * test reached the checkpoint in any attempt of this run, and as passed
 * when the final attempt reached it and the test's final status is
 * passed, so passed <= observed <= declared always holds. Declared rows
 * that were never registered, skipped or filtered out stay in the
 * denominator.
 */
export function analyzeRun(options: AnalyzeRunOptions): RuntimeAnalysis {
  const started = performance.now();
  const limits = resolveLimits(options.limits);
  const model = validateModel(options.model, limits);
  const cases = validateCases(options.cases, model);
  checkCasesSatisfyConstraints(model, cases);
  const hashes = { modelHash: modelHash(model), matrixHash: matrixHash(model, cases) };
  const evidence = validateEvidence(options.evidence, { ...hashes, cases });
  const universe = buildUniverse(model, limits);

  const byId = new Map(cases.map((c) => [c.id, c]));
  const diagnostics: Diagnostic[] = [...universe.diagnostics, ...redundantConfigurations(cases)];
  const observedCases: (readonly number[])[] = [];
  const passedCases: (readonly number[])[] = [];
  const registered = new Set<string>();
  for (const test of [...evidence.tests].sort((a, b) => compareCodeUnits(a.caseId, b.caseId))) {
    registered.add(test.caseId);
    const indices = byId.get(test.caseId)?.indices ?? [];
    const result = contribution(test);
    if (result.observed) {
      observedCases.push(indices);
    }
    if (result.passed) {
      passedCases.push(indices);
    }
    diagnostics.push(...result.diagnostics);
  }
  for (const testCase of cases) {
    if (!registered.has(testCase.id)) {
      diagnostics.push({
        code: 'UNREGISTERED_CASE',
        severity: 'warning',
        message: `Case "${testCase.id}" is declared but no test was registered for it`,
        caseIds: [testCase.id],
        hint: 'Add a test for it with createMatrixSuite, or remove the row.',
      });
    }
  }
  for (const message of evidence.infrastructureErrors) {
    diagnostics.push({ code: 'RUN_INFRASTRUCTURE_ERROR', severity: 'error', message });
  }
  const runtimeComplete =
    evidence.infrastructureErrors.length === 0 &&
    evidence.tests.every((test) => test.outcome !== 'missing');
  if (!runtimeComplete) {
    diagnostics.push({
      code: 'RUNTIME_INCOMPLETE',
      severity: 'error',
      message: 'The run is incomplete, so observed and passed coverage are unavailable',
      hint: 'Fix the reported problems and run the tests again.',
    });
  }

  const declared = measure(
    universe,
    cases.map((c) => c.indices),
  );
  const observed = runtimeComplete ? measure(universe, observedCases) : null;
  const passed = runtimeComplete ? measure(universe, passedCases) : null;

  return {
    kind: 'runtime',
    modelId: model.id,
    strength: model.strength,
    ...hashes,
    analysisComplete: true,
    runtimeComplete,
    runId: evidence.runId,
    filters: evidence.filters,
    universe: {
      rawConfigurations: universe.rawConfigurations,
      validConfigurations: universe.validConfigurations,
      interactions: universe.interactions,
    },
    metrics: {
      declared: declared.metric,
      observed: observed?.metric ?? null,
      passed: passed?.metric ?? null,
    },
    profile: universe.levels.map((level, l) => ({
      strength: level.strength,
      declared: declared.profile[l] as Metric,
      observed: observed === null ? null : (observed.profile[l] as Metric),
      passed: passed === null ? null : (passed.profile[l] as Metric),
    })),
    groups: universe.groups.map((group, g) => ({
      parameters: group.parameters.map((p) => model.parameters[p]?.name ?? ''),
      declared: declared.groups[g] as Metric,
      observed: observed === null ? null : (observed.groups[g] as Metric),
      passed: passed === null ? null : (passed.groups[g] as Metric),
    })),
    missing: {
      declared: declared.missing,
      observed: observed?.missing ?? null,
      passed: passed?.missing ?? null,
    },
    evidence,
    diagnostics,
    limits,
    durationMs: performance.now() - started,
  };
}
