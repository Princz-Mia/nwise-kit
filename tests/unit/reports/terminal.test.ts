import { describe, expect, test } from 'vitest';
import { createStaticReport } from '../../../src/reports/report.js';
import {
  formatGatePercentage,
  neutralize,
  renderDiagnostic,
  renderSummary,
  renderVerdict,
} from '../../../src/reports/terminal.js';
import { golden, goldenRows } from '../../fixtures/models.js';

const report = createStaticReport({
  model: golden,
  matrix: { schemaVersion: 1, modelId: 'golden', cases: goldenRows('000', '111') },
  toolVersion: '1.2.3',
});

describe('neutralize', () => {
  test('escapes terminal control and bidi characters', () => {
    expect(neutralize('a\u001b[31mb\nc\u0007\u009b\u202ed')).toBe(
      'a\\u{1b}[31mb\\u{a}c\\u{7}\\u{9b}\\u{202e}d',
    );
  });

  test('leaves ordinary text, accents and emoji alone', () => {
    expect(neutralize('Zoë </script> 😀')).toBe('Zoë </script> 😀');
  });
});

describe('renderSummary', () => {
  const text = renderSummary(report);

  test('shows identity, integrity, counts and unavailable metrics as N/A', () => {
    expect(text).toContain('Model golden, strength 2');
    expect(text).toContain(`Matrix: 2 cases, hash ${report.matrixHash.slice(0, 12)}`);
    expect(text).toContain('Analysis: complete; 6 of 8 configurations valid, 11 valid pairs');
    expect(text).toContain('  declared  6/11 (54.55%)');
    expect(text).toContain('  observed  N/A');
    expect(text).toContain('  passed    N/A');
    expect(text).toContain('By strength: 1-way 6/6 (100.00%), 2-way 6/11 (54.55%)');
  });

  test('lists missing interactions and says when the list is cut short', () => {
    expect(text).toContain('Missing pairs (5):\n  A=0, B=1\n  A=0, C=1\n');
    const short = renderSummary(report, 2);
    expect(short).toContain('  ... and 3 more; write a JSON report to see all');
    expect(short).not.toContain('B=0, C=1');
  });

  test('says when nothing is missing', () => {
    const full = createStaticReport({
      model: golden,
      matrix: {
        schemaVersion: 1,
        modelId: 'golden',
        cases: goldenRows('000', '001', '010', '011', '110', '111'),
      },
      toolVersion: '1.2.3',
    });
    expect(renderSummary(full)).toContain('No valid pairs are missing.');
  });

  test('prints hostile values as data', () => {
    const model = {
      schemaVersion: 1,
      id: 'm\u001b[2J',
      strength: 2,
      parameters: { 'p\u202e': ['\u001b]0;x\u0007', 'ok'], q: [true, false] },
    };
    const hostile = createStaticReport({
      model,
      matrix: { schemaVersion: 1, modelId: model.id, cases: [] },
      toolVersion: '1.2.3',
    });
    const output = renderSummary(hostile);
    const unsafe = ['\u001b', '\u0007', '\u202e'];
    expect(Array.from(output).filter((ch) => unsafe.includes(ch))).toEqual([]);
    expect(output).toContain('Model m\\u{1b}[2J');
    expect(output).toContain('p\\u{202e}=\\u{1b}]0;x\\u{7}');
  });
});

describe('renderDiagnostic', () => {
  test('shows severity, code, path, message and hint', () => {
    expect(
      renderDiagnostic({
        code: 'EMPTY_DOMAIN',
        severity: 'error',
        message: 'A domain needs at least one value',
        path: '/parameters/A',
        hint: 'Add a value.',
      }),
    ).toBe(
      '  error EMPTY_DOMAIN: /parameters/A: A domain needs at least one value\n    hint: Add a value.\n',
    );
  });
});

describe('renderVerdict', () => {
  test('truncates rather than rounds, so a failure never prints as the threshold', () => {
    expect(formatGatePercentage(94_999, 100_000)).toBe('94.999%');
    expect(formatGatePercentage(6, 11)).toBe('54.545%');
    expect(formatGatePercentage(11, 11)).toBe('100.000%');
    expect(
      renderVerdict({
        passed: false,
        metric: 'declared',
        covered: 94_999,
        total: 100_000,
        percentage: 94.999,
        threshold: '95',
        thresholdThousandths: 95_000,
      }),
    ).toBe('FAIL: declared coverage 94999/100000 (94.999%) is below the 95% threshold\n');
  });
});
