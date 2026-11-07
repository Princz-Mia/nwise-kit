import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { DEFAULT_LIMITS, resolveLimits } from '../../../src/model/limits.js';

describe('resolveLimits', () => {
  test('applies overrides on top of the defaults', () => {
    expect(resolveLimits({ maxParameters: 5 })).toEqual({ ...DEFAULT_LIMITS, maxParameters: 5 });
  });

  test.each([{ maxParameters: 0 }, { maxParameters: 1.5 }, { analysisTimeMs: -1 }, { bogus: 1 }])(
    'rejects %j',
    (overrides) => {
      expect(() => resolveLimits(overrides as never)).toThrow(NwiseKitError);
    },
  );
});
