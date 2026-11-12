import { validateCases } from '../../../src/model/cases.js';
import { matrixHash, modelHash } from '../../../src/model/canonical.js';
import { validateModel } from '../../../src/model/validate-model.js';
import type { TestEvidence } from '../../../src/evidence/types.js';
import { golden, goldenRows } from '../../fixtures/models.js';

export const rows = goldenRows('000', '111');
const model = validateModel(golden);

export const hashes = {
  modelHash: modelHash(model),
  matrixHash: matrixHash(model, validateCases(rows, model)),
};

/** A test entry with passing defaults, bound to a golden case. */
export function testEntry(caseId: string, changes: Partial<TestEvidence> = {}): TestEvidence {
  return {
    testId: `test:${caseId}`,
    runId: 'run-1',
    caseId,
    name: `covers ${caseId}`,
    workerId: '1',
    outcome: 'passed',
    attempts: 1,
    checkpointAttempts: [0],
    lateCheckpoints: 0,
    location: { file: 'checkout.test.ts', line: 3, column: 1 },
    ...changes,
  };
}

export function evidence(tests: TestEvidence[], changes: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    ...hashes,
    filters: null,
    infrastructureErrors: [],
    tests,
    ...changes,
  };
}
