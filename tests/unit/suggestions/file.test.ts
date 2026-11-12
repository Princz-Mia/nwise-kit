import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';
import { parseJson } from '../../../src/model/json.js';
import { createSuggestionsFile, formatSuggestions } from '../../../src/suggestions/file.js';
import { suggestCases } from '../../../src/suggestions/greedy.js';
import { golden, goldenRows } from '../../fixtures/models.js';

function read(path: string): unknown {
  return parseJson(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
}

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
const schema = ajv.compile(read('schemas/suggestions.schema.json') as object);

describe('suggestions file', () => {
  test('adds the contract version, producer and kind to the result', () => {
    const result = suggestCases({ model: golden, cases: goldenRows('000', '111') });
    const file = createSuggestionsFile(result, '1.2.3');
    expect(file).toMatchObject({ schemaVersion: 1, toolVersion: '1.2.3', kind: 'suggestions' });
    expect(file.recommendations).toEqual(result.recommendations);
    expect(formatSuggestions(file).endsWith('}\n')).toBe(true);
  });

  test.each(
    readdirSync(new URL('../../../examples/', import.meta.url), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(new URL(`../../../examples/${entry.name}/`, import.meta.url))
          .filter((name) => name.startsWith('cases'))
          .map((name) => [entry.name, name]),
      ),
  )('is schema-valid for %s/%s, including partial results', (dir, name) => {
    const model = read(`examples/${dir}/model.json`);
    const cases = (read(`examples/${dir}/${name}`) as { cases: unknown }).cases;
    for (const maxNewCases of [1, 20]) {
      const file = createSuggestionsFile(suggestCases({ model, cases, maxNewCases }), '0.0.0');
      expect(schema(JSON.parse(formatSuggestions(file)))).toBe(true);
    }
  });
});
