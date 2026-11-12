/** Where the CLI writes, and what it reports as its version. */
export interface CliIo {
  /** Summaries and results. */
  readonly stdout: (text: string) => void;
  /** Diagnostics and errors. */
  readonly stderr: (text: string) => void;
  readonly toolVersion: string;
}
