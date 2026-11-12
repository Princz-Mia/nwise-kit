/**
 * The terminal state of a registered test in a run.
 * `missing`: the test was selected but no final outcome arrived, for
 * example because its worker crashed.
 */
export type TestOutcome = 'passed' | 'failed' | 'skipped' | 'todo' | 'filtered' | 'missing';

export const TEST_OUTCOMES: readonly TestOutcome[] = [
  'passed',
  'failed',
  'skipped',
  'todo',
  'filtered',
  'missing',
];

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** What one test, bound to one matrix case, did during a run. */
export interface TestEvidence {
  /** Unique identity of the test within the run. */
  readonly testId: string;
  readonly runId: string;
  readonly caseId: string;
  readonly name: string;
  readonly workerId: string;
  readonly outcome: TestOutcome;
  /** Attempts that ran, including retries; 0 when the test never ran. */
  readonly attempts: number;
  /** Zero-based attempts in which the checkpoint was reached, ascending. */
  readonly checkpointAttempts: readonly number[];
  /** Checkpoint calls made after their attempt had ended; they never count. */
  readonly lateCheckpoints: number;
  readonly location: SourceLocation | null;
}

export interface RunFilters {
  readonly testNamePattern: string | null;
  readonly files: readonly string[];
}

/** Everything a run produced for one matrix. */
export interface RunEvidence {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly modelHash: string;
  readonly matrixHash: string;
  /** The filters the run was started with, or null for an unfiltered run. */
  readonly filters: RunFilters | null;
  /** Problems that invalidate the run as a whole, such as a crashed worker. */
  readonly infrastructureErrors: readonly string[];
  readonly tests: readonly TestEvidence[];
}
