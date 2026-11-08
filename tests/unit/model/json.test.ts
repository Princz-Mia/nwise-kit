import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { NwiseKitError } from '../../../src/errors.js';
import { parseJson } from '../../../src/model/json.js';

function parseError(text: string): NwiseKitError {
  try {
    parseJson(text);
  } catch (error) {
    if (error instanceof NwiseKitError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected parseJson to throw');
}

describe('parseJson', () => {
  test('agrees with JSON.parse on valid documents', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = JSON.stringify(value, null, 1);
        expect(parseJson(text)).toStrictEqual(JSON.parse(text));
      }),
    );
  });

  test('reads escapes, a byte order mark and surrounding whitespace', () => {
    expect(parseJson('﻿ \n{"a":"\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9"}\r\n')).toEqual({
      a: '"\\/\b\f\n\r\té',
    });
  });

  test('keeps -0 so the model validator can normalise it', () => {
    expect(Object.is(parseJson('-0'), -0)).toBe(true);
  });

  test('rejects a duplicate key with its path and position', () => {
    const error = parseError('{\n  "parameters": {\n    "role": [1],\n    "role": [2]\n  }\n}');
    expect(error.code).toBe('INVALID_JSON');
    expect(error.message).toBe('Duplicate key "role" at line 4, column 5');
    expect(error.diagnostics[0]?.path).toBe('/parameters/role');
  });

  test('escapes pointer tokens in the reported path', () => {
    expect(parseError('{"a/b~c": {"x": 1, "x": 2}}').diagnostics[0]?.path).toBe('/a~1b~0c/x');
  });

  test('stores __proto__ as an own property without changing the prototype', () => {
    const value = parseJson('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  test.each([
    ['', 'Unexpected end of input'],
    ['{"a":1,}', 'Expected a property name in double quotes'],
    ['[1,]', 'Unexpected character "]"'],
    ['[1 2]', "Expected ',' or ']'"],
    ['{"a" 1}', "Expected ':'"],
    ['{"a":1 "b":2}', "Expected ',' or '}'"],
    ['"abc', 'Unterminated string'],
    ['"a\tb"', 'Control characters must be escaped in strings'],
    ['"\\x"', 'Invalid escape sequence \\x'],
    ['"\\u12"', 'Invalid \\u escape; expected four hexadecimal digits'],
    ['01', 'Unexpected content after the JSON value'],
    ['NaN', 'Unexpected character "N"'],
    ['tru', 'Unexpected token; did you mean true?'],
    ["{'a':1}", 'Expected a property name in double quotes'],
  ])('rejects %j', (text, message) => {
    const error = parseError(text);
    expect(error.code).toBe('INVALID_JSON');
    expect(error.message.startsWith(message)).toBe(true);
  });

  test('rejects excessive nesting instead of overflowing the stack', () => {
    expect(parseError('['.repeat(100_000)).message).toMatch(/nested deeper than 512 levels/);
  });
});
