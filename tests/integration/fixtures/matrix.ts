import { readFileSync } from 'node:fs';
import { createMatrixSuite } from '../../../src/vitest/index.js';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

export function lifecycleSuite() {
  const matrix = read('./cases.json') as { cases: unknown };
  return createMatrixSuite({ model: read('./model.json'), cases: matrix.cases });
}
