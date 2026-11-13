import { lifecycleSuite } from '../matrix.js';

const suite = lifecycleSuite();

suite.test('passes', ({ cover }) => {
  cover();
});
suite.test('fails-before', () => {
  // The worker dies before this test can report an outcome.
  process.kill(process.pid, 'SIGKILL');
});
