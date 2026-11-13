import { readReport } from '../reports/read-report.js';
import { renderHtml } from '../reports/html.js';
import { neutralize } from '../reports/terminal.js';
import { readSuggestionsFile } from '../suggestions/file.js';
import { parseOptions, requireOption } from './args.js';
import { EXIT } from './exit.js';
import { checkOutputPath, inFile, readJsonFile, writeOutputFile } from './files.js';
import type { CliIo } from './io.js';

export const REPORT_HELP = `Usage: nwise-kit report --input <report> --html <file> [--suggestions <file>] [--force]

Writes a self-contained HTML page for a static or runtime report that opens
offline. Every count in the report is recomputed first.

Options:
  --input <file>        Report JSON file
  --html <file>         Where to write the HTML page
  --suggestions <file>  Also show recommendations for the same matrix
  --force               Replace an existing --html file (never an input file)
  --help                Show this help
`;

export function reportCommand(argv: readonly string[], io: CliIo): number {
  const options = parseOptions(argv, {
    input: 'string',
    html: 'string',
    suggestions: 'string',
    force: 'boolean',
    help: 'boolean',
  });
  if (options.help === true) {
    io.stdout(REPORT_HELP);
    return EXIT.ok;
  }
  const input = requireOption(options.input, 'input', 'report');
  const html = requireOption(options.html, 'html', 'report');
  const force = options.force === true;
  const inputs = [input, ...(options.suggestions === undefined ? [] : [options.suggestions])];
  checkOutputPath(html, inputs, force);

  const stored = readJsonFile(input);
  const report = inFile(input, () => readReport(stored));
  const suggestionsPath = options.suggestions;
  const suggestions =
    suggestionsPath === undefined
      ? undefined
      : inFile(suggestionsPath, () =>
          readSuggestionsFile(readJsonFile(suggestionsPath), report.matrixHash),
        );
  writeOutputFile(html, renderHtml(report, suggestions), force);
  io.stdout(`HTML report written to ${neutralize(html)}\n`);
  return EXIT.ok;
}
