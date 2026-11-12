import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import { NwiseKitError } from '../errors.js';
import { matrixHash, modelHash } from '../model/canonical.js';
import { caseValues, validateCases } from '../model/cases.js';
import type { DomainValue } from '../model/types.js';
import { validateModel } from '../model/validate-model.js';
import type { CaseMeta, Handshake, Registration } from './protocol.js';
import { KEY, PROTOCOL } from './protocol.js';

type Vitest = typeof import('vitest');

let vitest: Vitest;
try {
  vitest = await import('vitest');
} catch {
  throw new Error(
    'nwise-kit/vitest needs Vitest. Install a supported version with: npm install --save-dev vitest@~5.1.0',
  );
}

export type { CaseMeta, Handshake } from './protocol.js';

/** What a matrix test receives. */
export interface MatrixTestContext {
  readonly caseId: string;
  /** The case's values, keyed by parameter name. */
  readonly values: Readonly<Record<string, DomainValue>>;
  /**
   * Records that this attempt reached the point the matrix measures. Call
   * it after the operation under test. Repeated calls in one attempt
   * count once; calls after the attempt has ended are ignored.
   */
  readonly cover: () => void;
}

export type MatrixTestFunction = (context: MatrixTestContext) => unknown;

/** Options passed through to Vitest, such as `retry` or `timeout`. */
export type MatrixTestOptions = Omit<NonNullable<Parameters<Vitest['test']>[1]>, 'meta'> & object;

export interface MatrixTestApi {
  /** Registers the test for one case. Each case id may be registered once. */
  (caseId: string, fn: MatrixTestFunction, options?: MatrixTestOptions): void;
  /** Registers the case as skipped: declared, but it adds no runtime coverage. */
  skip: (caseId: string, fn?: MatrixTestFunction, options?: MatrixTestOptions) => void;
  /** Registers the case as todo: declared, but it adds no runtime coverage. */
  todo: (caseId: string) => void;
  /** Registers a test that runs concurrently with the other concurrent tests of its suite. */
  concurrent: (caseId: string, fn: MatrixTestFunction, options?: MatrixTestOptions) => void;
}

export interface MatrixSuite {
  readonly test: MatrixTestApi;
  readonly modelId: string;
  readonly modelHash: string;
  readonly matrixHash: string;
}

export interface CreateMatrixSuiteOptions {
  /** The model as written in JSON. */
  readonly model: unknown;
  /** The `cases` array of the matrix. */
  readonly cases: unknown;
}

/**
 * Binds Vitest tests to the cases of a matrix. Each test receives its
 * case's values and a `cover()` checkpoint; the NwiseKit reporter turns
 * the checkpoints and the final test outcomes into observed and passed
 * coverage. The reporter must be configured: without it this function
 * throws, rather than letting the run look measured when it is not.
 */
export function createMatrixSuite(options: CreateMatrixSuiteOptions): MatrixSuite {
  const handshake = vitest.inject(KEY) as Handshake | undefined;
  if (handshake?.protocol !== PROTOCOL) {
    throw new NwiseKitError('INVALID_ARGUMENTS', 'The NwiseKit reporter is not configured', [
      {
        code: 'REPORTER_MISSING',
        severity: 'error',
        message:
          handshake === undefined
            ? 'createMatrixSuite needs NwiseKitReporter to collect runtime coverage'
            : `The configured reporter speaks protocol ${String(handshake.protocol)}, not ${String(PROTOCOL)}`,
        hint: "Add `new NwiseKitReporter()` from 'nwise-kit/reporter' to test.reporters in your Vitest config.",
      },
    ]);
  }
  const model = validateModel(options.model);
  const cases = validateCases(options.cases, model);
  checkCasesSatisfyConstraints(model, cases);
  const hashes = { modelHash: modelHash(model), matrixHash: matrixHash(model, cases) };
  const byId = new Map(cases.map((c) => [c.id, caseValues(model, c.indices)]));
  const registration: Registration = {
    model: options.model,
    cases: cases.map((c) => ({ id: c.id, values: caseValues(model, c.indices) })),
  };
  const registered = new Set<string>();

  const metaFor = (caseId: string): CaseMeta => {
    if (!byId.has(caseId)) {
      throw new NwiseKitError(
        'INVALID_ARGUMENTS',
        `Case "${caseId}" is not in matrix of model "${model.id}"`,
        [
          {
            code: 'UNKNOWN_CASE',
            severity: 'error',
            message: `No case has the id "${caseId}"`,
            hint: 'Use an id from the matrix; tests cannot add rows to it.',
          },
        ],
      );
    }
    if (registered.has(caseId)) {
      throw new NwiseKitError('INVALID_ARGUMENTS', `Case "${caseId}" is registered twice`, [
        {
          code: 'CASE_REGISTERED_TWICE',
          severity: 'error',
          message: `Case "${caseId}" already has a test`,
          hint: 'Give each test its own case id, even when two tests share values.',
        },
      ]);
    }
    const first = registered.size === 0;
    registered.add(caseId);
    return {
      protocol: PROTOCOL,
      runId: handshake.runId,
      ...hashes,
      caseId,
      ...(first ? { registration } : {}),
      checkpoints: [],
      late: 0,
    };
  };

  const body =
    (caseId: string, fn: MatrixTestFunction) =>
    async (context: {
      task: { meta: { nwiseKit?: CaseMeta }; result?: { retryCount?: number } };
      onTestFinished: (fn: () => void) => void;
    }) => {
      const meta = context.task.meta.nwiseKit;
      if (meta === undefined) {
        throw new Error('Internal error: matrix test metadata is missing');
      }
      // Bound to this attempt; never read from a process-wide "current test".
      const attempt = context.task.result?.retryCount ?? 0;
      let ended = false;
      context.onTestFinished(() => {
        ended = true;
      });
      meta.workerId = String(process.pid);
      const cover = (): void => {
        if (ended) {
          meta.late += 1;
          return;
        }
        if (!meta.checkpoints.includes(attempt)) {
          meta.checkpoints = [...meta.checkpoints, attempt].sort((a, b) => a - b);
        }
      };
      await fn({ caseId, values: byId.get(caseId) ?? {}, cover });
    };

  const register =
    (kind: 'run' | 'skip' | 'concurrent') =>
    (
      caseId: string,
      fn: MatrixTestFunction = () => undefined,
      testOptions: MatrixTestOptions = {},
    ): void => {
      const meta = metaFor(caseId);
      const api =
        kind === 'run' ? vitest.test : kind === 'skip' ? vitest.test.skip : vitest.test.concurrent;
      api(caseId, { ...testOptions, meta: { [KEY]: meta } }, body(caseId, fn) as never);
    };

  const test = register('run') as MatrixTestApi;
  test.skip = register('skip');
  test.concurrent = register('concurrent');
  test.todo = (caseId: string): void => {
    const meta = metaFor(caseId);
    vitest.test.todo(caseId, { meta: { [KEY]: meta } } as never);
  };

  return { test, modelId: model.id, ...hashes };
}
