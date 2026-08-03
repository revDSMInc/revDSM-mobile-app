import {
  resolveFieldTierPrice,
  bakeFieldPrice,
  normalizeSalesPricingConfig,
  applyFeesToTier,
  tierKeyForMarkup,
  type PricingConfig,
} from '../../../src/screens/DynamicDealCenter/utils/pricing-config-util';
import { computeCalculatorTiers } from '../../../src/screens/DynamicDealCenter/utils/dynamic-rollout-pricing';

// A config where the schema prices RETAIL only and derives par=65%, cost=50% of retail.
const derivedConfig: PricingConfig = {
  tiers: [
    { key: 'cost', label: 'Cost', order: 0 },
    { key: 'par', label: 'Par', order: 1 },
    { key: 'retail', label: 'Retail', order: 2 },
  ],
  fees: [],
  derivationRules: [
    { tierKey: 'par', ofTierKey: 'retail', percentOf: 65 },
    { tierKey: 'cost', ofTierKey: 'retail', percentOf: 50 },
  ],
  isActive: true,
};

describe('tierKeyForMarkup', () => {
  test('maps 50/65/100 → cost/par/retail', () => {
    expect(tierKeyForMarkup('50')).toBe('cost');
    expect(tierKeyForMarkup('65')).toBe('par');
    expect(tierKeyForMarkup('100')).toBe('retail');
  });
});

describe('resolveFieldTierPrice — derivation (the PAR=200 root cause)', () => {
  const field = { price: { retail: 1000, par: '', cost: '' } }; // par/cost blank

  test('explicit tier wins', () => {
    expect(resolveFieldTierPrice(field, 'retail', derivedConfig)).toBe(1000);
  });
  test('blank par derives as 65% of retail (was 0 before → floored to 200)', () => {
    expect(resolveFieldTierPrice(field, 'par', derivedConfig)).toBe(650);
  });
  test('blank cost derives as 50% of retail', () => {
    expect(resolveFieldTierPrice(field, 'cost', derivedConfig)).toBe(500);
  });
  test('no config → blank tier is 0 (default behavior)', () => {
    expect(resolveFieldTierPrice(field, 'par', null)).toBe(0);
  });
});

describe('bakeFieldPrice — bakes derivation at load (web normalizePrice)', () => {
  test('a retail-only field comes out with derived cost/par', () => {
    const baked = bakeFieldPrice({ retail: 1000 }, derivedConfig);
    expect(baked.retail).toBe(1000);
    expect(baked.par).toBe(650);
    expect(baked.cost).toBe(500);
  });
  test('strips thousands separators', () => {
    const baked = bakeFieldPrice({ retail: '1,375' }, derivedConfig);
    expect(baked.retail).toBe(1375);
    expect(baked.par).toBeCloseTo(1375 * 0.65, 4);
  });
  test('explicit per-field override wins over derivation', () => {
    const baked = bakeFieldPrice({ retail: 1000, par: 700 }, derivedConfig);
    expect(baked.par).toBe(700);
  });
});

describe('normalizeSalesPricingConfig', () => {
  test('null when inactive or no tiers', () => {
    expect(normalizeSalesPricingConfig(null)).toBeNull();
    expect(normalizeSalesPricingConfig({ isActive: false, tiers: [{ key: 'cost' }] })).toBeNull();
    expect(normalizeSalesPricingConfig({ tiers: [] })).toBeNull();
  });
  test('published config passes through tiers/fees/derivation', () => {
    const cfg = normalizeSalesPricingConfig({
      tiers: [{ key: 'retail' }],
      fees: [{ amount: 500, appliesToTierKeys: ['retail'] }],
      derivationRules: [{ tierKey: 'par', ofTierKey: 'retail', percentOf: 65 }],
    });
    expect(cfg?.fees).toHaveLength(1);
    expect(cfg?.derivationRules).toHaveLength(1);
  });
});

describe('applyFeesToTier', () => {
  const cfg: PricingConfig = { tiers: [], fees: [{ amount: 500, appliesToTierKeys: ['retail'] }], derivationRules: [] };
  test('adds the tier fee once when there are line items', () => {
    expect(applyFeesToTier(3000, 'retail', cfg)).toBe(3500);
    expect(applyFeesToTier(3000, 'cost', cfg)).toBe(3000); // fee not on cost
  });
  test('no fee on an empty job', () => {
    expect(applyFeesToTier(0, 'retail', cfg, { hasLineItems: false })).toBe(0);
  });
});

describe('computeCalculatorTiers — live recompute (fixes the rollout PAR/RETAIL tiles)', () => {
  // Schema field priced retail-only; par/cost blank → must derive, not floor to 200.
  const verticals = [
    {
      categories: [
        { id: 'c1', directFields: [{ id: 'f1', price: { retail: 1000, par: '', cost: '' } }], sections: [] },
      ],
    },
  ];

  test('derives par/cost from retail × entered qty (not 0/200)', () => {
    const entries = { f1: { fieldId: 'f1', inputValue: 3, computed: { cost: 0, par: 0, retail: 0 } } };
    const t = computeCalculatorTiers(entries, verticals, derivedConfig);
    expect(t.retail).toBe(3000);
    expect(t.par).toBe(1950); // 3 × 650
    expect(t.cost).toBe(1500); // 3 × 500
  });

  test('computeCalculatorTiers returns PURE tier sums — the static fee is added at DISPLAY, not here (web parity)', () => {
    // Web stores `totals` PRE-fee (DealCenterContext `computeTotals` = Σ qty×baked_price)
    // and adds the per-tier static fee only at RENDER via `applyFeesToTier`
    // (`calculateResultUtil`). So the sum helper must stay fee-free; RolloutView applies
    // `applyFeesToTier` on top of these values to build the displayed COST/PAR/RETAIL tiles.
    const cfgWithFee: PricingConfig = { ...derivedConfig, fees: [{ amount: 500, appliesToTierKeys: ['par', 'retail'] }] };
    const entries = { f1: { fieldId: 'f1', inputValue: 2, computed: {} } };
    const t = computeCalculatorTiers(entries, verticals, cfgWithFee);
    expect(t.retail).toBe(2000); // pure sum, fee added later at display
    expect(t.par).toBe(1300); // 2 × 650, pure sum
    // The DISPLAYED tile = pure sum + tier fee (what RolloutView renders).
    expect(applyFeesToTier(t.par, 'par', cfgWithFee)).toBe(1800); // 1300 + 500
    expect(applyFeesToTier(t.retail, 'retail', cfgWithFee)).toBe(2500); // 2000 + 500
  });

  test('ignores zero-qty entries; falls back to stored computed when field is gone', () => {
    const entries = {
      f1: { fieldId: 'f1', inputValue: 0, computed: { retail: 999 } }, // zero qty → skipped
      fGone: { fieldId: 'zzz', inputValue: 1, computed: { cost: 10, par: 20, retail: 40 } },
    };
    const t = computeCalculatorTiers(entries, verticals, derivedConfig);
    expect(t.retail).toBe(40); // only the fallback entry
    expect(t.par).toBe(20);
  });
});
