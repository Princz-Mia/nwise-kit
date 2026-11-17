import { formatReport, staticReportFor } from '../reports/report.js';
import { neutralize, renderDiagnostic, renderSummary } from '../reports/terminal.js';
import { parseOptions, requireOption } from './args.js';
import { EXIT } from './exit.js';
import { checkOutputPath, inFile, writeOutputFile } from './files.js';
import { loadInputs } from './inputs.js';
import type { CliIo } from './io.js';

export const ANALYZE_HELP = `Usage: nwise-kit analyze --model <file> --cases <file> [--json <file>] [--force]

Measures which valid interactions of the model strength the matrix covers,
and prints a summary with the missing ones.

Options:
  --model <file>   Model JSON file
  --cases <file>   Matrix JSON file with the existing test cases
  --json <file>    Also write the full report as JSON
  --force          Replace an existing --json file (never an input file)
  --help           Show this help
`;

export function analyzeCommand(argv: readonly string[], io: CliIo): number {
  const options = parseOptions(argv, {
    model: 'string',
    cases: 'string',
    json: 'string',
    force: 'boolean',
    help: 'boolean',
  });
  if (options.help === true) {
    io.stdout(ANALYZE_HELP);
    return EXIT.ok;
  }
  const modelPath = requireOption(options.model, 'model', 'analyze');
  const casesPath = requireOption(options.cases, 'cases', 'analyze');
  const force = options.force === true;
  if (options.json !== undefined) {
    checkOutputPath(options.json, [modelPath, casesPath], force);
  }

  const inputs = loadInputs(modelPath, casesPath);
  // What can still fail here (an unsatisfiable or oversized model) is the model's doing.
  const report = inFile(modelPath, () => staticReportFor(inputs, io.toolVersion));

  io.stdout(renderSummary(report));
  for (const diagnostic of report.diagnostics) {
    io.stderr(renderDiagnostic(diagnostic));
  }
  if (options.json !== undefined) {
    writeOutputFile(options.json, formatReport(report), force);
    io.stdout(`\nReport written to ${neutralize(options.json)}\n`);
  }
  return EXIT.ok;
}
