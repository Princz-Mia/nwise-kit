import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import type { Diagnostic } from '../errors.js';
import { matrixHash, modelHash } from '../model/canonical.js';
import type { TestCase } from '../model/cases.js';
import { validateCases } from '../model/cases.js';
import type { Limits } from '../model/limits.js';
import { resolveLimits } from '../model/limits.js';
import type { Strength } from '../model/types.js';
import { compareCodeUnits } from '../model/types.js';
import { validateModel } from '../model/validate-model.js';
import type { Interaction, Metric } from './coverage.js';
import { measure } from './measure.js';
import type { UniverseOptions } from './universe.js';
import { buildUniverse } from './universe.js';

export interface AnalyzeMatrixOptions {
  /** The model as written in JSON. */
  readonly model: unknown;
  /** The `cases` array of the matrix. */
  readonly cases: unknown;
  readonly limits?: Partial<Limits>;
}

export interface GroupCoverage {
  readonly parameters: readonly string[];
  readonly declared: Metric;
  readonly observed: Metric | null;
  readonly passed: Metric | null;
}

/**
 * Coverage at one strength. The profile runs from single values (each
 * value of each parameter appears in some test) up to the model
 * strength, showing how coverage falls as interactions grow.
 */
export interface StrengthCoverage {
  readonly strength: number;
  readonly declared: Metric;
  readonly observed: Metric | null;
  readonly passed: Metric | null;
}

/** An exact static analysis of the declared matrix. */
export interface StaticAnalysis {
  readonly kind: 'static';
  readonly modelId: string;
  readonly strength: Strength;
  readonly modelHash: string;
  readonly matrixHash: string;
  readonly analysisComplete: true;
  readonly universe: {
    readonly rawConfigurations: number;
    readonly validConfigurations: number;
    readonly interactions: number;
  };
  /** Runtime metrics are null: a static analysis has no runtime evidence. */
  readonly metrics: { readonly declared: Metric; readonly observed: null; readonly passed: null };
  /** Strengths 1 up to the model strength; the last entry equals `metrics`. */
  readonly profile: readonly StrengthCoverage[];
  readonly groups: readonly GroupCoverage[];
  readonly missing: { readonly declared: readonly Interaction[] };
  readonly diagnostics: readonly Diagnostic[];
  readonly limits: Limits;
  readonly durationMs: number;
}

/**
 * Computes exact declared coverage of a matrix: how many valid
 * interactions of the model strength its rows contain, out of all valid
 * interactions. Throws a NwiseKitError for invalid input, an
 * unsatisfiable model or an analysis that cannot finish within limits.
 */
export function analyzeMatrix(options: AnalyzeMatrixOptions): StaticAnalysis {
  return analyzeMatrixWith(options);
}

/** As `analyzeMatrix`, with a replaceable clock for tests. */
export function analyzeMatrixWith(
  options: AnalyzeMatrixOptions,
  universeOptions: UniverseOptions = {},
): StaticAnalysis {
  const started = performance.now();
  const limits = resolveLimits(options.limits);
  const model = validateModel(options.model, limits);
  const cases = validateCases(options.cases, model);
  checkCasesSatisfyConstraints(model, cases);
  const universe = buildUniverse(model, limits, universeOptions);

  const declared = measure(
    universe,
    cases.map((c) => c.indices),
  );

  return {
    kind: 'static',
    modelId: model.id,
    strength: model.strength,
    modelHash: modelHash(model),
    matrixHash: matrixHash(model, cases),
    analysisComplete: true,
    universe: {
      rawConfigurations: universe.rawConfigurations,
      validConfigurations: universe.validConfigurations,
      interactions: universe.interactions,
    },
    metrics: { declared: declared.metric, observed: null, passed: null },
    profile: universe.levels.map((level, l) => ({
      strength: level.strength,
      declared: declared.profile[l] as Metric,
      observed: null,
      passed: null,
    })),
    groups: universe.groups.map((group, g) => ({
      parameters: group.parameters.map((p) => model.parameters[p]?.name ?? ''),
      declared: declared.groups[g] as Metric,
      observed: null,
      passed: null,
    })),
    missing: { declared: declared.missing },
    diagnostics: [...universe.diagnostics, ...redundantConfigurations(cases)],
    limits,
    durationMs: performance.now() - started,
  };
}

/** Rows that repeat another row's configuration under a different id. */
export function redundantConfigurations(cases: readonly TestCase[]): Diagnostic[] {
  const byConfiguration = new Map<string, string[]>();
  for (const testCase of cases) {
    const key = testCase.indices.join(',');
    const ids = byConfiguration.get(key);
    if (ids === undefined) {
      byConfiguration.set(key, [testCase.id]);
    } else {
      ids.push(testCase.id);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const ids of byConfiguration.values()) {
    if (ids.length > 1) {
      const sorted = [...ids].sort(compareCodeUnits);
      diagnostics.push({
        code: 'REDUNDANT_CONFIGURATION',
        severity: 'warning',
        message: `Cases ${sorted.map((id) => `"${id}"`).join(', ')} share one configuration; it counts once`,
        caseIds: sorted,
        hint: 'Keep them if they test different behaviour; otherwise remove the extras.',
      });
    }
  }
  return diagnostics.sort((a, b) => compareCodeUnits(a.caseIds?.[0] ?? '', b.caseIds?.[0] ?? ''));
}
