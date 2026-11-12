import type { Metric } from '../coverage/coverage.js';
import type { Diagnostic } from '../errors.js';
import type { DomainValue } from '../model/types.js';
import type { StopReason, SuggestionResult } from '../suggestions/greedy.js';
import type { CoverageVerdict } from './check.js';
import type { ReportInteraction, StaticReport } from './report.js';

/** How many missing interactions the summary lists before truncating. */
export const MISSING_PREVIEW = 10;

// C0 controls, DEL, C1 controls and Unicode bidirectional overrides and isolates.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Escapes characters that could move the cursor, change colours or
 * reorder text in a terminal, so user-supplied values print as data.
 */
export function neutralize(text: string): string {
  return text.replace(UNSAFE, (ch) => `\\u{${(ch.codePointAt(0) ?? 0).toString(16)}}`);
}

export function formatPercentage(metric: Metric | null): string {
  return metric === null ? 'N/A' : `${metric.percentage.toFixed(2)}%`;
}

export function formatMetric(metric: Metric | null): string {
  return metric === null
    ? 'N/A'
    : `${String(metric.covered)}/${String(metric.total)} (${formatPercentage(metric)})`;
}

function formatValue(value: DomainValue): string {
  return neutralize(String(value));
}

export function formatInteraction(interaction: ReportInteraction): string {
  return interaction.parameters
    .map((name, i) => `${neutralize(name)}=${formatValue(interaction.values[i] ?? '')}`)
    .join(', ');
}

const KIND_OF_INTERACTION: Readonly<Record<number, string>> = {
  1: 'values',
  2: 'pairs',
  3: 'triples',
};

/** The human-readable summary of a static report, for standard output. */
export function renderSummary(report: StaticReport, preview = MISSING_PREVIEW): string {
  const { metrics, universe, matrix } = report;
  const unit = KIND_OF_INTERACTION[report.strength] ?? 'interactions';
  const lines = [
    `Model ${neutralize(report.model.id)}, strength ${String(report.strength)}`,
    `Matrix: ${String(matrix.cases.length)} case${matrix.cases.length === 1 ? '' : 's'}, hash ${report.matrixHash.slice(0, 12)}`,
    `Analysis: complete; ${String(universe.validConfigurations)} of ${String(universe.rawConfigurations)} configurations valid, ${String(universe.interactions)} valid ${unit}`,
    '',
    'Coverage',
    `  declared  ${formatMetric(metrics.declared)}`,
    `  observed  ${formatMetric(metrics.observed)}`,
    `  passed    ${formatMetric(metrics.passed)}`,
    '',
    `By strength: ${report.profile
      .map((p) => `${String(p.strength)}-way ${formatMetric(p.declared)}`)
      .join(', ')}`,
  ];
  const missing = report.missing.declared;
  if (missing.length === 0) {
    lines.push('', `No valid ${unit} are missing.`);
  } else {
    lines.push('', `Missing ${unit} (${String(missing.length)}):`);
    for (const interaction of missing.slice(0, preview)) {
      lines.push(`  ${formatInteraction(interaction)}`);
    }
    if (missing.length > preview) {
      lines.push(
        `  ... and ${String(missing.length - preview)} more; write a JSON report to see all`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** One diagnostic as indented lines, for standard error. */
export function renderDiagnostic(diagnostic: Diagnostic): string {
  const where =
    diagnostic.path === undefined || diagnostic.path === ''
      ? ''
      : `${neutralize(diagnostic.path)}: `;
  const lines = [
    `  ${diagnostic.severity} ${diagnostic.code}: ${where}${neutralize(diagnostic.message)}`,
  ];
  if (diagnostic.hint !== undefined) {
    lines.push(`    hint: ${neutralize(diagnostic.hint)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A percentage truncated, not rounded, to three decimals. Thresholds have
 * at most three decimals, so the printed figure never contradicts the
 * gate: 94,999 of 100,000 prints as 94.999%, not 95.00%.
 */
export function formatGatePercentage(covered: number, total: number): string {
  const thousandths = (BigInt(covered) * 100_000n) / BigInt(total);
  const whole = thousandths / 1000n;
  const fraction = (thousandths % 1000n).toString().padStart(3, '0');
  return `${whole.toString()}.${fraction}%`;
}

/** The result of a coverage gate, for standard output. */
export function renderVerdict(verdict: CoverageVerdict): string {
  const outcome = verdict.passed ? 'PASS' : 'FAIL';
  const relation = verdict.passed ? 'meets' : 'is below';
  const counts = `${String(verdict.covered)}/${String(verdict.total)} (${formatGatePercentage(verdict.covered, verdict.total)})`;
  return `${outcome}: ${verdict.metric} coverage ${counts} ${relation} the ${verdict.threshold}% threshold\n`;
}

const STOP_REASONS: Readonly<Record<StopReason, string>> = {
  'target-reached': 'the target was reached',
  'case-budget': 'the case budget ran out before the target',
  'work-budget': 'the work budget ran out before the target',
};

/** The human-readable summary of a suggestion search, for standard output. */
export function renderSuggestions(result: SuggestionResult): string {
  const lines = [
    `Model ${neutralize(result.modelId)}, strength ${String(result.strength)}, basis ${result.basis}`,
    `Baseline: ${formatMetric(result.baseline)}`,
    `Target: ${result.target}%, at most ${String(result.maxNewCases)} new case${result.maxNewCases === 1 ? '' : 's'}`,
    '',
  ];
  if (result.recommendations.length === 0) {
    lines.push('No recommendations.');
  } else {
    lines.push('Recommendations (projected: they count once the tests exist and pass):');
    result.recommendations.forEach((r, i) => {
      const values = Object.entries(r.values)
        .map(([name, value]) => `${neutralize(name)}=${neutralize(String(value))}`)
        .join(', ');
      const matched =
        r.matchedCaseIds.length === 0
          ? ''
          : ` (existing: ${r.matchedCaseIds.map((id) => neutralize(id)).join(', ')})`;
      lines.push(
        `  ${String(i + 1)}. ${r.kind}${matched}: ${values}`,
        `     +${String(r.gain)}, projected ${formatMetric(r.projected)}`,
      );
    });
  }
  lines.push('', `Stopped because ${STOP_REASONS[result.stopReason]}.`);
  lines.push(`Projected coverage: ${formatMetric(result.projected)}`);
  if (result.remaining.length > 0) {
    lines.push(`Still missing: ${String(result.remaining.length)}`);
  }
  return `${lines.join('\n')}\n`;
}
