export { NwiseKitError } from './errors.js';
export type { Diagnostic, ErrorCode, Severity } from './errors.js';
export { parseJson } from './model/json.js';
export { DEFAULT_LIMITS, resolveLimits } from './model/limits.js';
export type { Limits } from './model/limits.js';
export type {
  Constraint,
  DomainValue,
  Expression,
  Model,
  ModelInput,
  Parameter,
  Strength,
} from './model/types.js';
export { validateModel } from './model/validate-model.js';
export { caseValues, validateCases, validateMatrix } from './model/cases.js';
export type { CaseInput, MatrixInput, TestCase } from './model/cases.js';
export { canonicalJson, matrixHash, modelHash, sha256 } from './model/canonical.js';
export { analyzeMatrix } from './coverage/analyze.js';
export type {
  AnalyzeMatrixOptions,
  GroupCoverage,
  StaticAnalysis,
  StrengthCoverage,
} from './coverage/analyze.js';
export type { Interaction, Metric } from './coverage/coverage.js';
export { createStaticReport, formatReport, REPORT_SCHEMA_VERSION } from './reports/report.js';
export type {
  CreateStaticReportOptions,
  ReportInteraction,
  StaticReport,
} from './reports/report.js';
export { readStaticReport } from './reports/read-report.js';
export { checkCoverage, meetsThreshold, METRIC_NAMES, parseThreshold } from './reports/check.js';
export type { CoverageVerdict, MetricName } from './reports/check.js';
export { ALGORITHM, suggestCases } from './suggestions/greedy.js';
export type {
  Basis,
  Recommendation,
  RecommendationKind,
  StopReason,
  SuggestCasesOptions,
  SuggestionResult,
} from './suggestions/greedy.js';
export {
  createSuggestionsFile,
  formatSuggestions,
  SUGGESTIONS_SCHEMA_VERSION,
} from './suggestions/file.js';
export type { SuggestionsFile } from './suggestions/file.js';
export { TEST_OUTCOMES } from './evidence/types.js';
export type {
  RunEvidence,
  RunFilters,
  SourceLocation,
  TestEvidence,
  TestOutcome,
} from './evidence/types.js';
