import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { parseJson } from '../../../src/model/json.js';
import { createStaticReport, formatReport } from '../../../src/reports/report.js';
import { golden, goldenRows } from '../../fixtures/models.js';

function read(path: string): unknown {
  return parseJson(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
ajv.addSchema(read('schemas/model.schema.json') as object);
ajv.addSchema(read('schemas/matrix.schema.json') as object);
const reportSchema = ajv.compile(read('schemas/report.schema.json') as object);

const matrix = { schemaVersion: 1, modelId: 'golden', cases: goldenRows('111', '000') };

describe('createStaticReport', () => {
  const report = createStaticReport({ model: golden, matrix, toolVersion: '1.2.3' });

  test('records the contract version, producer and kind', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      toolVersion: '1.2.3',
      kind: 'static',
      strength: 2,
      analysisComplete: true,
      runtimeComplete: null,
      runId: null,
      filters: null,
    });
  });

  test('embeds the normalised model and the matrix rows in input order', () => {
    expect(report.model).toEqual(golden);
    expect(report.matrix).toEqual(matrix);
  });

  test('carries exact counts, the profile and missing interactions with indices', () => {
    expect(report.metrics).toEqual({
      declared: { covered: 6, total: 11, percentage: 600 / 11 },
      observed: null,
      passed: null,
    });
    expect(report.profile.map((p) => p.declared.covered)).toEqual([6, 6]);
    expect(report.missing.declared[0]).toEqual({
      parameters: ['A', 'B'],
      indices: [0, 1],
      values: [0, 1],
    });
    expect(report.missing.observed).toBeNull();
    expect(report.limits.maxParameters).toBe(20);
  });

  test('matches the report schema', () => {
    expect(reportSchema(JSON.parse(formatReport(report)))).toBe(true);
  });

  test.each(
    readdirSync(new URL('../../../examples/', import.meta.url), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(new URL(`../../../examples/${entry.name}/`, import.meta.url))
          .filter((name) => name.startsWith('cases'))
          .map((name) => [entry.name, name]),
      ),
  )('produces a schema-valid report for %s/%s', (dir, file) => {
    const built = createStaticReport({
      model: read(`examples/${dir}/model.json`),
      matrix: read(`examples/${dir}/${file}`),
      toolVersion: '0.0.0',
    });
    expect(reportSchema(JSON.parse(formatReport(built)))).toBe(true);
  });

  test('rejects a matrix written for another model', () => {
    expect(() =>
      createStaticReport({
        model: golden,
        matrix: { ...matrix, modelId: 'other' },
        toolVersion: '1.2.3',
      }),
    ).toThrow(NwiseKitError);
  });

  test('formats as indented JSON ending in a newline', () => {
    const text = formatReport(report);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 1,');
  });
});
