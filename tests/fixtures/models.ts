/** A, B and C over [0, 1] with A=1 implies B=1: six valid configurations. */
export const golden = {
  schemaVersion: 1,
  id: 'golden',
  strength: 2,
  parameters: { A: [0, 1], B: [0, 1], C: [0, 1] },
  constraints: [{ id: 'a-needs-b', rule: { implies: [{ eq: ['A', 1] }, { eq: ['B', 1] }] } }],
} as const;

/** Builds golden rows from strings such as "011", read as A, B, C. */
export function goldenRows(...configs: string[]): { id: string; values: Record<string, number> }[] {
  return configs.map((config, i) => ({
    id: `row-${String(i)}-${config}`,
    values: { A: Number(config[0]), B: Number(config[1]), C: Number(config[2]) },
  }));
}

export const checkout = {
  schemaVersion: 1,
  id: 'checkout-access',
  strength: 2,
  parameters: {
    role: ['guest', 'member', 'admin'],
    plan: ['free', 'premium'],
    newCheckout: [false, true],
    region: ['EU', 'US'],
  },
  constraints: [
    {
      id: 'guest-has-free-plan',
      rule: { implies: [{ eq: ['role', 'guest'] }, { eq: ['plan', 'free'] }] },
    },
  ],
} as const;
