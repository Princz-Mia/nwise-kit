import { checkCasesSatisfyConstraints } from '../constraints/compile.js';
import { parseThreshold } from '../coverage/threshold.js';
import { validateMatrix } from '../model/cases.js';
import { validateModel } from '../model/validate-model.js';
import { neutralize, renderDiagnostic, renderSuggestions } from '../reports/terminal.js';
import { createSuggestionsFile, formatSuggestions } from '../suggestions/file.js';
import type { Basis } from '../suggestions/greedy.js';
import { suggestCases } from '../suggestions/greedy.js';
import { readReport } from '../reports/read-report.js';
import { invalidArguments, parseOptions, requireOption } from './args.js';
import { EXIT } from './exit.js';
import { checkOutputPath, inFile, readJsonFile, writeOutputFile } from './files.js';
import type { CliIo } from './io.js';

export const SUGGEST_HELP = `Usage: nwise-kit suggest --model <file> --cases <file> --out <file> [options]

Recommends configurations to add to the matrix so it covers more valid
interactions. Existing files and tests are never changed; add the
recommended cases, with their assertions, yourself.

Options:
  --model <file>          Model JSON file
  --cases <file>          Matrix JSON file with the existing test cases
  --out <file>            Where to write the suggestions JSON
  --target <percent>      Coverage to reach, 0 to 100 (default: 100)
  --max-new-cases <n>     Most recommendations to return (default: 10)
  --basis <name>          Coverage to start from: declared (default), observed
                          or passed. observed and passed need --run.
  --run <file>            Runtime report from a test run of this matrix
  --require-target        Exit 1 if the target is not reached
  --force                 Replace an existing --out file (never an input file)
  --help                  Show this help
`;

const CASE_BUDGET = /^[1-9]\d*$/;

export function suggestCommand(argv: readonly string[], io: CliIo): number {
  const options = parseOptions(argv, {
    model: 'string',
    cases: 'string',
    out: 'string',
    target: 'string',
    'max-new-cases': 'string',
    basis: 'string',
    run: 'string',
    'require-target': 'boolean',
    force: 'boolean',
    help: 'boolean',
  });
  if (options.help === true) {
    io.stdout(SUGGEST_HELP);
    return EXIT.ok;
  }
  const modelPath = requireOption(options.model, 'model', 'suggest');
  const casesPath = requireOption(options.cases, 'cases', 'suggest');
  const out = requireOption(options.out, 'out', 'suggest');
  const target = options.target ?? '100';
  parseThreshold(target);
  const budgetText = options['max-new-cases'] ?? '10';
  const maxNewCases = Number(budgetText);
  if (!CASE_BUDGET.test(budgetText) || !Number.isSafeInteger(maxNewCases)) {
    throw invalidArguments(
      `Invalid --max-new-cases "${neutralize(budgetText)}"`,
      'Use a positive whole number.',
    );
  }
  const basis = checkBasis(options.basis ?? 'declared', options.run);
  const force = options.force === true;
  checkOutputPath(
    out,
    [modelPath, casesPath, ...(options.run === undefined ? [] : [options.run])],
    force,
  );

  const model = readJsonFile(modelPath);
  const matrix = readJsonFile(casesPath);
  const validModel = inFile(modelPath, () => validateModel(model));
  inFile(casesPath, () => {
    checkCasesSatisfyConstraints(validModel, validateMatrix(matrix, validModel));
  });
  const evidence = options.run === undefined ? undefined : runEvidence(options.run);
  const result = suggestCases({
    model,
    cases: (matrix as { cases: unknown }).cases,
    targetCoverage: target,
    maxNewCases,
    basis,
    ...(evidence === undefined ? {} : { evidence }),
  });

  io.stdout(renderSuggestions(result));
  for (const diagnostic of result.diagnostics) {
    io.stderr(renderDiagnostic(diagnostic));
  }
  writeOutputFile(out, formatSuggestions(createSuggestionsFile(result, io.toolVersion)), force);
  io.stdout(`\nSuggestions written to ${neutralize(out)}\n`);
  return options['require-target'] === true && !result.targetReached ? EXIT.unmet : EXIT.ok;
}

function checkBasis(basis: string, run: string | undefined): Basis {
  if (basis === 'declared') {
    if (run !== undefined) {
      throw invalidArguments('--run is only used with --basis observed or passed');
    }
    return basis;
  }
  if (basis !== 'observed' && basis !== 'passed') {
    throw invalidArguments(
      `Unknown basis "${neutralize(basis)}"`,
      'Use declared, observed or passed.',
    );
  }
  if (run === undefined) {
    throw invalidArguments(`--basis ${basis} requires --run with a runtime report`);
  }
  return basis;
}

/** The evidence of a runtime report, after checking every count in it. */
function runEvidence(path: string): unknown {
  const stored = readJsonFile(path);
  const report = inFile(path, () => readReport(stored));
  if (report.kind !== 'runtime') {
    throw invalidArguments(
      `${neutralize(path)} is a static report`,
      'Pass a runtime report written by NwiseKitReporter during a test run.',
    );
  }
  return report.evidence;
}
