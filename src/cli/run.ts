import { neutralize } from '../reports/terminal.js';
import { analyzeCommand } from './analyze.js';
import { invalidArguments } from './args.js';
import { checkCommand } from './check.js';
import { EXIT, exitCodeFor, renderError } from './exit.js';
import type { CliIo } from './io.js';

type Command = (argv: readonly string[], io: CliIo) => number;

const COMMANDS: Readonly<Record<string, Command>> = {
  analyze: analyzeCommand,
  check: checkCommand,
};

export const USAGE = `Usage: nwise-kit <command> [options]

Combinatorial coverage for the tests you already have.

Commands:
  analyze   Measure the coverage of an existing test matrix
  check     Check a report's coverage against a threshold

Run "nwise-kit <command> --help" for a command's options.

Options:
  --help      Show this help
  --version   Show the version

Exit codes:
  0  Success; any requested gate passed
  1  A coverage gate was not met
  2  Invalid arguments or input, an unavailable metric or an unsatisfiable model
  3  Incomplete analysis, a resource limit, an I/O failure or an internal error
`;

/** Runs the CLI and returns its exit code. Never throws. */
export function run(argv: readonly string[], io: CliIo): number {
  const [first, ...rest] = argv;
  try {
    if (first === undefined) {
      io.stderr(USAGE);
      return EXIT.invalid;
    }
    if (first === '--help' || first === '-h') {
      io.stdout(USAGE);
      return EXIT.ok;
    }
    if (first === '--version' || first === '-v') {
      io.stdout(`${io.toolVersion}\n`);
      return EXIT.ok;
    }
    const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
    if (command === undefined) {
      throw invalidArguments(
        `Unknown command "${neutralize(first)}"`,
        `Available commands: ${Object.keys(COMMANDS).join(', ')}.`,
      );
    }
    return command(rest, io);
  } catch (error) {
    io.stderr(renderError(error));
    return exitCodeFor(error);
  }
}
