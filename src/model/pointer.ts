/** Appends one reference token to a JSON Pointer (RFC 6901). */
export function appendPointer(base: string, token: string | number): string {
  const text = String(token).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${base}/${text}`;
}
