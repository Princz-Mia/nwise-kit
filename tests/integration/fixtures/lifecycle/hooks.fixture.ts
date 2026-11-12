import { afterEach, describe } from 'vitest';
import { lifecycleSuite } from '../matrix.js';

const suite = lifecycleSuite();

describe('teardown', () => {
  afterEach(() => {
    throw new Error('teardown broke');
  });
  suite.test('teardown-fails', ({ cover }) => {
    cover();
  });
});

describe('concurrent', () => {
  suite.test.concurrent('concurrent-a', async ({ cover }) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    cover();
    cover();
  });
  suite.test.concurrent('concurrent-b', async ({ cover }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    cover();
  });
});
