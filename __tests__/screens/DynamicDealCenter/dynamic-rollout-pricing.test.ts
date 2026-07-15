import {
  WELLS_FARGO_HIGH_KEYS,
  WF_HIGH_MIN_PRICE,
  floorTier,
  effectiveCostOf,
  withPlanFee,
  isWfHigh,
  endPriceError,
  monthlyForPlan,
  computeRolloutResult,
  screensCountFromEntries,
} from '../../../src/screens/DynamicDealCenter/utils/dynamic-rollout-pricing';
import {
  computeMsrpFromEndPrice,
  computeProgramGrandTotal,
  getMsrpDiscountTotal,
  getDefaultSelectableDiscountValue,
  type DiscountConfig,
} from '../../../src/screens/DynamicDealCenter/utils/dynamic-discount';
import { calcMonthly } from '../../../src/screens/DynamicDealCenter/hooks/useDealPricing';

describe('floorTier / effectiveCostOf ($200 job minimum)', () => {
  test('floors a priced tier to 200, leaves empty jobs at 0', () => {
    expect(floorTier(120, true)).toBe(200);
    expect(floorTier(250, true)).toBe(250);
    expect(floorTier(120, false)).toBe(120); // no items → no floor
  });
  test('effectiveCostOf floors cost only when retail>0', () => {
    expect(effectiveCostOf({ cost: 50, retail: 300 })).toBe(200);
    expect(effectiveCostOf({ cost: 50, retail: 0 })).toBe(50);
    expect(effectiveCostOf({ cost: 900, retail: 1500 })).toBe(900);
  });
});

describe('withPlanFee bank-fee gross-up', () => {
  test('grosses up by fee, passes through when fee>=1 or 0', () => {
    expect(withPlanFee({ fee: 0 }, 1000)).toBe(1000);
    expect(withPlanFee({ fee: 0.1 }, 900)).toBeCloseTo(1000, 5);
    expect(withPlanFee({ fee: 1 }, 1000)).toBe(1000);
    expect(withPlanFee(undefined, 1000)).toBe(1000);
  });
});

describe('Wells Fargo high $7,500 safety net (web parity)', () => {
  const plans = { wf3672: { minPrice: 0, type: 'financing' }, check: { minPrice: 0 } } as any;
  test('WF-high keys are recognized', () => {
    expect(isWfHigh('wf3672')).toBe(true);
    expect(WELLS_FARGO_HIGH_KEYS).toContain('wf3670');
    expect(WF_HIGH_MIN_PRICE).toBe(7500);
  });
  test('blocks a WF-high rollout below $7,500 even when plan.minPrice is missing', () => {
    expect(endPriceError(plans, 6000, { cost: 1000, retail: 3000 }, 'wf3672')).toBe(
      'This Wells Fargo plan requires a minimum price of $7,500',
    );
    expect(endPriceError(plans, 8000, { cost: 1000, retail: 3000 }, 'wf3672')).toBeNull();
  });
});

describe('endPriceError precedence + strings', () => {
  const plans = { greensky: { minPrice: 3000 }, check: { minPrice: 0 } } as any;
  test('below (floored) cost wins first', () => {
    expect(endPriceError(plans, 150, { cost: 50, retail: 3000 }, 'check')).toBe('Price can NOT be below cost.');
  });
  test('plan minimum message matches web validatePriceForPaymentMethod', () => {
    expect(endPriceError(plans, 2500, { cost: 500, retail: 3000 }, 'greensky')).toBe(
      'This payment plan requires a minimum price of $3,000. Current price: $2,500.',
    );
  });
  test('valid price → null; zero/blank → null', () => {
    expect(endPriceError(plans, 5000, { cost: 500, retail: 3000 }, 'greensky')).toBeNull();
    expect(endPriceError(plans, 0, { cost: 500, retail: 3000 }, 'greensky')).toBeNull();
  });
});

describe('monthlyForPlan / calcMonthly $35 floor + label special cases (web parity)', () => {
  const plans = {
    gs1148: { label: '1148 GreenSky', type: 'financing', pf: 0.001, duration: 0 },
    gs3198: { label: '3198 GreenSky', type: 'financing', pf: 0.02, duration: 0 },
    wf: { label: 'wf4103 Wells', type: 'financing', pf: 0.015, duration: 0 },
    dur: { label: 'dur', type: 'financing', pf: 0, duration: 60 },
    cash: { label: 'check', type: 'cash', pf: 0, duration: 0 },
  } as any;

  test('1148/1019 plans floor a tiny pf-payment up to $35', () => {
    // 1000 * 0.001 = 1 → floored to 35
    expect(monthlyForPlan(plans.gs1148, 1000)).toBe(35);
    expect(calcMonthly(plans, 1000, 'gs1148')).toBe(35);
  });
  test('3198/1529 plans are flat $35 under 2500 base', () => {
    expect(monthlyForPlan(plans.gs3198, 2000)).toBe(35);
    expect(calcMonthly(plans, 2000, 'gs3198')).toBe(35);
    // at/above 2500 → normal pf math
    expect(monthlyForPlan(plans.gs3198, 3000)).toBeCloseTo(60, 5);
  });
  test('ordinary financing plan uses pf multiply', () => {
    expect(monthlyForPlan(plans.wf, 10000)).toBeCloseTo(150, 5);
    expect(calcMonthly(plans, 10000, 'wf')).toBeCloseTo(150, 5);
  });
  test('duration-based plan divides', () => {
    expect(monthlyForPlan(plans.dur, 6000)).toBe(100);
  });
  test('non-financing / non-positive base → 0', () => {
    expect(monthlyForPlan(plans.cash, 10000)).toBe(0);
    expect(calcMonthly(plans, 0, 'wf')).toBe(0);
  });
});

describe('computeRolloutResult — fallback two-program formula (no config)', () => {
  test('MSRP grossed by pre-order + Sr/Vet, two programs, no divide-by-zero', () => {
    const r = computeRolloutResult({
      endPrice: 10000,
      discountConfig: null,
      discountPct: 25,
      seniorVetPct: 10,
      downPayment: 0,
      plan: { label: 'wf', type: 'financing', pf: 0.01 },
    });
    // msrp = 10000 / (1 - 0.35)
    expect(r.msrp).toBeCloseTo(10000 / 0.65, 4);
    expect(r.programs).toHaveLength(2);
    const inHome = r.programs.find((p) => p.isHighlighted)!;
    expect(inHome.grandTotal).toBeCloseTo(r.msrp * (1 - 0.35), 4);
    expect(r.isDataDriven).toBe(false);
  });
  test('clamps at >=100% total instead of Infinity', () => {
    const r = computeRolloutResult({ endPrice: 10000, discountConfig: null, discountPct: 95, seniorVetPct: 10 });
    expect(Number.isFinite(r.msrp)).toBe(true);
    expect(r.msrp).toBe(10000); // clamp → raw price
  });
  test('monthly base excludes screens and subtracts down payment (web parity)', () => {
    const r = computeRolloutResult({
      endPrice: 10000,
      screensCount: 4,
      screenUnitPrice: 75,
      discountConfig: null,
      discountPct: 25,
      seniorVetPct: 10,
      downPayment: 1000,
      plan: { label: 'wf', type: 'financing', pf: 0.01 },
    });
    expect(r.screensCost).toBe(300);
    expect(r.priceWithScreens).toBe(10300);
    // monthly base = endPrice(10000) - down(1000) = 9000, NOT priceWithScreens
    expect(r.monthly).toBeCloseTo(9000 * 0.01, 5);
  });
});

describe('computeRolloutResult — data-driven from discount config (web parity)', () => {
  const config: DiscountConfig = {
    isActive: true,
    discounts: [
      { key: 'pre_order', type: 'options', includeInMsrp: true, options: [{ value: 25, isDefault: true }] },
      { key: 'seniors', type: 'fixed', value: 10, includeInMsrp: true, title: 'Sr + Vet' },
    ],
    programs: [
      { key: 'one_year', title: '1-Year', linkedDiscountKeys: ['seniors'] },
      { key: 'in_home', title: 'In-Home', isHighlighted: true, linkedDiscountKeys: ['seniors', 'pre_order'] },
    ],
  };
  test('MSRP uses includeInMsrp sum (matches discount-config-util)', () => {
    const r = computeRolloutResult({ endPrice: 10000, discountConfig: config, discountPct: 25, seniorVetPct: 10 });
    const expectedMsrp = computeMsrpFromEndPrice(10000, config.discounts!, { pre_order: 25 });
    expect(r.msrp).toBeCloseTo(expectedMsrp, 6);
    expect(getMsrpDiscountTotal(config.discounts!, { pre_order: 25 })).toBe(35);
    expect(r.isDataDriven).toBe(true);
    expect(r.programs).toHaveLength(2);
  });
  test('program grand totals match computeProgramGrandTotal', () => {
    const r = computeRolloutResult({ endPrice: 10000, discountConfig: config, discountPct: 25, seniorVetPct: 10 });
    const inHome = r.programs.find((p) => p.key === 'in_home')!;
    const expected = computeProgramGrandTotal(r.msrp, config.programs![1], config.discounts!, { pre_order: 25 });
    expect(inHome.grandTotal).toBeCloseTo(expected, 6);
    expect(inHome.isHighlighted).toBe(true);
  });
  test('includeInMsrp=false on seniors drops it from MSRP (config-sensitive, unlike old hardcode)', () => {
    const cfg2: DiscountConfig = {
      ...config,
      discounts: [
        { key: 'pre_order', type: 'options', includeInMsrp: true, options: [{ value: 25, isDefault: true }] },
        { key: 'seniors', type: 'fixed', value: 10, includeInMsrp: false, title: 'Sr + Vet' },
      ],
    };
    const r = computeRolloutResult({ endPrice: 10000, discountConfig: cfg2, discountPct: 25, seniorVetPct: 10 });
    // only pre-order (25%) in MSRP now
    expect(r.msrp).toBeCloseTo(10000 / 0.75, 4);
  });
  test('getDefaultSelectableDiscountValue picks the default option', () => {
    expect(getDefaultSelectableDiscountValue(config.discounts!)).toBe(25);
  });
});

describe('screensCountFromEntries', () => {
  test('reads number_of_screen entry inputValue', () => {
    const entries = {
      f1: { name: 'gutter', inputValue: 100 },
      f2: { name: 'number_of_screen', inputValue: 6 },
    };
    expect(screensCountFromEntries(entries)).toBe(6);
    expect(screensCountFromEntries({})).toBe(0);
  });
});
