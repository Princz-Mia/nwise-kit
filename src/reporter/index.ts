import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Reporter, TestCase, TestModule, Vitest } from 'vitest/node';
import { NwiseKitError } from '../errors.js';
import type { RunFilters, TestEvidence, TestOutcome } from '../evidence/types.js';
import type { RuntimeReport } from '../reports/report.js';
import { createRuntimeReport, formatReport } from '../reports/report.js';
import { formatMetric, neutralize, renderDiagnostic } from '../reports/terminal.js';
import type { CaseMeta, Handshake, Registration } from '../vitest/protocol.js';
import { KEY, PROTOCOL } from '../vitest/protocol.js';

export interface NwiseKitReporterOptions {
  /** Directory for results; each run gets its own subdirectory. Default: ./nwise-kit-results */
  readonly outputDir?: string;
  /** Where to print the summary and problems. Defaults to standard error. */
  readonly write?: (text: string) => void;
}

/** One matrix's report in a run, as listed in the manifest. */
export interface ManifestEntry {
  readonly modelId: string;
  readonly matrixHash: string;
  readonly runtimeComplete: boolean;
  /** Relative to the manifest. */
  readonly report: string;
}

export interface Manifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly reports: readonly ManifestEntry[];
  /** Problems that prevented a matrix's report from being written. */
  readonly errors: readonly string[];
}

interface MatrixState {
  registration: Registration | undefined;
  modelHash: string;
  readonly tests: Map<string, TestEvidence>;
}

function readToolVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

/**
 * Collects the checkpoints recorded by matrix tests and their final
 * outcomes, and writes one runtime report per matrix plus a manifest to
 * `<outputDir>/<runId>/`. Earlier runs live in their own directories and
 * are never merged. The reporter never changes Vitest's exit code.
 */
export class NwiseKitReporter implements Reporter {
  private readonly outputDir: string;
  private readonly write: (text: string) => void;
  private runId = '';
  private root = process.cwd();
  private filters: RunFilters | null = null;
  private pattern: RegExp | undefined;
  private readonly matrices = new Map<string, MatrixState>();
  private readonly problems: string[] = [];

  constructor(options: NwiseKitReporterOptions = {}) {
    this.outputDir = options.outputDir ?? './nwise-kit-results';
    this.write = options.write ?? ((text) => process.stderr.write(text));
  }

  onInit(vitest: Vitest): void {
    this.runId = randomUUID();
    this.root = vitest.config.root;
    const pattern = vitest.config.testNamePattern;
    this.pattern = pattern;
    this.filters = pattern === undefined ? null : { testNamePattern: pattern.source, files: [] };
    const handshake: Handshake = { protocol: PROTOCOL, runId: this.runId };
    vitest.provide(KEY, handshake);
  }

  onTestCaseResult(testCase: TestCase): void {
    this.record(testCase, false);
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly unknown[],
    reason: string,
  ): void {
    const infrastructure: string[] = [];
    if (reason === 'interrupted') {
      infrastructure.push('The test run was interrupted');
    }
    if (unhandledErrors.length > 0) {
      infrastructure.push(
        `${String(unhandledErrors.length)} unhandled error(s) occurred during the run`,
      );
    }
    for (const module of testModules) {
      for (const error of module.errors()) {
        infrastructure.push(`${this.file(module.moduleId)}: ${error.message}`);
      }
      // Tests that never reported a result, for example after a worker crash.
      for (const testCase of module.children.allTests()) {
        this.record(testCase, true);
      }
    }
    try {
      this.finish(infrastructure);
    } catch (error) {
      this.write(
        `nwise-kit: could not write runtime reports: ${neutralize(error instanceof Error ? error.message : String(error))}\n`,
      );
    }
  }

  private record(testCase: TestCase, atEnd: boolean): void {
    const meta = testCase.meta()[KEY];
    if (meta === undefined) {
      return;
    }
    const state = this.matrix(meta);
    if (atEnd && state.tests.has(testCase.id)) {
      return;
    }
    state.tests.set(testCase.id, this.evidence(testCase, meta, atEnd));
  }

  private matrix(meta: CaseMeta): MatrixState {
    let state = this.matrices.get(meta.matrixHash);
    if (state === undefined) {
      state = { registration: undefined, modelHash: meta.modelHash, tests: new Map() };
      this.matrices.set(meta.matrixHash, state);
    }
    state.registration ??= meta.registration;
    return state;
  }

  private evidence(testCase: TestCase, meta: CaseMeta, atEnd: boolean): TestEvidence {
    const result = testCase.result();
    const mode = testCase.options.mode;
    let outcome: TestOutcome;
    if (atEnd && result.state === 'pending') {
      outcome = 'missing';
    } else if (result.state === 'passed' || result.state === 'failed') {
      outcome = result.state;
    } else if (this.pattern !== undefined && !this.pattern.test(testCase.fullName)) {
      // Vitest marks tests excluded by a name filter as skipped.
      outcome = 'filtered';
    } else if (mode === 'todo') {
      outcome = 'todo';
    } else if (mode === 'skip') {
      outcome = 'skipped';
    } else {
      // Not skipped by the test itself, so excluded by `.only` or a similar filter.
      outcome = 'filtered';
    }
    const ran = outcome === 'passed' || outcome === 'failed' || outcome === 'missing';
    const diagnostic = testCase.diagnostic();
    // A test lost to a crash may never have started; claim no attempts for it.
    const attempts = !ran
      ? 0
      : diagnostic === undefined
        ? outcome === 'missing'
          ? 0
          : 1
        : diagnostic.retryCount + 1;
    const location = testCase.location;
    return {
      testId: testCase.id,
      runId: meta.runId,
      caseId: meta.caseId,
      name: testCase.fullName,
      workerId: meta.workerId ?? 'unknown',
      outcome,
      attempts,
      checkpointAttempts: ran ? meta.checkpoints.filter((a) => a < attempts) : [],
      lateCheckpoints: meta.late,
      location:
        location === undefined
          ? null
          : {
              file: this.file(testCase.module.moduleId),
              line: location.line,
              column: location.column,
            },
    };
  }

  private file(moduleId: string): string {
    return relative(this.root, moduleId).replaceAll('\\', '/');
  }

  private finish(infrastructure: readonly string[]): void {
    if (this.matrices.size === 0) {
      return;
    }
    const toolVersion = readToolVersion();
    const directory = resolve(this.root, this.outputDir, this.runId);
    mkdirSync(directory, { recursive: true });
    const entries: ManifestEntry[] = [];
    const errors: string[] = [...this.problems];
    for (const [hash, state] of [...this.matrices].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (state.registration === undefined) {
        errors.push(`Matrix ${hash.slice(0, 12)}: no test file registered its model and cases`);
        continue;
      }
      let report: RuntimeReport;
      try {
        report = createRuntimeReport({
          model: state.registration.model,
          matrix: {
            schemaVersion: 1,
            modelId: (state.registration.model as { id: string }).id,
            cases: state.registration.cases,
          },
          evidence: {
            schemaVersion: 1,
            runId: this.runId,
            modelHash: state.modelHash,
            matrixHash: hash,
            filters: this.filters,
            infrastructureErrors: infrastructure,
            tests: [...state.tests.values()],
          },
          toolVersion,
        });
      } catch (error) {
        const details =
          error instanceof NwiseKitError ? error.diagnostics.map(renderDiagnostic).join('') : '';
        errors.push(
          `Matrix ${hash.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.write(`nwise-kit: ${neutralize(errors.at(-1) ?? '')}\n${details}`);
        continue;
      }
      const file = `${hash}.json`;
      writeFileSync(join(directory, file), formatReport(report));
      entries.push({
        modelId: report.model.id,
        matrixHash: hash,
        runtimeComplete: report.runtimeComplete,
        report: file,
      });
      this.write(
        `nwise-kit: ${neutralize(report.model.id)} declared ${formatMetric(report.metrics.declared)}, observed ${formatMetric(report.metrics.observed)}, passed ${formatMetric(report.metrics.passed)}${report.runtimeComplete ? '' : ' (run incomplete)'}\n`,
      );
    }
    const manifest: Manifest = { schemaVersion: 1, runId: this.runId, reports: entries, errors };
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    this.write(
      `nwise-kit: runtime reports in ${neutralize(relative(process.cwd(), directory) || '.')}\n`,
    );
  }
}
