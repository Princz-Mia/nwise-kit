import type { DomainValue } from '../model/types.js';

/** Version of the data exchanged between the adapter and the reporter. */
export const PROTOCOL = 1;

/** Key under which the reporter provides the handshake and tests store their metadata. */
export const KEY = 'nwiseKit';

/** What the reporter provides to every worker before tests run. */
export interface Handshake {
  readonly protocol: typeof PROTOCOL;
  readonly runId: string;
}

/** The model and matrix, sent once per test file with the first registered test. */
export interface Registration {
  readonly model: unknown;
  readonly cases: readonly { readonly id: string; readonly values: Record<string, DomainValue> }[];
}

/** Metadata on each matrix test, set at collection and updated as attempts run. */
export interface CaseMeta {
  readonly protocol: typeof PROTOCOL;
  readonly runId: string;
  readonly modelHash: string;
  readonly matrixHash: string;
  readonly caseId: string;
  /** Present on the first test each test file registers for a matrix. */
  registration?: Registration;
  /** Zero-based attempts that reached the checkpoint. */
  checkpoints: number[];
  /** Checkpoint calls after their attempt had ended. */
  late: number;
  /** Process that ran the test. */
  workerId?: string;
}

declare module 'vitest' {
  interface ProvidedContext {
    nwiseKit: Handshake;
  }
  interface TaskMeta {
    nwiseKit?: CaseMeta;
  }
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * Whether a value read from test metadata has the shape the adapter
 * writes. Test files can put anything there, so the reporter checks it
 * before use.
 */
export function isCaseMeta(value: unknown): value is CaseMeta {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const meta = value as Record<string, unknown>;
  const { checkpoints, registration } = meta;
  return (
    meta['protocol'] === PROTOCOL &&
    typeof meta['runId'] === 'string' &&
    typeof meta['caseId'] === 'string' &&
    typeof meta['modelHash'] === 'string' &&
    HASH.test(meta['modelHash']) &&
    typeof meta['matrixHash'] === 'string' &&
    HASH.test(meta['matrixHash']) &&
    Array.isArray(checkpoints) &&
    checkpoints.every((attempt) => Number.isSafeInteger(attempt) && (attempt as number) >= 0) &&
    Number.isSafeInteger(meta['late']) &&
    (meta['workerId'] === undefined || typeof meta['workerId'] === 'string') &&
    (registration === undefined ||
      (typeof registration === 'object' &&
        registration !== null &&
        Array.isArray((registration as Record<string, unknown>)['cases'])))
  );
}
