import { NwiseKitError } from '../errors.js';
import { canonicalJson } from '../model/canonical.js';
import type { TestCase } from '../model/cases.js';
import { appendPointer } from '../model/pointer.js';
import { checkIdentifier, checkObject, describe, Issues, isRecord } from '../model/shape.js';
import type {
  RunEvidence,
  RunFilters,
  SourceLocation,
  TestEvidence,
  TestOutcome,
} from './types.js';
import { TEST_OUTCOMES } from './types.js';

export interface EvidenceContext {
  readonly modelHash: string;
  readonly matrixHash: string;
  readonly cases: readonly TestCase[];
}

/**
 * Validates runtime evidence against the model and matrix it claims to
 * measure. Evidence from another run, for another model or matrix, or
 * for a case the matrix does not have is rejected and can never add
 * coverage. Identical repeated test entries are merged; conflicting ones
 * are errors. Each case may be registered by at most one test.
 */
export function validateEvidence(input: unknown, context: EvidenceContext): RunEvidence {
  const issues = new Issues();
  if (
    !checkObject(issues, input, '', 'The evidence', [
      'schemaVersion',
      'runId',
      'modelHash',
      'matrixHash',
      'filters',
      'infrastructureErrors',
      'tests',
    ])
  ) {
    throw invalid(issues);
  }
  if (input['schemaVersion'] !== 1) {
    issues.error(
      'UNSUPPORTED_SCHEMA_VERSION',
      '/schemaVersion',
      'Evidence schemaVersion must be 1',
    );
    throw invalid(issues);
  }
  const runId = input['runId'];
  checkIdentifier(issues, runId, '/runId', 'The run id');
  if (input['modelHash'] !== context.modelHash) {
    issues.error(
      'MODEL_HASH_MISMATCH',
      '/modelHash',
      'The evidence was recorded for a different model',
      'Rerun the tests against the current model.',
    );
  }
  if (input['matrixHash'] !== context.matrixHash) {
    issues.error(
      'MATRIX_HASH_MISMATCH',
      '/matrixHash',
      'The evidence was recorded for a different matrix',
      'Rerun the tests against the current matrix.',
    );
  }
  const filters = checkFilters(issues, input['filters']);
  const infrastructureErrors = checkStrings(
    issues,
    input['infrastructureErrors'],
    '/infrastructureErrors',
  );
  const known = new Set(context.cases.map((c) => c.id));
  const tests = checkTests(issues, input['tests'], typeof runId === 'string' ? runId : '', known);
  if (issues.count > 0 || filters === undefined || infrastructureErrors === undefined) {
    throw invalid(issues);
  }
  return {
    schemaVersion: 1,
    runId: runId as string,
    modelHash: context.modelHash,
    matrixHash: context.matrixHash,
    filters,
    infrastructureErrors,
    tests,
  };
}

function invalid(issues: Issues): NwiseKitError {
  const n = issues.count;
  return new NwiseKitError(
    'INVALID_EVIDENCE',
    `The runtime evidence has ${String(n)} error${n === 1 ? '' : 's'}`,
    issues.diagnostics,
  );
}

function checkFilters(issues: Issues, value: unknown): RunFilters | null | undefined {
  if (value === null) {
    return null;
  }
  if (!checkObject(issues, value, '/filters', 'The filters', ['testNamePattern', 'files'])) {
    return undefined;
  }
  const pattern = value['testNamePattern'];
  if (pattern !== null && typeof pattern !== 'string') {
    issues.error(
      'INVALID_TYPE',
      '/filters/testNamePattern',
      'testNamePattern must be a string or null',
    );
  }
  const files = checkStrings(issues, value['files'], '/filters/files');
  return files === undefined
    ? undefined
    : { testNamePattern: (pattern as string | null) ?? null, files };
}

function checkStrings(issues: Issues, value: unknown, path: string): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    issues.error('INVALID_TYPE', path, `Expected an array of strings, not ${describe(value)}`);
    return undefined;
  }
  return value;
}

function checkTests(
  issues: Issues,
  value: unknown,
  runId: string,
  known: ReadonlySet<string>,
): TestEvidence[] {
  if (!Array.isArray(value)) {
    issues.error('INVALID_TYPE', '/tests', `Tests must be an array, not ${describe(value)}`);
    return [];
  }
  const byTestId = new Map<string, TestEvidence>();
  const byCaseId = new Map<string, string>();
  value.forEach((raw: unknown, i) => {
    const path = appendPointer('/tests', i);
    const test = checkTest(issues, raw, path);
    if (test === undefined) {
      return;
    }
    if (test.runId !== runId) {
      issues.error(
        'STALE_RUN_ID',
        `${path}/runId`,
        `Test "${test.testId}" belongs to run "${test.runId}", not "${runId}"`,
        'Evidence from earlier runs is never merged.',
      );
      return;
    }
    if (!known.has(test.caseId)) {
      issues.error(
        'UNKNOWN_CASE',
        `${path}/caseId`,
        `Case "${test.caseId}" is not in the matrix`,
        'Runtime evidence cannot add rows to the declared matrix.',
      );
      return;
    }
    const previous = byTestId.get(test.testId);
    if (previous !== undefined) {
      if (canonicalJson(previous) !== canonicalJson(test)) {
        issues.error(
          'CONFLICTING_EVIDENCE',
          path,
          `Test "${test.testId}" is reported twice with different results`,
        );
      }
      return;
    }
    const owner = byCaseId.get(test.caseId);
    if (owner !== undefined) {
      issues.error(
        'CASE_REGISTERED_TWICE',
        `${path}/caseId`,
        `Case "${test.caseId}" is used by tests "${owner}" and "${test.testId}"`,
        'Give each test its own case id, even when two tests share values.',
      );
      return;
    }
    byTestId.set(test.testId, test);
    byCaseId.set(test.caseId, test.testId);
  });
  return [...byTestId.values()];
}

function checkTest(issues: Issues, raw: unknown, path: string): TestEvidence | undefined {
  const keys = [
    'testId',
    'runId',
    'caseId',
    'name',
    'workerId',
    'outcome',
    'attempts',
    'checkpointAttempts',
    'lateCheckpoints',
    'location',
  ];
  if (!checkObject(issues, raw, path, 'A test', keys)) {
    return undefined;
  }
  const before = issues.count;
  for (const key of ['testId', 'runId', 'caseId', 'workerId']) {
    checkIdentifier(issues, raw[key], `${path}/${key}`, key);
  }
  if (typeof raw['name'] !== 'string') {
    issues.error('INVALID_TYPE', `${path}/name`, 'name must be a string');
  }
  const outcome = raw['outcome'];
  if (!TEST_OUTCOMES.includes(outcome as TestOutcome)) {
    issues.error(
      'INVALID_OUTCOME',
      `${path}/outcome`,
      `Outcome must be one of ${TEST_OUTCOMES.join(', ')}`,
    );
  }
  const attempts = raw['attempts'];
  const late = raw['lateCheckpoints'];
  if (typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 0) {
    issues.error('INVALID_TYPE', `${path}/attempts`, 'attempts must be a non-negative integer');
  }
  if (typeof late !== 'number' || !Number.isSafeInteger(late) || late < 0) {
    issues.error(
      'INVALID_TYPE',
      `${path}/lateCheckpoints`,
      'lateCheckpoints must be a non-negative integer',
    );
  }
  const checkpoints = raw['checkpointAttempts'];
  const ran = typeof attempts === 'number' ? attempts : 0;
  if (
    !Array.isArray(checkpoints) ||
    !checkpoints.every(
      (a, i): boolean =>
        Number.isSafeInteger(a) &&
        (a as number) >= 0 &&
        (a as number) < ran &&
        (i === 0 || (a as number) > (checkpoints[i - 1] as number)),
    )
  ) {
    issues.error(
      'INVALID_CHECKPOINTS',
      `${path}/checkpointAttempts`,
      'checkpointAttempts must list distinct attempt indices below attempts, ascending',
    );
  }
  if ((outcome === 'passed' || outcome === 'failed') && ran === 0) {
    issues.error(
      'INCONSISTENT_OUTCOME',
      `${path}/attempts`,
      `A ${outcome} test must have run at least once`,
    );
  }
  if ((outcome === 'skipped' || outcome === 'todo' || outcome === 'filtered') && ran !== 0) {
    issues.error(
      'INCONSISTENT_OUTCOME',
      `${path}/attempts`,
      `A ${outcome} test cannot have attempts`,
    );
  }
  const location = checkLocation(issues, raw['location'], `${path}/location`);
  if (issues.count > before || location === undefined) {
    return undefined;
  }
  return {
    testId: raw['testId'] as string,
    runId: raw['runId'] as string,
    caseId: raw['caseId'] as string,
    name: raw['name'] as string,
    workerId: raw['workerId'] as string,
    outcome: outcome as TestOutcome,
    attempts: ran,
    checkpointAttempts: checkpoints as number[],
    lateCheckpoints: late as number,
    location,
  };
}

function checkLocation(
  issues: Issues,
  value: unknown,
  path: string,
): SourceLocation | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value['file'] !== 'string' ||
    !Number.isSafeInteger(value['line']) ||
    !Number.isSafeInteger(value['column'])
  ) {
    issues.error('INVALID_TYPE', path, 'location must be null or { file, line, column }');
    return undefined;
  }
  if (!checkObject(issues, value, path, 'A location', ['file', 'line', 'column'])) {
    return undefined;
  }
  return {
    file: value['file'],
    line: value['line'] as number,
    column: value['column'] as number,
  };
}
