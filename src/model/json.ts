import { NwiseKitError } from '../errors.js';
import { appendPointer } from './pointer.js';

const MAX_NESTING = 512;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * Parses JSON text like `JSON.parse`, but rejects duplicate object keys.
 *
 * `JSON.parse` keeps the last occurrence of a repeated key, which can
 * silently change a model. Keys such as `__proto__` become ordinary own
 * properties and never alter an object's prototype.
 */
export function parseJson(text: string): unknown {
  return new Parser(text).parseDocument();
}

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseDocument(): unknown {
    if (this.text.charCodeAt(0) === 0xfeff) {
      this.pos = 1;
    }
    this.skipWhitespace();
    const value = this.parseValue('', 0);
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      this.fail('Unexpected content after the JSON value', '');
    }
    return value;
  }

  private parseValue(path: string, depth: number): unknown {
    if (depth > MAX_NESTING) {
      this.fail(`Values are nested deeper than ${MAX_NESTING} levels`, path);
    }
    const ch = this.text[this.pos];
    switch (ch) {
      case '{':
        return this.parseObject(path, depth);
      case '[':
        return this.parseArray(path, depth);
      case '"':
        return this.parseString(path);
      case 't':
        return this.parseLiteral('true', true, path);
      case 'f':
        return this.parseLiteral('false', false, path);
      case 'n':
        return this.parseLiteral('null', null, path);
      case undefined:
        return this.fail('Unexpected end of input', path);
      default:
        if (ch === '-' || (ch >= '0' && ch <= '9')) {
          return this.parseNumber(path);
        }
        return this.fail(`Unexpected character ${JSON.stringify(ch)}`, path);
    }
  }

  private parseObject(path: string, depth: number): Record<string, unknown> {
    this.pos++;
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') {
        this.fail('Expected a property name in double quotes', path);
      }
      const keyStart = this.pos;
      const key = this.parseString(path);
      const childPath = appendPointer(path, key);
      if (seen.has(key)) {
        this.fail(
          `Duplicate key ${JSON.stringify(key)}`,
          childPath,
          keyStart,
          'Remove one of the entries; the parser does not pick one for you.',
        );
      }
      seen.add(key);
      this.skipWhitespace();
      this.expect(':', childPath);
      this.skipWhitespace();
      const value = this.parseValue(childPath, depth + 1);
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipWhitespace();
      const next = this.text[this.pos];
      this.pos++;
      if (next === '}') {
        return result;
      }
      if (next !== ',') {
        this.pos--;
        this.fail("Expected ',' or '}'", path);
      }
    }
  }

  private parseArray(path: string, depth: number): unknown[] {
    this.pos++;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue(appendPointer(path, result.length), depth + 1));
      this.skipWhitespace();
      const next = this.text[this.pos];
      this.pos++;
      if (next === ']') {
        return result;
      }
      if (next !== ',') {
        this.pos--;
        this.fail("Expected ',' or ']'", path);
      }
    }
  }

  private parseString(path: string): string {
    const start = this.pos;
    this.pos++;
    let out = '';
    let chunkStart = this.pos;
    for (;;) {
      const code = this.text.charCodeAt(this.pos);
      if (Number.isNaN(code)) {
        this.fail('Unterminated string', path, start);
      }
      if (code === 0x22) {
        out += this.text.slice(chunkStart, this.pos);
        this.pos++;
        return out;
      }
      if (code < 0x20) {
        this.fail('Control characters must be escaped in strings', path);
      }
      if (code !== 0x5c) {
        this.pos++;
        continue;
      }
      out += this.text.slice(chunkStart, this.pos);
      const escape = this.text.charAt(this.pos + 1);
      if (escape === 'u') {
        const hex = this.text.slice(this.pos + 2, this.pos + 6);
        if (!HEX4.test(hex)) {
          this.fail('Invalid \\u escape; expected four hexadecimal digits', path);
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.pos += 6;
      } else {
        const replacement = ESCAPES[escape];
        if (replacement === undefined) {
          this.fail(`Invalid escape sequence \\${escape}`, path);
        }
        out += replacement;
        this.pos += 2;
      }
      chunkStart = this.pos;
    }
  }

  private parseNumber(path: string): number {
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (match === null) {
      return this.fail('Invalid number', path);
    }
    this.pos += match[0].length;
    return Number(match[0]);
  }

  private parseLiteral<T>(word: string, value: T, path: string): T {
    if (!this.text.startsWith(word, this.pos)) {
      this.fail(`Unexpected token; did you mean ${word}?`, path);
    }
    this.pos += word.length;
    return value;
  }

  private expect(ch: string, path: string): void {
    if (this.text[this.pos] !== ch) {
      this.fail(`Expected '${ch}'`, path);
    }
    this.pos++;
  }

  private skipWhitespace(): void {
    for (;;) {
      const ch = this.text[this.pos];
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
        return;
      }
      this.pos++;
    }
  }

  private fail(message: string, path: string, at = this.pos, hint?: string): never {
    const { line, column } = this.locate(at);
    const located = `${message} at line ${line}, column ${column}`;
    throw new NwiseKitError('INVALID_JSON', located, [
      {
        code: 'INVALID_JSON',
        severity: 'error',
        message: located,
        path,
        ...(hint === undefined ? {} : { hint }),
      },
    ]);
  }

  private locate(offset: number): { line: number; column: number } {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < offset && i < this.text.length; i++) {
      if (this.text.charCodeAt(i) === 0x0a) {
        line++;
        lineStart = i + 1;
      }
    }
    return { line, column: offset - lineStart + 1 };
  }
}
