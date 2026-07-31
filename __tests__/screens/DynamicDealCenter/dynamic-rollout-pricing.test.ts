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
  screenUnitPriceFromSchemas,
} from '../../../src/screens/DynamicDealCenter/utils/dynamic-rollout-pricing';
import {
  computeMsrpFromEndPrice,
  computeProgramGrandTotal,
  getMsrpDiscountTotal,
  getDefaultSelectableDiscountValue,
  getSelectableDiscountKey,
  type DiscountConfig,
} from '../../../src/screens/DynamicDealCenter/utils/dynamic-discount';
import { calcMonthly, buildCategories } from '../../../src/screens/DynamicDealCenter/hooks/useDealPricing';

describe('buildCategories — payment-plan picker grouping', () => {
  const plan = (key: string, type: string, provider: string, minPrice = 0): any => ({
    key, type, provider, minPrice, label: key, fee: 0, pf: 0, duration: 0, apr: 0,
  });

  test('splits a provider into its own "(Jobs over $7,500)" group for high-min plans', () => {
    const cats = buildCategories([
      plan('check', 'cash', 'Check'),
      plan('wf4103', 'financing', 'Wells Fargo', 0),
      plan('wf4115', 'financing', 'Wells Fargo', 0),
      plan('wf3672', 'financing', 'Wells Fargo', 7500),
      plan('wf3667', 'financing', 'Wells Fargo', 7500),
    ]);
    const titles = cats.map((c) => c.title);
    expect(titles).toContain('Wells Fargo');
    expect(titles).toContain('Wells Fargo (Jobs over $7,500)');
    const high = cats.find((c) => c.title === 'Wells Fargo (Jobs over $7,500)')!;
    expect(high.plans).toEqual(['wf3672', 'wf3667']);
    const base = cats.find((c) => c.title === 'Wells Fargo')!;
    expect(base.plans).toEqual(['wf4103', 'wf4115']);
  });

  test('keeps a single-tier provider (e.g. GreenSky with varied sub-$7,500 mins) in one group', () => {
    const cats = buildCategories([
      plan('gs1', 'financing', 'GreenSky', 299),
      plan('gs2', 'financing', 'GreenSky', 2500),
    ]);
    const gs = cats.filter((c) => c.title.startsWith('GreenSky'));
    expect(gs).toHaveLength(1);
    expect(gs[0].title).toBe('GreenSky');
    expect(gs[0].plans).toEqual(['gs1', 'gs2']);
  });
});

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

// Regression: the rep's selected pre-order % used to be hardcoded under the key
// `pre_order`. A config keying its selectable discount anything else matched no
// discount, so getDiscountPercent silently fell back to the config's DEFAULT
// option and MSRP froze on every tile while the selector's highlight still moved.
describe('computeRolloutResult — selected discount % is keyed by the resolved discount', () => {
  const withKey = (key: string): DiscountConfig => ({
    discounts: [
      {
        key,
        type: 'options',
        allowRepDefault: true,
        includeInMsrp: true,
        options: [{ value: 15, isDefault: true }, { value: 20 }, { value: 25 }],
      },
      { key: 'seniors', type: 'fixed', value: 10, includeInMsrp: true, title: 'Sr + Vet' },
    ],
    programs: [{ key: 'in_home', title: 'In-Home Pre-Order', isHighlighted: true, linkedDiscountKeys: ['seniors', key] }],
  });

  const msrpAt = (key: string, pct: number) =>
    computeRolloutResult({ endPrice: 20000, discountConfig: withKey(key), discountPct: pct, seniorVetPct: 10 }).msrp;

  test('getSelectableDiscountKey resolves the options discount whatever its key', () => {
    expect(getSelectableDiscountKey(withKey('pre_order').discounts!)).toBe('pre_order');
    expect(getSelectableDiscountKey(withKey('preOrder').discounts!)).toBe('preOrder');
    // No selectable discount at all → the pre_order default keeps prior behaviour.
    expect(getSelectableDiscountKey([{ key: 'seniors', type: 'fixed', value: 10 }])).toBe('pre_order');
    expect(getSelectableDiscountKey([])).toBe('pre_order');
  });

  test.each(['pre_order', 'preOrder', 'pre_order_discount', 'inHomePreOrder'])(
    'MSRP tracks the selected %% when the discount is keyed %p',
    (key) => {
      // 20000 / (1 - (pct + 10)/100)
      expect(Math.round(msrpAt(key, 15))).toBe(26667);
      expect(Math.round(msrpAt(key, 20))).toBe(28571);
      expect(Math.round(msrpAt(key, 25))).toBe(30769);
    }
  );

  test('the program grand total tracks the selection too, not just MSRP', () => {
    const at = (pct: number) =>
      computeRolloutResult({ endPrice: 20000, discountConfig: withKey('preOrder'), discountPct: pct, seniorVetPct: 10 })
        .programs.find((p) => p.key === 'in_home')!;
    // Grand total = MSRP − (seniors + pre-order) = end price, by construction.
    expect(Math.round(at(15).grandTotal)).toBe(20000);
    expect(Math.round(at(25).grandTotal)).toBe(20000);
    // ...and the pre-order line itself reflects the pressed tile.
    expect(at(25).lines.find((l) => l.key === 'preOrder')!.percent).toBe(25);
    expect(at(15).lines.find((l) => l.key === 'preOrder')!.percent).toBe(15);
  });

  test('a discount excluded from MSRP still does not move it (config semantics preserved)', () => {
    const cfg: DiscountConfig = {
      discounts: [
        { key: 'preOrder', type: 'options', includeInMsrp: false, options: [{ value: 15, isDefault: true }, { value: 25 }] },
        { key: 'seniors', type: 'fixed', value: 10, includeInMsrp: true },
      ],
      programs: [],
    };
    const at = (pct: number) =>
      computeRolloutResult({ endPrice: 20000, discountConfig: cfg, discountPct: pct, seniorVetPct: 10 }).msrp;
    expect(at(15)).toBeCloseTo(20000 / 0.9, 4);
    expect(at(25)).toBeCloseTo(20000 / 0.9, 4);
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

  test('falls back to a case-insensitive label match, like web', () => {
    expect(screensCountFromEntries({ f1: { label: 'Number of Screens', inputValue: 5 } })).toBe(5);
  });
});

/**
 * Web parity: `PremiumQuoteCard.js:274` — `Number(screenField?.price?.retail) || 75`.
 * The 75 is a legacy fallback, not the price. Mobile hardcoded it, so the rollout
 * inflated by $75/screen regardless of what the company had configured.
 */
describe('screenUnitPriceFromSchemas', () => {
  const schemaWith = (field: any, placement: 'direct' | 'section' = 'direct') => [
    {
      categories: [
        {
          id: 'c1',
          ...(placement === 'direct'
            ? { directFields: [{ id: 'x', name: 'gutter', price: { retail: 12 } }, field] }
            : { sections: [{ fields: [{ id: 'x', name: 'gutter', price: { retail: 12 } }, field] }] }),
        },
      ],
    },
  ];

  test('reads the retail price off the number_of_screen field', () => {
    expect(
      screenUnitPriceFromSchemas(schemaWith({ id: 's', name: 'number_of_screen', price: { retail: 47 } }))
    ).toBe(47);
  });

  test('finds the field inside a section too', () => {
    expect(
      screenUnitPriceFromSchemas(
        schemaWith({ id: 's', name: 'number_of_screen', price: { retail: 47 } }, 'section')
      )
    ).toBe(47);
  });

  test('matches by label when the name differs', () => {
    expect(
      screenUnitPriceFromSchemas(schemaWith({ id: 's', name: 'screens_qty', label: 'Number of Screens', price: { retail: 60 } }))
    ).toBe(60);
  });

  test('falls back to the legacy $75 when the field is missing or unpriced', () => {
    expect(screenUnitPriceFromSchemas([])).toBe(75);
    expect(screenUnitPriceFromSchemas(undefined as any)).toBe(75);
    expect(screenUnitPriceFromSchemas(schemaWith({ id: 's', name: 'number_of_screen' }))).toBe(75);
    expect(
      screenUnitPriceFromSchemas(schemaWith({ id: 's', name: 'number_of_screen', price: { retail: 0 } }))
    ).toBe(75);
  });

  test('resolves a DERIVED retail tier through the pricing config', () => {
    // retail not stored; company derives it as 200% of cost → 25 * 2 = 50.
    const schemas = schemaWith({ id: 's', name: 'number_of_screen', price: { cost: 25, retail: '' } });
    const pricingConfig: any = { derivationRules: [{ tierKey: 'retail', ofTierKey: 'cost', percentOf: 200 }] };
    expect(screenUnitPriceFromSchemas(schemas, pricingConfig)).toBe(50);
  });

  test('reproduces the reported bug: $3,000 end price + 5 screens @ $47', () => {
    const schemas = schemaWith({ id: 's', name: 'number_of_screen', price: { retail: 47 } });
    const r = computeRolloutResult({
      endPrice: 3000,
      screensCount: 5,
      screenUnitPrice: screenUnitPriceFromSchemas(schemas),
      discountPct: 15,
      seniorVetPct: 10,
    });

    expect(r.screensCost).toBe(235);
    expect(r.priceWithScreens).toBe(3235); // web showed $3,235; mobile showed $3,375
  });

  test('an unpriced schema still reproduces the legacy $75 behaviour', () => {
    const r = computeRolloutResult({
      endPrice: 3000,
      screensCount: 5,
      screenUnitPrice: screenUnitPriceFromSchemas([]),
      discountPct: 15,
      seniorVetPct: 10,
    });
    expect(r.priceWithScreens).toBe(3375);
  });
});
