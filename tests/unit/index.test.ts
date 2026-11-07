import { expect, test } from 'vitest';
import { TOOL_NAME } from '../../src/index.js';

test('exposes the package name', () => {
  expect(TOOL_NAME).toBe('nwise-kit');
});
