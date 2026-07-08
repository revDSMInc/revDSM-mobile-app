/**
 * RolloutView tests — mobile app (mhalt-revdsm-mobile).
 *
 * Source of truth: web app rollout-and-drop-logs.js + PremiumQuoteCard logic.
 *
 * Covers the pure-logic helpers extracted from RolloutView.tsx:
 *   - floorTier       → mobile: lines 34-35   | web: calculateResultUtil $200 floor
 *   - effectiveCostOf → mobile: lines 41-43   | web: validatePriceForPaymentMethod floored cost
 *   - resolveMethod   → mobile: lines 25-26   | web: resolvePaymentMethod
 *   - endPriceError   → mobile: lines 51-57   | web: validatePriceForPaymentMethod
 *   - fmtMoney        → mobile: line 22        | web: currencyFormatter
 *   - visibleCalculators filtering  → mobile: line 1067-1069 | web: ViewAllCalculators.visibleCalculators
 */

// Extract the pure functions from RolloutView to test them in isolation.
// Sourced from mobile RolloutView.tsx lines 22-58.
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

const resolveMethod = (calc: any, userDefault?: string, defaultMethod?: string) =>
  calc.paymentMethod || userDefault || defaultMethod || 'check';

const floorTier = (value: number, hasItems: boolean) =>
  hasItems && value < 200 ? 200 : value;

function effectiveCostOf(calc: any): number {
  return floorTier(calc.totals?.cost || 0, (calc.totals?.retail || 0) > 0);
}

interface DealPlan { minPrice?: number; label?: string; }

function endPriceError(
  plans: Record<string, DealPlan>,
  price: number,
  calc: any,
  method: string,
): string | null {
  if (price <= 0) return null;
  const cost = effectiveCostOf(calc);
  if (price < cost) return `Price cannot be less than cost (${fmtMoney(cost)})`;
  const min = plans[method]?.minPrice || 0;
  if (min && price < min) return `This plan requires a minimum price of ${fmtMoney(min)}.`;
  return null;
}

// ── floorTier ───────────────────────────────────────────────────────────
// Web: calculateResultUtil applies $200 floor independently per tier once
// there are items (retail > 0). Any priced job where a tier < $200 → $200.
describe('floorTier', () => {
  test('returns 200 when value < 200 and hasItems = true', () => {
    expect(floorTier(50, true)).toBe(200);
    expect(floorTier(199, true)).toBe(200);
    expect(floorTier(0, true)).toBe(200);
  });

  test('returns original value when value >= 200 and hasItems = true', () => {
    expect(floorTier(200, true)).toBe(200);
    expect(floorTier(500, true)).toBe(500);
    expect(floorTier(10000, true)).toBe(10000);
  });

  test('returns original value when hasItems = false (no retail)', () => {
    expect(floorTier(0, false)).toBe(0);
    expect(floorTier(100, false)).toBe(100);
    expect(floorTier(200, false)).toBe(200);
  });
});

// ── effectiveCostOf ─────────────────────────────────────────────────────
// Web parity: the cost used for validation must pass through the $200 job-min
// floor. A job with retail items gets at least $200 cost for validation.
describe('effectiveCostOf', () => {
  test('returns floored cost when retail > 0 and cost < 200', () => {
    expect(effectiveCostOf({ totals: { cost: 50, retail: 100 } })).toBe(200);
    expect(effectiveCostOf({ totals: { cost: 0, retail: 300 } })).toBe(200);
  });

  test('returns raw cost when cost >= 200 (has retail)', () => {
    expect(effectiveCostOf({ totals: { cost: 200, retail: 500 } })).toBe(200);
    expect(effectiveCostOf({ totals: { cost: 350, retail: 1000 } })).toBe(350);
  });

  test('returns raw cost when retail === 0 (no floor applied)', () => {
    expect(effectiveCostOf({ totals: { cost: 50, retail: 0 } })).toBe(50);
    expect(effectiveCostOf({ totals: { cost: 0, retail: 0 } })).toBe(0);
  });
});

// ── resolveMethod ───────────────────────────────────────────────────────
// Web parity (resolvePaymentMethod): saved calc method → user default →
// company-level default → 'check'.
describe('resolveMethod', () => {
  const calc = { paymentMethod: 'mcVisaDscvr' };

  test('uses calc.paymentMethod when present', () => {
    expect(resolveMethod(calc, 'check', 'check')).toBe('mcVisaDscvr');
    expect(resolveMethod(calc, undefined, 'check')).toBe('mcVisaDscvr');
  });

  test('falls back to userDefault when calc has no paymentMethod', () => {
    expect(resolveMethod({ paymentMethod: undefined }, 'wf4103', 'check')).toBe('wf4103');
    expect(resolveMethod({ paymentMethod: '' }, 'wf4103', 'check')).toBe('wf4103');
  });

  test('falls back to defaultMethod when no calc method and no user default', () => {
    expect(resolveMethod({ paymentMethod: '' }, undefined, 'lowes_ach')).toBe('lowes_ach');
  });

  test('ultimate fallback is "check"', () => {
    expect(resolveMethod({}, undefined, undefined)).toBe('check');
    expect(resolveMethod({}, '', '')).toBe('check');
  });
});

// ── endPriceError ───────────────────────────────────────────────────────
// Web parity (validatePriceForPaymentMethod): check floored cost, then plan
// minPrice. Both conditions can fire, but cost is checked first.
describe('endPriceError', () => {
  const plans: Record<string, DealPlan> = {
    check: { minPrice: 0 },
    mcVisaDscvr: { minPrice: 0 },
    wf4103: { minPrice: 7500 },
    lowes_ach: { minPrice: 1500 },
  };

  const calcWithItems = { totals: { cost: 300, retail: 500 } };

  test('returns null when price is 0 or negative', () => {
    expect(endPriceError(plans, 0, calcWithItems, 'check')).toBeNull();
    expect(endPriceError(plans, -1, calcWithItems, 'check')).toBeNull();
  });

  test('returns error when price is below floored cost', () => {
    // effectiveCostOf(calc) = floorTier(300, true) = 300
    const err = endPriceError(plans, 250, calcWithItems, 'check');
    expect(err).toMatch(/Price cannot be less than cost/);
    expect(err).toContain('$300');
  });

  test('returns null when price >= cost and no plan minimum', () => {
    expect(endPriceError(plans, 300, calcWithItems, 'check')).toBeNull();
    expect(endPriceError(plans, 500, calcWithItems, 'mcVisaDscvr')).toBeNull();
  });

  test('returns plan-minimum error when price < plan minPrice', () => {
    // wf4103 minPrice = 7500, price = 1000 is also < cost 300, so cost error wins.
    // Test with price between cost and plan minimum.
    const calcBig = { totals: { cost: 5000, retail: 10000 } };
    const err = endPriceError(plans, 7000, calcBig, 'wf4103');
    expect(err).toMatch(/requires a minimum price/);
    expect(err).toContain('$7,500');
  });

  test('no plan-minimum error when plan has no minPrice', () => {
    expect(endPriceError(plans, 500, calcWithItems, 'mcVisaDscvr')).toBeNull();
  });

  test('cost error beats plan-minimum error when both apply', () => {
    // cost = 300, price = 200 → cost error (not plan min)
    const err = endPriceError(plans, 200, calcWithItems, 'wf4103');
    expect(err).toMatch(/less than cost/);
    expect(err).toContain('$300');
  });

  test('$200 floor: errored below the $200 floor cost', () => {
    const calcCheap = { totals: { cost: 50, retail: 100 } };
    // effectiveCostOf = 200
    const err = endPriceError(plans, 150, calcCheap, 'check');
    expect(err).toContain('$200');
  });
});

// ── fmtMoney ────────────────────────────────────────────────────────────
describe('fmtMoney', () => {
  test('formats positive numbers with $ and commas', () => {
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(5)).toBe('$5');
    expect(fmtMoney(1000)).toBe('$1,000');
    expect(fmtMoney(1234567)).toBe('$1,234,567');
    expect(fmtMoney(1999.9)).toBe('$2,000');
    expect(fmtMoney(1999.4)).toBe('$1,999');
  });

  test('handles zero and edge cases', () => {
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(0.4)).toBe('$0');
    expect(fmtMoney(0.5)).toBe('$1');
  });
});

// ── visibleCalculators filtering ────────────────────────────────────────
// Web parity (ViewAllCalculators.visibleCalculators): a calculator whose
// title is still a bare number (derived name is just its position) must NOT
// appear in the rollout — only real, named calculators can be priced.
describe('visibleCalculators filtering', () => {
  const visibleCalculators = (calculators: any[]) =>
    calculators.filter((c) => !/^\d+$/.test((c.title || '').trim()));

  test('excludes calculators with purely numeric titles', () => {
    const all = [
      { id: 'a', title: '1' },
      { id: 'b', title: 'Job 1' },
      { id: 'c', title: '2' },
      { id: 'd', title: 'Gutters' },
      { id: 'e', title: '3' },
    ];
    expect(visibleCalculators(all).map((c) => c.id)).toEqual(['b', 'd']);
  });

  test('includes all calculators when all have meaningful titles', () => {
    const all = [
      { id: 'a', title: 'Gutters' },
      { id: 'b', title: 'Leaf Filter' },
    ];
    expect(visibleCalculators(all)).toHaveLength(2);
  });

  test('returns empty array when all titles are numeric', () => {
    expect(visibleCalculators([{ id: 'x', title: '1' }])).toHaveLength(0);
  });

  test('handles empty or whitespace-only titles', () => {
    expect(visibleCalculators([{ id: 'a', title: '' }])).toHaveLength(1);
    expect(visibleCalculators([{ id: 'a', title: '   ' }])).toHaveLength(1);
  });
});
