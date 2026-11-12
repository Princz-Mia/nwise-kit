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
