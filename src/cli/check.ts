import { NwiseKitError } from '../errors.js';
import type { MetricName } from '../reports/check.js';
import { checkCoverage, METRIC_NAMES, parseThreshold } from '../reports/check.js';
import { readStaticReport } from '../reports/read-report.js';
import { neutralize, renderVerdict } from '../reports/terminal.js';
import { invalidArguments, parseOptions, requireOption } from './args.js';
import { EXIT } from './exit.js';
import { readJsonFile } from './files.js';
import type { CliIo } from './io.js';

export const CHECK_HELP = `Usage: nwise-kit check --input <report> --min-coverage <percent> [--metric <name>]

Checks one coverage metric of a report against a threshold. Every count in
the report is recomputed first; an edited report is rejected.

Options:
  --input <file>            Report JSON file written by "nwise-kit analyze --json"
  --min-coverage <percent>  Threshold from 0 to 100, at most three decimals
  --metric <name>           declared, observed or passed (default: observed).
                            Reports from "analyze" have declared coverage only.
  --help                    Show this help

Exits 0 when the threshold is met and 1 when it is not. Keep your test
runner's own exit code too: a met threshold does not mean the tests passed.
`;

export function checkCommand(argv: readonly string[], io: CliIo): number {
  const options = parseOptions(argv, {
    input: 'string',
    'min-coverage': 'string',
    metric: 'string',
    help: 'boolean',
  });
  if (options.help === true) {
    io.stdout(CHECK_HELP);
    return EXIT.ok;
  }
  const input = requireOption(options.input, 'input', 'check');
  const threshold = requireOption(options['min-coverage'], 'min-coverage', 'check');
  const metric = metricName(options.metric ?? 'observed');
  parseThreshold(threshold);

  const stored = readJsonFile(input);
  let report;
  try {
    report = readStaticReport(stored);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      throw new NwiseKitError(error.code, `${input}: ${error.message}`, error.diagnostics);
    }
    throw error;
  }
  const verdict = checkCoverage(report, metric, threshold);
  io.stdout(renderVerdict(verdict));
  return verdict.passed ? EXIT.ok : EXIT.unmet;
}

function metricName(value: string): MetricName {
  const found = METRIC_NAMES.find((name) => name === value);
  if (found === undefined) {
    throw invalidArguments(
      `Unknown metric "${neutralize(value)}"`,
      `Use one of: ${METRIC_NAMES.join(', ')}.`,
    );
  }
  return found;
}
