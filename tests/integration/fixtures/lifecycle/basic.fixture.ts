import { expect, test } from 'vitest';
import { lifecycleSuite } from '../matrix.js';

const suite = lifecycleSuite();
let firstRetry = true;
let late: (() => void) | undefined;

suite.test('passes', ({ cover, values }) => {
  expect(values['os']).toBe('Windows');
  cover();
  cover();
});
suite.test('fails-before', ({ cover }) => {
  expect(1).toBe(2);
  cover();
});
suite.test('fails-after', ({ cover }) => {
  cover();
  expect(1).toBe(2);
});
suite.test.skip('skipped', ({ cover }) => {
  cover();
});
suite.test.todo('todo');
suite.test(
  'retry-recovers',
  ({ cover }) => {
    if (firstRetry) {
      firstRetry = false;
      throw new Error('first attempt fails');
    }
    cover();
  },
  { retry: 2 },
);
let firstOnly = 0;
suite.test(
  'first-attempt-only',
  ({ cover }) => {
    if (firstOnly++ === 0) {
      cover();
    }
    throw new Error('always fails');
  },
  { retry: 1 },
);
suite.test('late-cover', ({ cover }) => {
  late = cover;
});
test('calls a checkpoint after its test ended', () => {
  late?.();
});
