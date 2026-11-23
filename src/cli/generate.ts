import { parseThreshold } from '../coverage/threshold.js';
import { neutralize, renderDiagnostic, renderGeneration } from '../reports/terminal.js';
import { suggestForInputs } from '../suggestions/greedy.js';
import { parseOptions, parsePositiveInteger, requireOption } from './args.js';
import { EXIT } from './exit.js';
import { checkOutputPath } from './files.js';
import { loadInputs } from './inputs.js';
import type { CliIo } from './io.js';
import { writeCombinedMatrix } from './matrix.js';

export const GENERATE_HELP = `Usage: nwise-kit generate --model <file> --out <file> [--cases <file>] [options]

Writes a matrix of test cases that covers the valid interactions of the
model strength: every value at strength 1, every pair at strength 2, and
every valid configuration at the number of parameters. With --cases it
keeps those cases and adds only what they miss. The cases are
configurations; write their assertions yourself.

Options:
  --model <file>          Model JSON file
  --out <file>            Where to write the matrix
  --cases <file>          Matrix JSON file with existing test cases to keep
  --target <percent>      Coverage to reach, 0 to 100 (default: 100)
  --max-new-cases <n>     Most cases to add (default: as many as the target needs)
  --force                 Replace an existing --out file (never an input file)
  --help                  Show this help

The matrix is written even when it falls short of the target; the exit
code is then 1.
`;

export function generateCommand(argv: readonly string[], io: CliIo): number {
  const options = parseOptions(argv, {
    model: 'string',
    cases: 'string',
    out: 'string',
    target: 'string',
    'max-new-cases': 'string',
    force: 'boolean',
    help: 'boolean',
  });
  if (options.help === true) {
    io.stdout(GENERATE_HELP);
    return EXIT.ok;
  }
  const modelPath = requireOption(options.model, 'model', 'generate');
  const casesPath = options.cases;
  const out = requireOption(options.out, 'out', 'generate');
  const target = options.target ?? '100';
  parseThreshold(target);
  const budget =
    options['max-new-cases'] === undefined
      ? undefined
      : parsePositiveInteger(options['max-new-cases'], 'max-new-cases');
  const force = options.force === true;
  checkOutputPath(
    out,
    [modelPath, casesPath].filter((path) => path !== undefined),
    force,
  );

  const inputs = loadInputs(modelPath, casesPath);
  const result = suggestForInputs(inputs, {
    targetCoverage: target,
    // No suite needs more cases than there are valid configurations.
    maxNewCases: budget ?? inputs.limits.maxValidConfigurations,
  });
  for (const diagnostic of result.diagnostics) {
    io.stderr(renderDiagnostic(diagnostic));
  }
  writeCombinedMatrix(out, inputs, result.recommendations, force);
  io.stdout(renderGeneration(result, inputs.cases.length));
  io.stdout(`\nMatrix written to ${neutralize(out)}\n`);
  return result.targetReached ? EXIT.ok : EXIT.unmet;
}
