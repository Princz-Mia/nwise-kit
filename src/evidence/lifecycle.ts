import type { Diagnostic } from '../errors.js';
import type { TestEvidence } from './types.js';

/** What one test contributes to the runtime metrics, and why. */
export interface Contribution {
  /** The checkpoint was reached in some attempt of this run. */
  readonly observed: boolean;
  /** The final attempt reached the checkpoint and the test's final status is passed. */
  readonly passed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

function note(test: TestEvidence, code: string, message: string, hint?: string): Diagnostic {
  return {
    code,
    severity: 'warning',
    message: `Case "${test.caseId}" (${test.name}): ${message}`,
    caseIds: [test.caseId],
    ...(hint === undefined ? {} : { hint }),
  };
}

/**
 * Applies the lifecycle rules to one test. A checkpoint reached in any
 * attempt counts as observed; only a checkpoint in the final attempt of a
 * test whose final status is passed counts as passed. A teardown failure
 * after the checkpoint makes the test fail, so it counts as observed but
 * not passed.
 */
export function contribution(test: TestEvidence): Contribution {
  const observed = test.checkpointAttempts.length > 0;
  const finalAttempt = test.attempts - 1;
  const reachedInFinal = observed && test.checkpointAttempts.includes(finalAttempt);
  const passed = test.outcome === 'passed' && reachedInFinal;
  const diagnostics: Diagnostic[] = [];

  switch (test.outcome) {
    case 'skipped':
    case 'todo':
    case 'filtered':
      diagnostics.push(
        note(test, `TEST_${test.outcome.toUpperCase()}`, `the test was ${test.outcome}`),
      );
      break;
    case 'missing':
      diagnostics.push({
        ...note(test, 'OUTCOME_MISSING', 'no final outcome was received'),
        severity: 'error',
        hint: 'A worker may have crashed; the run is incomplete and no success is inferred.',
      });
      break;
    case 'failed':
      diagnostics.push(
        reachedInFinal
          ? note(
              test,
              'FAILED_AFTER_CHECKPOINT',
              'the test or its teardown failed after the checkpoint',
            )
          : observed
            ? note(
                test,
                'CHECKPOINT_ABSENT_IN_FINAL_ATTEMPT',
                'an earlier attempt reached the checkpoint, the final one did not, and the test failed',
              )
            : note(
                test,
                'FAILED_BEFORE_CHECKPOINT',
                'the test failed before reaching the checkpoint',
              ),
      );
      break;
    case 'passed':
      if (!observed) {
        diagnostics.push(
          note(
            test,
            'CHECKPOINT_NOT_REACHED',
            'the test passed without calling cover()',
            'Call cover() after the operation the test measures.',
          ),
        );
      } else if (!reachedInFinal) {
        diagnostics.push(
          note(
            test,
            'CHECKPOINT_ABSENT_IN_FINAL_ATTEMPT',
            'an earlier attempt reached the checkpoint but the final, passing one did not',
          ),
        );
      } else if (test.attempts > 1) {
        diagnostics.push(
          note(
            test,
            'RETRY_RECOVERED',
            `passed only after ${String(test.attempts - 1)} retr${test.attempts === 2 ? 'y' : 'ies'} (flaky)`,
            'Success needed a retry; that says nothing about the cause or future stability.',
          ),
        );
      }
      break;
  }
  if (test.lateCheckpoints > 0) {
    diagnostics.push(
      note(
        test,
        'LATE_CHECKPOINT',
        'cover() was called after its attempt had ended and was ignored',
        'Call cover() inside the test body, not from a callback that outlives it.',
      ),
    );
  }
  return { observed, passed, diagnostics };
}
