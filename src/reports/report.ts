import type { GroupCoverage, StaticAnalysis, StrengthCoverage } from '../coverage/analyze.js';
import { analyzeMatrix } from '../coverage/analyze.js';
import type { Metric } from '../coverage/coverage.js';
import type { Diagnostic } from '../errors.js';
import type { RuntimeAnalysis } from '../evidence/analyze-run.js';
import { analyzeRun } from '../evidence/analyze-run.js';
import type { RunEvidence, RunFilters } from '../evidence/types.js';
import { modelToJson } from '../model/canonical.js';
import type { CaseInput, MatrixInput } from '../model/cases.js';
import { caseValues, validateMatrix } from '../model/cases.js';
import type { Limits } from '../model/limits.js';
import { resolveLimits } from '../model/limits.js';
import type { DomainValue, ModelInput, Strength } from '../model/types.js';
import { validateModel } from '../model/validate-model.js';

export const REPORT_SCHEMA_VERSION = 1;

/** A missing interaction: parameter names, domain indices and the values they stand for. */
export interface ReportInteraction {
  readonly parameters: readonly string[];
  readonly indices: readonly number[];
  readonly values: readonly DomainValue[];
}

/**
 * A versioned, self-contained static report. It embeds the normalised
 * model and matrix so its counts can be recomputed and checked later.
 */
export interface StaticReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly toolVersion: string;
  readonly kind: 'static';
  readonly model: ModelInput;
  readonly matrix: MatrixInput;
  readonly modelHash: string;
  readonly matrixHash: string;
  readonly strength: Strength;
  readonly analysisComplete: true;
  /** Runtime fields do not apply to a static report. */
  readonly runtimeComplete: null;
  readonly runId: null;
  readonly filters: null;
  readonly universe: StaticAnalysis['universe'];
  readonly metrics: { readonly declared: Metric; readonly observed: null; readonly passed: null };
  readonly profile: readonly StrengthCoverage[];
  readonly groups: readonly GroupCoverage[];
  readonly missing: {
    readonly declared: readonly ReportInteraction[];
    readonly observed: null;
    readonly passed: null;
  };
  readonly diagnostics: readonly Diagnostic[];
  readonly limits: Limits;
  readonly durationMs: number;
}

export interface CreateStaticReportOptions {
  /** The model as written in JSON. */
  readonly model: unknown;
  /** The whole matrix file, including its schema version and model id. */
  readonly matrix: unknown;
  readonly limits?: Partial<Limits>;
  /** Version of the package producing the report. */
  readonly toolVersion: string;
}

/** Analyses a matrix file and packages the result as a static report. */
export function createStaticReport(options: CreateStaticReportOptions): StaticReport {
  const started = performance.now();
  const limits = resolveLimits(options.limits);
  const model = validateModel(options.model, limits);
  const cases = validateMatrix(options.matrix, model);
  const analysis = analyzeMatrix({
    model: options.model,
    cases: (options.matrix as { cases: unknown }).cases,
    limits,
  });
  const rows: CaseInput[] = cases.map((c) => ({ id: c.id, values: caseValues(model, c.indices) }));
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    toolVersion: options.toolVersion,
    kind: 'static',
    model: modelToJson(model),
    matrix: { schemaVersion: 1, modelId: model.id, cases: rows },
    modelHash: analysis.modelHash,
    matrixHash: analysis.matrixHash,
    strength: analysis.strength,
    analysisComplete: true,
    runtimeComplete: null,
    runId: null,
    filters: null,
    universe: analysis.universe,
    metrics: analysis.metrics,
    profile: analysis.profile,
    groups: analysis.groups,
    missing: {
      declared: analysis.missing.declared.map((m) => ({
        parameters: m.parameters,
        indices: m.indices,
        values: m.values,
      })),
      observed: null,
      passed: null,
    },
    diagnostics: analysis.diagnostics,
    limits: analysis.limits,
    durationMs: performance.now() - started,
  };
}

/**
 * A versioned runtime report for one matrix in one test run. It embeds
 * the validated evidence, so observed and passed coverage can be
 * recomputed and explained. When the run is incomplete, observed and
 * passed are null.
 */
export interface RuntimeReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly toolVersion: string;
  readonly kind: 'runtime';
  readonly model: ModelInput;
  readonly matrix: MatrixInput;
  readonly modelHash: string;
  readonly matrixHash: string;
  readonly strength: Strength;
  readonly analysisComplete: true;
  readonly runtimeComplete: boolean;
  readonly runId: string;
  readonly filters: RunFilters | null;
  readonly universe: RuntimeAnalysis['universe'];
  readonly metrics: RuntimeAnalysis['metrics'];
  readonly profile: readonly StrengthCoverage[];
  readonly groups: readonly GroupCoverage[];
  readonly missing: {
    readonly declared: readonly ReportInteraction[];
    readonly observed: readonly ReportInteraction[] | null;
    readonly passed: readonly ReportInteraction[] | null;
  };
  readonly evidence: RunEvidence;
  readonly diagnostics: readonly Diagnostic[];
  readonly limits: Limits;
  readonly durationMs: number;
}

export type Report = StaticReport | RuntimeReport;

export interface CreateRuntimeReportOptions extends CreateStaticReportOptions {
  /** Evidence recorded by a test run for this matrix. */
  readonly evidence: unknown;
}

function interactions(list: readonly ReportInteraction[]): ReportInteraction[] {
  return list.map((m) => ({ parameters: m.parameters, indices: m.indices, values: m.values }));
}

/** Analyses a run's evidence for a matrix file and packages the result as a runtime report. */
export function createRuntimeReport(options: CreateRuntimeReportOptions): RuntimeReport {
  const started = performance.now();
  const limits = resolveLimits(options.limits);
  const model = validateModel(options.model, limits);
  const cases = validateMatrix(options.matrix, model);
  const analysis = analyzeRun({
    model: options.model,
    cases: (options.matrix as { cases: unknown }).cases,
    evidence: options.evidence,
    limits,
  });
  const rows: CaseInput[] = cases.map((c) => ({ id: c.id, values: caseValues(model, c.indices) }));
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    toolVersion: options.toolVersion,
    kind: 'runtime',
    model: modelToJson(model),
    matrix: { schemaVersion: 1, modelId: model.id, cases: rows },
    modelHash: analysis.modelHash,
    matrixHash: analysis.matrixHash,
    strength: analysis.strength,
    analysisComplete: true,
    runtimeComplete: analysis.runtimeComplete,
    runId: analysis.runId,
    filters: analysis.filters,
    universe: analysis.universe,
    metrics: analysis.metrics,
    profile: analysis.profile,
    groups: analysis.groups,
    missing: {
      declared: interactions(analysis.missing.declared),
      observed: analysis.missing.observed === null ? null : interactions(analysis.missing.observed),
      passed: analysis.missing.passed === null ? null : interactions(analysis.missing.passed),
    },
    evidence: analysis.evidence,
    diagnostics: analysis.diagnostics,
    limits: analysis.limits,
    durationMs: performance.now() - started,
  };
}

/** Serialises a report as indented JSON with a trailing newline. */
export function formatReport(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
