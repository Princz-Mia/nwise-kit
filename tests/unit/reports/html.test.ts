import { describe, expect, test } from 'vitest';
import {
  embedJson,
  escapeHtml,
  HTML_MISSING_LIMIT,
  renderHtml,
} from '../../../src/reports/html.js';
import { createRuntimeReport, createStaticReport } from '../../../src/reports/report.js';
import { createSuggestionsFile } from '../../../src/suggestions/file.js';
import { suggestCases } from '../../../src/suggestions/greedy.js';
import { golden, goldenRows } from '../../fixtures/models.js';
import { evidence, rows, testEntry } from '../evidence/helpers.js';

const matrix = { schemaVersion: 1, modelId: 'golden', cases: goldenRows('000', '111') };

function embedded(html: string): {
  missing: Record<string, { total: number; items: string[] } | null>;
  cases: { id: string }[];
  outcomes: Record<string, { outcome: string }>;
} {
  const match = /<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html);
  return JSON.parse(match?.[1] ?? 'null') as ReturnType<typeof embedded>;
}

describe('renderHtml', () => {
  const report = createStaticReport({ model: golden, matrix, toolVersion: '1.2.3' });
  const html = renderHtml(report);

  test('shows the same counts as the JSON report', () => {
    expect(html).toContain('declared<b>6 / 11 (54.55%)</b>');
    expect(html).toContain('observed<b>N/A</b>');
    expect(html).toContain('<td>A × B</td><td>2 / 3 (66.67%)</td>');
    const data = embedded(html);
    expect(data.missing['declared']?.total).toBe(5);
    expect(data.missing['declared']?.items).toEqual([
      'A=0, B=1',
      'A=0, C=1',
      'A=1, C=0',
      'B=0, C=1',
      'B=1, C=0',
    ]);
    expect(data.missing['observed']).toBeNull();
  });

  test('loads nothing from the network', () => {
    expect(html).toContain(`content="default-src 'none';`);
    expect(html).not.toMatch(/(src|href)\s*=\s*["']?https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:|@import/i);
  });

  test('keeps hostile values as data', () => {
    const hostile = '</script><img src=x onerror=alert(1)><!--\u2028';
    const model = {
      schemaVersion: 1,
      id: hostile,
      strength: 2,
      parameters: { [hostile]: [hostile, 'ok'], plain: [true, false] },
    };
    const page = renderHtml(
      createStaticReport({
        model,
        matrix: { schemaVersion: 1, modelId: hostile, cases: [] },
        toolVersion: '1.2.3',
      }),
    );
    expect(page).not.toContain('<img src=x');
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page).toContain('<title>&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
    const data = embedded(page) as unknown as { domains: Record<string, string[]> };
    expect(data.domains[hostile]).toEqual([hostile, 'ok']);
  });

  test('says when the embedded list of missing interactions is cut short', () => {
    const big = {
      schemaVersion: 1,
      id: 'big',
      strength: 2,
      parameters: {
        a: Array.from({ length: 150 }, (_, i) => i),
        b: Array.from({ length: 150 }, (_, i) => i),
      },
    };
    const page = renderHtml(
      createStaticReport({
        model: big,
        matrix: { schemaVersion: 1, modelId: 'big', cases: [] },
        toolVersion: '1.2.3',
      }),
    );
    const data = embedded(page);
    expect(data.missing['declared']?.total).toBe(22_500);
    expect(data.missing['declared']?.items).toHaveLength(HTML_MISSING_LIMIT);
    expect(page).toContain('the JSON report has all');
  });

  test('shows the run, its outcomes and recommendations for a runtime report', () => {
    const zero = rows[0]?.id ?? '';
    const one = rows[1]?.id ?? '';
    const run = evidence([
      testEntry(zero),
      testEntry(one, { outcome: 'failed', checkpointAttempts: [] }),
    ]);
    const runtime = createRuntimeReport({
      model: golden,
      matrix: { schemaVersion: 1, modelId: 'golden', cases: rows },
      evidence: run,
      toolVersion: '1.2.3',
    });
    const suggestions = createSuggestionsFile(
      suggestCases({ model: golden, cases: rows, basis: 'observed', evidence: run }),
      '1.2.3',
    );
    const page = renderHtml(runtime, suggestions);
    expect(page).toContain('Run <code>run-1</code>: complete; 2 tests registered.');
    expect(page).toContain('passed<b>3 / 11 (27.27%)</b>');
    expect(page).toContain('Recommendations <small>(projected, observed basis)</small>');
    expect(page).toContain(`<td>rerun-existing (${one})</td>`);
    expect(embedded(page).outcomes[one]?.outcome).toBe('failed');

    const incomplete = createRuntimeReport({
      model: golden,
      matrix: { schemaVersion: 1, modelId: 'golden', cases: rows },
      evidence: evidence([testEntry(zero, { outcome: 'missing' })]),
      toolVersion: '1.2.3',
    });
    expect(renderHtml(incomplete)).toContain(
      'incomplete — observed and passed coverage are unavailable',
    );
  });
});

describe('escaping helpers', () => {
  test('escape HTML and inline JSON', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(embedJson({ s: '</script>&\u2028' })).toBe(
      '{"s":"\\u003c/script\\u003e\\u0026\\u2028"}',
    );
  });
});
