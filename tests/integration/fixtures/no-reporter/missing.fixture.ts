import { lifecycleSuite } from '../matrix.js';

const suite = lifecycleSuite();

suite.test('passes', ({ cover }) => {
  cover();
});
