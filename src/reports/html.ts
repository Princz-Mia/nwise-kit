import type { Metric } from '../coverage/coverage.js';
import type { SuggestionsFile } from '../suggestions/file.js';
import type { Report, ReportInteraction } from './report.js';

/** Most missing interactions embedded per metric; exact counts are always shown. */
export const HTML_MISSING_LIMIT = 20_000;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * Serialises data for an inline <script type="application/json"> block.
 * Escaping <, > and & keeps "</script>" and HTML comments in user values
 * from ending the block; U+2028 and U+2029 are escaped for old parsers.
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function metricText(metric: Metric | null): string {
  return metric === null
    ? 'N/A'
    : `${String(metric.covered)} / ${String(metric.total)} (${metric.percentage.toFixed(2)}%)`;
}

function cell(text: string, attributes = ''): string {
  return `<td${attributes}>${escapeHtml(text)}</td>`;
}

function interactionText(interaction: ReportInteraction): string {
  return interaction.parameters.map((p, i) => `${p}=${String(interaction.values[i])}`).join(', ');
}

/**
 * Renders a report, and optionally suggestions for the same matrix, as a
 * single self-contained HTML page. It needs no network: styles and
 * scripts are inline and a content security policy blocks every
 * request. All user-supplied text is escaped.
 */
export function renderHtml(report: Report, suggestions?: SuggestionsFile): string {
  const runtime = report.kind === 'runtime';
  const metrics = (['declared', 'observed', 'passed'] as const).map(
    (name) => [name, report.metrics[name]] as const,
  );
  const missing = Object.fromEntries(
    (['declared', 'observed', 'passed'] as const).map((name) => {
      const list = report.missing[name];
      return [
        name,
        list === null
          ? null
          : { total: list.length, items: list.slice(0, HTML_MISSING_LIMIT).map(interactionText) },
      ];
    }),
  );
  const outcomes = runtime
    ? Object.fromEntries(
        report.evidence.tests.map((t) => [
          t.caseId,
          {
            outcome: t.outcome,
            attempts: t.attempts,
            checkpoints: t.checkpointAttempts,
            name: t.name,
          },
        ]),
      )
    : {};
  const data = {
    parameters: Object.keys(report.model.parameters).sort(),
    domains: report.model.parameters,
    cases: report.matrix.cases,
    missing,
    outcomes,
    limit: HTML_MISSING_LIMIT,
  };

  const groupRows = report.groups
    .map(
      (g) =>
        `<tr>${cell(g.parameters.join(' × '))}${cell(metricText(g.declared))}${cell(metricText(g.observed))}${cell(metricText(g.passed))}</tr>`,
    )
    .join('\n');
  const profileRows = report.profile
    .map(
      (p) =>
        `<tr>${cell(`${String(p.strength)}-way`)}${cell(metricText(p.declared))}${cell(metricText(p.observed))}${cell(metricText(p.passed))}</tr>`,
    )
    .join('\n');
  const diagnosticRows = report.diagnostics
    .map(
      (d) =>
        `<tr>${cell(d.severity, ` class="${d.severity}"`)}${cell(d.code)}${cell(d.caseIds?.join(', ') ?? d.path ?? '')}${cell(d.message)}</tr>`,
    )
    .join('\n');

  const run = runtime
    ? `<p>Run <code>${escapeHtml(report.runId)}</code>: ${
        report.runtimeComplete
          ? 'complete'
          : '<strong class="error">incomplete — observed and passed coverage are unavailable</strong>'
      }; ${String(report.evidence.tests.length)} tests registered.${
        report.filters === null
          ? ''
          : ` Filtered run (${escapeHtml(report.filters.testNamePattern ?? 'files')}); the full matrix stays the denominator.`
      }</p>`
    : '<p>Static analysis: observed and passed coverage need a test run.</p>';

  const recommendations =
    suggestions === undefined
      ? ''
      : `<section>
<h2>Recommendations <small>(projected, ${escapeHtml(suggestions.basis)} basis)</small></h2>
<p>Projected coverage counts only once the cases exist, have assertions and run. Stopped because ${escapeHtml(suggestions.stopReason.replace('-', ' '))}; target ${escapeHtml(suggestions.target)}% ${suggestions.targetReached ? 'reached' : 'not reached'}.</p>
<table><thead><tr><th>#</th><th>Kind</th><th>Configuration</th><th>Gain</th><th>Projected</th></tr></thead><tbody>
${suggestions.recommendations
  .map(
    (r, i) =>
      `<tr>${cell(String(i + 1))}${cell(r.kind + (r.matchedCaseIds.length > 0 ? ` (${r.matchedCaseIds.join(', ')})` : ''))}${cell(
        Object.entries(r.values)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(', '),
      )}${cell(`+${String(r.gain)}`)}${cell(metricText(r.projected))}</tr>`,
  )
  .join('\n')}
</tbody></table>
</section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(report.model.id)} coverage</title>
<style>
:root { --fg: #1d1d1f; --bg: #ffffff; --muted: #6e6e73; --line: #d2d2d7; --accent: #0b57d0; --error: #b3261e; --warning: #8a5300; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e8ed; --bg: #161618; --muted: #a1a1a6; --line: #3a3a3c; --accent: #8ab4f8; --error: #f2b8b5; --warning: #f6c66b; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px 64px; font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
h1 { margin: 0 0 4px; font-size: 24px; } h2 { margin: 32px 0 8px; font-size: 18px; } small { color: var(--muted); font-weight: normal; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); } code { font: 13px ui-monospace, monospace; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.metric { border: 1px solid var(--line); border-radius: 8px; padding: 12px; } .metric b { display: block; font-size: 20px; }
.error { color: var(--error); } .warning { color: var(--warning); } .muted { color: var(--muted); }
input, select { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } .scroll { overflow-x: auto; }
</style>
</head>
<body>
<header>
<h1>${escapeHtml(report.model.id)}</h1>
<p class="muted">Strength ${String(report.strength)} · ${String(report.matrix.cases.length)} cases · ${String(report.universe.validConfigurations)} of ${String(report.universe.rawConfigurations)} configurations valid · ${String(report.universe.interactions)} valid interactions · matrix <code>${escapeHtml(report.matrixHash.slice(0, 12))}</code> · nwise-kit ${escapeHtml(report.toolVersion)}</p>
${run}
</header>
<section>
<h2>Coverage</h2>
<div class="metrics">
${metrics.map(([name, metric]) => `<div class="metric">${escapeHtml(name)}<b>${escapeHtml(metricText(metric))}</b></div>`).join('\n')}
</div>
<div class="scroll"><table><thead><tr><th>Strength</th><th>Declared</th><th>Observed</th><th>Passed</th></tr></thead><tbody>
${profileRows}
</tbody></table></div>
</section>
<section>
<h2>By parameter group</h2>
<div class="scroll"><table><thead><tr><th>Group</th><th>Declared</th><th>Observed</th><th>Passed</th></tr></thead><tbody>
${groupRows}
</tbody></table></div>
</section>
<section>
<h2>Missing interactions</h2>
<div class="controls">
<label>Metric <select id="metric"></select></label>
<label>Filter <input id="filter" type="search" placeholder="e.g. role=guest"></label>
<span id="count" class="muted"></span>
</div>
<div class="scroll"><table><tbody id="missing"></tbody></table></div>
</section>
<section>
<h2>Find cases for an interaction</h2>
<p class="muted">Choose values; the cases that contain all of them are listed with their outcome in the run.</p>
<div class="controls" id="pickers"></div>
<div class="scroll"><table><thead><tr><th>Case</th><th>Values</th><th>Outcome</th></tr></thead><tbody id="cases"></tbody></table></div>
</section>
${recommendations}
<section>
<h2>Diagnostics</h2>
<div class="scroll"><table><thead><tr><th>Severity</th><th>Code</th><th>Where</th><th>Message</th></tr></thead><tbody>
${diagnosticRows || '<tr><td colspan="4" class="muted">None</td></tr>'}
</tbody></table></div>
</section>
<script type="application/json" id="data">${embedJson(data)}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  var metric = document.getElementById('metric'), filter = document.getElementById('filter');
  ['passed', 'observed', 'declared'].forEach(function (name) {
    if (data.missing[name]) { var o = el('option', name); o.value = name; metric.appendChild(o); }
  });
  function showMissing() {
    var entry = data.missing[metric.value], body = document.getElementById('missing'), needle = filter.value.trim().toLowerCase();
    body.textContent = '';
    var shown = 0, matched = 0;
    entry.items.forEach(function (text) {
      if (needle && text.toLowerCase().indexOf(needle) < 0) return;
      matched++;
      if (shown >= 500) return;
      shown++;
      var tr = el('tr'); tr.appendChild(el('td', text)); body.appendChild(tr);
    });
    var note = matched + ' shown of ' + entry.total + ' missing';
    if (shown < matched) note += ' (first 500 displayed; refine the filter)';
    if (entry.items.length < entry.total) note += '; the page embeds the first ' + data.limit + ', the JSON report has all';
    document.getElementById('count').textContent = note;
  }
  metric.addEventListener('change', showMissing); filter.addEventListener('input', showMissing); showMissing();
  var pickers = document.getElementById('pickers'), selects = {};
  data.parameters.forEach(function (name) {
    var label = el('label', name + ' '), select = el('select');
    var any = el('option', 'any'); any.value = ''; select.appendChild(any);
    data.domains[name].forEach(function (value, i) { var o = el('option', String(value)); o.value = String(i); select.appendChild(o); });
    select.addEventListener('change', showCases); selects[name] = select; label.appendChild(select); pickers.appendChild(label);
  });
  function showCases() {
    var body = document.getElementById('cases'); body.textContent = '';
    var chosen = data.parameters.filter(function (n) { return selects[n].value !== ''; });
    if (chosen.length === 0) { var tr0 = el('tr'); var td0 = el('td', 'Choose at least one value.', 'muted'); td0.colSpan = 3; tr0.appendChild(td0); body.appendChild(tr0); return; }
    var hits = data.cases.filter(function (c) {
      return chosen.every(function (n) { return c.values[n] === data.domains[n][Number(selects[n].value)]; });
    });
    if (hits.length === 0) { var tr1 = el('tr'); var td1 = el('td', 'No case contains these values.', 'muted'); td1.colSpan = 3; tr1.appendChild(td1); body.appendChild(tr1); }
    hits.forEach(function (c) {
      var tr = el('tr'), r = data.outcomes[c.id];
      tr.appendChild(el('td', c.id));
      tr.appendChild(el('td', data.parameters.map(function (n) { return n + '=' + String(c.values[n]); }).join(', ')));
      tr.appendChild(el('td', r ? r.outcome + ', ' + r.attempts + ' attempt(s), checkpoint in ' + (r.checkpoints.length ? r.checkpoints.join(', ') : 'none') : 'not run'));
      body.appendChild(tr);
    });
  }
  showCases();
})();
</script>
</body>
</html>
`;
}
