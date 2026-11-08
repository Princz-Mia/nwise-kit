/**
 * A deliberately naive reference for small models. It shares no code with
 * the production engine: it evaluates rules on value maps by truth table,
 * enumerates assignments recursively and identifies interactions by JSON
 * strings. Use it only to cross-check exact counts.
 */

export type Value = string | number | boolean;

export type Rule =
  | { eq: [string, Value] }
  | { not: Rule }
  | { and: Rule[] }
  | { or: Rule[] }
  | { implies: [Rule, Rule] };

export interface ReferenceModel {
  strength: number;
  parameters: Record<string, Value[]>;
  constraints: { id: string; rule: Rule }[];
}

export type Assignment = Record<string, Value>;

export interface ReferenceResult {
  valid: Assignment[];
  total: number;
  covered: number;
  /** Group key (JSON of parameter names) to counts. */
  groups: Map<string, { total: number; covered: number }>;
  missing: Set<string>;
}

export function holds(rule: Rule, a: Assignment): boolean {
  if ('eq' in rule) {
    return a[rule.eq[0]] === rule.eq[1];
  }
  if ('not' in rule) {
    return !holds(rule.not, a);
  }
  if ('and' in rule) {
    let all = true;
    for (const r of rule.and) {
      all = all && holds(r, a);
    }
    return all;
  }
  if ('or' in rule) {
    let any = false;
    for (const r of rule.or) {
      any = any || holds(r, a);
    }
    return any;
  }
  const [p, q] = rule.implies;
  // Truth table of material implication.
  const table: Record<string, boolean> = { TT: true, TF: false, FT: true, FF: true };
  return table[(holds(p, a) ? 'T' : 'F') + (holds(q, a) ? 'T' : 'F')] === true;
}

export function allAssignments(parameters: Record<string, Value[]>): Assignment[] {
  const names = Object.keys(parameters);
  const out: Assignment[] = [];
  const walk = (i: number, partial: Assignment): void => {
    if (i === names.length) {
      out.push({ ...partial });
      return;
    }
    const name = names[i] as string;
    for (const value of parameters[name] ?? []) {
      walk(i + 1, { ...partial, [name]: value });
    }
  };
  walk(0, {});
  return out;
}

function subsets(names: string[], t: number): string[][] {
  if (t === 0) {
    return [[]];
  }
  const result: string[][] = [];
  names.forEach((name, i) => {
    for (const rest of subsets(names.slice(i + 1), t - 1)) {
      result.push([name, ...rest]);
    }
  });
  return result;
}

function interactions(a: Assignment, groups: string[][]): [string, string][] {
  return groups.map((g) => [JSON.stringify(g), JSON.stringify(g.map((n) => [n, a[n]]))]);
}

export function validAssignments(model: ReferenceModel): Assignment[] {
  return allAssignments(model.parameters).filter((a) =>
    model.constraints.every((c) => holds(c.rule, a)),
  );
}

export function referenceCoverage(model: ReferenceModel, rows: Assignment[]): ReferenceResult {
  const valid = validAssignments(model);
  const groups = subsets(Object.keys(model.parameters).sort(), model.strength);
  const universe = new Map<string, string>();
  for (const a of valid) {
    for (const [group, key] of interactions(a, groups)) {
      universe.set(key, group);
    }
  }
  const covered = new Set<string>();
  for (const row of rows) {
    for (const [, key] of interactions(row, groups)) {
      covered.add(key);
    }
  }
  const counts = new Map<string, { total: number; covered: number }>();
  for (const g of groups) {
    counts.set(JSON.stringify(g), { total: 0, covered: 0 });
  }
  const missing = new Set<string>();
  for (const [key, group] of universe) {
    const c = counts.get(group);
    if (c !== undefined) {
      c.total++;
      if (covered.has(key)) {
        c.covered++;
      } else {
        missing.add(key);
      }
    }
  }
  return {
    valid,
    total: universe.size,
    covered: [...covered].filter((k) => universe.has(k)).length,
    groups: counts,
    missing,
  };
}
