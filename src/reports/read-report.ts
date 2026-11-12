import type { Diagnostic, ErrorCode } from '../errors.js';
import { NwiseKitError } from '../errors.js';
import { canonicalJson } from '../model/canonical.js';
import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import { validateMatrix } from '../model/cases.js';
import type { Limits } from '../model/limits.js';
import { resolveLimits } from '../model/limits.js';
import { validateModel } from '../model/validate-model.js';
import { checkIdentifier, checkObject, Issues } from '../model/shape.js';
import type { Report } from './report.js';
import { createRuntimeReport, createStaticReport, REPORT_SCHEMA_VERSION } from './report.js';

const REPORT_KEYS = [
  'schemaVersion',
  'toolVersion',
  'kind',
  'model',
  'matrix',
  'modelHash',
  'matrixHash',
  'strength',
  'analysisComplete',
  'runtimeComplete',
  'runId',
  'filters',
  'universe',
  'metrics',
  'profile',
  'groups',
  'missing',
  'diagnostics',
  'limits',
  'durationMs',
] as const;

/** Fields recomputed from the embedded inputs and compared with the stored ones. */
const DERIVED_KEYS = [
  'modelHash',
  'matrixHash',
  'strength',
  'analysisComplete',
  'runtimeComplete',
  'runId',
  'filters',
  'universe',
  'metrics',
  'profile',
  'groups',
  'missing',
  'diagnostics',
] as const;

/** Input errors inside a report are reported as an invalid report, at their path in it. */
const EMBEDDED_ERRORS: readonly ErrorCode[] = [
  'INVALID_MODEL',
  'INVALID_MATRIX',
  'INVALID_LIMITS',
  'UNSUPPORTED_SCHEMA_VERSION',
  'UNSATISFIABLE_MODEL',
  'INVALID_EVIDENCE',
];

/**
 * Reads a static or runtime report produced earlier and checks it. Every
 * count is recomputed from the embedded model, matrix, limits and, for a
 * runtime report, evidence; any stored value that differs is rejected
 * rather than trusted, so editing a percentage or a count cannot make a
 * report pass. A valid structure or hash does not prove where the report
 * came from.
 */
export function readReport(input: unknown): Report {
  const issues = new Issues();
  const runtime =
    typeof input === 'object' && input !== null && (input as { kind?: unknown }).kind === 'runtime';
  const keys = runtime ? [...REPORT_KEYS, 'evidence'] : REPORT_KEYS;
  if (!checkObject(issues, input, '', 'The report', keys)) {
    throw invalid(issues.diagnostics);
  }
  if (input['schemaVersion'] !== REPORT_SCHEMA_VERSION) {
    throw new NwiseKitError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Unsupported report schemaVersion ${String(input['schemaVersion'])}`,
      [
        {
          code: 'UNSUPPORTED_SCHEMA_VERSION',
          severity: 'error',
          message: `This version of nwise-kit reads report schemaVersion ${String(REPORT_SCHEMA_VERSION)}`,
          path: '/schemaVersion',
        },
      ],
    );
  }
  if (input['kind'] !== 'static' && input['kind'] !== 'runtime') {
    issues.error(
      'UNSUPPORTED_REPORT_KIND',
      '/kind',
      `Report kind ${String(input['kind'])} is not supported by this version`,
      'Reports are "static" (from analyze) or "runtime" (from the Vitest reporter).',
    );
  }
  checkIdentifier(issues, input['toolVersion'], '/toolVersion', 'The tool version');
  const duration = input['durationMs'];
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    issues.error('INVALID_TYPE', '/durationMs', 'durationMs must be a non-negative number');
  }
  if (issues.count > 0) {
    throw invalid(issues.diagnostics);
  }

  const fresh = recompute(input);
  const mismatches: Diagnostic[] = DERIVED_KEYS.filter(
    (key) =>
      canonicalJson(input[key]) !==
      canonicalJson((fresh as unknown as Record<string, unknown>)[key]),
  ).map((key) => ({
    code: 'REPORT_INCONSISTENT',
    severity: 'error',
    message: `The stored "${key}" differs from the value recomputed from the embedded inputs`,
    path: `/${key}`,
    hint: 'Regenerate the report instead of editing it.',
  }));
  if (mismatches.length > 0) {
    throw invalid(mismatches);
  }
  return { ...fresh, durationMs: duration as number };
}

function recompute(input: Record<string, unknown>): Report {
  const limits = within('/limits', () => resolveLimits(input['limits'] as Partial<Limits>));
  const model = within('/model', () => validateModel(input['model'], limits));
  within('/matrix', () => {
    checkCasesSatisfyConstraints(model, validateMatrix(input['matrix'], model));
  });
  const options = {
    model: input['model'],
    matrix: input['matrix'],
    limits,
    toolVersion: input['toolVersion'] as string,
  };
  if (input['kind'] === 'runtime') {
    return within('/evidence', () =>
      createRuntimeReport({ ...options, evidence: input['evidence'] }),
    );
  }
  return within('/model', () => createStaticReport(options));
}

/** Runs `step`, reporting embedded input errors as an invalid report at `prefix`. */
function within<T>(prefix: string, step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof NwiseKitError && EMBEDDED_ERRORS.includes(error.code)) {
      throw invalid(error.diagnostics.map((d) => ({ ...d, path: `${prefix}${d.path ?? ''}` })));
    }
    throw error;
  }
}

function invalid(diagnostics: readonly Diagnostic[]): NwiseKitError {
  const n = diagnostics.length;
  return new NwiseKitError(
    'INVALID_REPORT',
    `The report has ${String(n)} error${n === 1 ? '' : 's'}`,
    diagnostics,
  );
}
