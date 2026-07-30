/**
 * dynamic-rollout-pricing.ts — pure pricing/validation math for the Dynamic Deal
 * Center rollout, extracted from RolloutView so it can be unit-tested against the
 * web source of truth (`ViewAllCalculators.js`, `PremiumQuoteCard.js`,
 * `payment-method-validation.js`, `discount-config-util.js`).
 *
 * Fixes over the previous inline math:
 *   - Wells Fargo "high" $7,500 hardcoded safety-net restored (web parity) so an
 *     under-priced WF-high rollout is blocked even if the backend plan omits minPrice.
 *   - MSRP / programs are data-driven from the discount config when present
 *     (`computeMsrpFromEndPrice` + `computeProgramGrandTotal`), with the ≥100%
 *     clamp — no more divide-by-≤0 → Infinity; falls back to the hardcoded
 *     pre-order + Sr/Vet two-program formula only when no config is available.
 *   - Screens (`number_of_screen` entry) fold into priceWithScreens + MSRP.
 *   - Validation strings match web.
 */
import {
  computeMsrpFromEndPrice,
  computeProgramGrandTotal,
  computeProgramDiscountLines,
  getDiscountConfig,
  getSelectableDiscountKey,
  formatProgramTitle,
  type DiscountConfig,
  type ProgramLine,
} from './dynamic-discount';
import {
  resolveFieldTierPrice,
  applyFeesToTier,
  type PricingConfig,
} from './pricing-config-util';

export interface PlanLike {
  label?: string;
  type?: string;
  fee?: number;
  pf?: number;
  duration?: number;
  minPrice?: number;
}

// Web `wellsFargoHighKeys` / `WF_HIGH_MIN_PRICE` (ViewAllCalculators.js:961-962).
export const WELLS_FARGO_HIGH_KEYS = ['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'];
export const WF_HIGH_MIN_PRICE = 7500;

/** $200 job-minimum floor per tier (web `calculateResultUtil`), gated on the calc having items. */
export const floorTier = (value: number, hasItems: boolean): number =>
  hasItems && value < 200 ? 200 : value;

/** Floored cost — the value end price / drop price is validated against. */
export function effectiveCostOf(totals?: { cost?: number; retail?: number }): number {
  return floorTier(totals?.cost || 0, (totals?.retail || 0) > 0);
}

/** Inflate a tier value by the selected plan's bank fee (web `calculateResultUtil`). */
export function withPlanFee(plan: PlanLike | undefined, value: number): number {
  const fee = plan?.fee || 0;
  return fee >= 1 ? value : value / (1 - fee);
}

export const isWfHigh = (method?: string): boolean => WELLS_FARGO_HIGH_KEYS.includes(method || '');

/**
 * Most-specific reason an end price is invalid (else null): below the floored
 * cost → WF-high $7,500 floor → the selected plan's own minPrice. Strings match
 * web (`payment-method-validation.validatePriceForPaymentMethod` + WF-high).
 */
export function endPriceError(
  plans: Record<string, PlanLike>,
  price: number,
  totals: { cost?: number; retail?: number } | undefined,
  method: string,
): string | null {
  if (!price || price <= 0) return null;
  const cost = effectiveCostOf(totals);
  if (price < cost) return 'Price can NOT be below cost.';
  if (isWfHigh(method) && price < WF_HIGH_MIN_PRICE) {
    return `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`;
  }
  const min = plans[method]?.minPrice || 0;
  if (min && price < min) {
    return `This payment plan requires a minimum price of $${min.toLocaleString()}. Current price: $${price.toLocaleString()}.`;
  }
  return null;
}

export interface RolloutProgram {
  key: string;
  titleLines: string[];
  grandTotal: number;
  lines: ProgramLine[];
  isHighlighted: boolean;
}

export interface RolloutResult {
  screensCost: number;
  priceWithScreens: number;
  msrp: number;
  programs: RolloutProgram[];
  /** monthly for the highlighted (In-Home) program, base = endPrice − downPayment (web parity). */
  monthly: number;
  /** true when programs came from the backend config (vs the two-program fallback). */
  isDataDriven: boolean;
}

const MIN_MONTHLY_PAYMENT = 35;
/** Web `calculateMonthlyPaymentForPlan` (PremiumQuoteCard.js:25-49). */
export function monthlyForPlan(plan: PlanLike | undefined, basePrice: number): number {
  if (!basePrice || basePrice <= 0 || !plan || plan.type !== 'financing') return 0;
  const label = plan.label || '';
  if ((label.startsWith('3198') || label.startsWith('1529')) && basePrice < 2500) return MIN_MONTHLY_PAYMENT;
  if (plan.pf && plan.pf > 0) {
    const payment = basePrice * plan.pf;
    if ((label.startsWith('1148') || label.startsWith('1019')) && payment < MIN_MONTHLY_PAYMENT) {
      return MIN_MONTHLY_PAYMENT;
    }
    return payment;
  }
  if (plan.duration && plan.duration > 0) return basePrice / plan.duration;
  return 0;
}

export interface RolloutResultInput {
  endPrice: number;
  /** per-screen unit price × count folds into priceWithScreens (web reads `number_of_screen`). */
  screensCount?: number;
  screenUnitPrice?: number;
  discountConfig?: DiscountConfig | null;
  /** selected pre-order discount % (drives both the config `pre_order` selection and the fallback). */
  discountPct: number;
  /** Sr+Vet % for the fallback formula (config path reads it from `discounts`). */
  seniorVetPct: number;
  downPayment?: number;
  plan?: PlanLike;
}

/**
 * Compute the rollout result breakdown (screens → MSRP → programs → monthly).
 * Data-driven from the discount config when present (web parity), else the
 * legacy two-program fallback (1-Year Program + In-Home Pre-Order) so the demo /
 * pre-config flow keeps working.
 */
export function computeRolloutResult(input: RolloutResultInput): RolloutResult {
  const {
    endPrice,
    screensCount = 0,
    screenUnitPrice = 75,
    discountConfig,
    discountPct,
    seniorVetPct,
    downPayment = 0,
    plan,
  } = input;

  const screensCost = screensCount * screenUnitPrice;
  const priceWithScreens = (Number(endPrice) || 0) + screensCost;

  const resolvedConfig = getDiscountConfig(discountConfig);
  const monthlyBase = Math.max(0, (Number(endPrice) || 0) - (Number(downPayment) || 0));
  const monthly = monthlyForPlan(plan, monthlyBase);

  if (resolvedConfig) {
    const discounts = resolvedConfig.discounts || [];
    // Key the rep's selection by the discount the selector's options came FROM.
    // Hardcoding `pre_order` here meant a config keying its selectable discount
    // anything else ignored the selection entirely: MSRP stuck on the config's
    // default option no matter which tile was pressed.
    const selectedValues: Record<string, number> = {
      [getSelectableDiscountKey(discounts)]: discountPct,
    };
    const msrp = computeMsrpFromEndPrice(priceWithScreens, discounts, selectedValues);
    const programs: RolloutProgram[] = (resolvedConfig.programs || []).map((p) => ({
      key: p.key,
      titleLines: formatProgramTitle(p.title || p.headerLabel || ''),
      grandTotal: computeProgramGrandTotal(msrp, p, discounts, selectedValues),
      lines: computeProgramDiscountLines(msrp, p, discounts, selectedValues),
      isHighlighted: Boolean(p.isHighlighted),
    }));
    return { screensCost, priceWithScreens, msrp, programs, monthly, isDataDriven: true };
  }

  // Fallback: hardcoded pre-order + Sr/Vet two-program model (clamped at ≥100%).
  const totalPct = discountPct + seniorVetPct;
  const msrp = totalPct >= 100 ? priceWithScreens : priceWithScreens / (1 - totalPct / 100);
  const srVet = msrp * (seniorVetPct / 100);
  const preOrder = msrp * (discountPct / 100);
  const programs: RolloutProgram[] = [
    {
      key: 'one_year',
      titleLines: ['1-Year Program'],
      grandTotal: msrp - srVet,
      lines: [{ key: 'seniors', title: 'Sr + Vet', percent: seniorVetPct, amount: srVet }],
      isHighlighted: false,
    },
    {
      key: 'in_home_pre_order',
      titleLines: ['In-Home Pre-Order'],
      grandTotal: msrp - srVet - preOrder,
      lines: [
        { key: 'seniors', title: 'Sr + Vet', percent: seniorVetPct, amount: srVet },
        { key: 'pre_order', title: 'Pre-Order', percent: discountPct, amount: preOrder },
      ],
      isHighlighted: true,
    },
  ];
  return { screensCost, priceWithScreens, msrp, programs, monthly, isDataDriven: false };
}

/**
 * Markup label for a price against a calculator's tiers, anchored on the
 * check-based (unfee'd) COST/PAR/RETAIL with the $200 floor — web
 * `calculateMarkup` (ViewAllCalculators.js:127). Returns e.g. "RETAIL + 5%",
 * "PAR", or '' when there are no items. Used as the drop `pricemarkup` field.
 */
export function markupLabel(price: number, totals?: { cost?: number; par?: number; retail?: number }): string {
  const numericPrice = Number(price);
  if (Number.isNaN(numericPrice) || numericPrice < 0 || !totals) return '';
  const hasItems = (totals.retail || 0) > 0;
  const cost = Math.round(floorTier(totals.cost || 0, hasItems));
  const par = Math.round(floorTier(totals.par || 0, hasItems));
  const retail = Math.round(floorTier(totals.retail || 0, hasItems));

  let anchor = cost;
  let label = 'COST';
  if (numericPrice >= retail) { anchor = retail; label = 'RETAIL'; }
  else if (numericPrice >= par) { anchor = par; label = 'PAR'; }
  else if (numericPrice >= cost) { anchor = cost; label = 'COST'; }

  if (!anchor) return '';
  const percent = Math.round(((numericPrice - anchor) / anchor) * 100);
  return percent === 0 ? label : `${label} + ${percent}%`;
}

/**
 * Compute a calculator's COST/PAR/RETAIL totals LIVE from the entered quantities +
 * the current schema field prices (web parity — `getCalculationResult` recomputes
 * from the schema at render, it does NOT trust stale stored `computed`). Each tier
 * is resolved via `resolveFieldTierPrice` (so a blank tier derives from another).
 * Falls back to the entry's stored `computed[tier]` when the field is no longer in
 * the schema.
 *
 * NOTE: these are the DISPLAYED anchor tiles — pure tier sums, NO static fee. The
 * web app's COST/PAR/RETAIL boxes show the raw derived tier (adding a company fee
 * here inflated PAR by the fee amount vs web). Static fees, where configured, belong
 * to the final rollout-price calculation, not the anchor tiles.
 *
 * `verticals` is the array of calculator schemas (categories → sections/directFields
 * → fields). Builds a fieldId→field lookup across all of them.
 */
export function computeCalculatorTiers(
  entries: Record<string, any> = {},
  verticals: any[] = [],
  pricingConfig?: PricingConfig | null,
): { cost: number; par: number; retail: number } {
  // fieldId → field, flattened across every vertical/category/section.
  const fieldById = new Map<string, any>();
  (verticals || []).forEach((schema) => {
    (schema?.categories || []).forEach((cat: any) => {
      const direct = cat?.directFields || cat?.fields || [];
      direct.forEach((f: any) => f?.id && fieldById.set(f.id, f));
      (cat?.sections || []).forEach((s: any) => (s?.fields || []).forEach((f: any) => f?.id && fieldById.set(f.id, f)));
    });
  });

  const sum = { cost: 0, par: 0, retail: 0 };
  Object.values(entries).forEach((e: any) => {
    const qty = Number(e?.inputValue) || 0;
    if (qty <= 0) return;
    const field = fieldById.get(e?.fieldId);
    (['cost', 'par', 'retail'] as const).forEach((tier) => {
      if (field) {
        sum[tier] += qty * resolveFieldTierPrice(field, tier, pricingConfig);
      } else {
        // Field gone from schema → best-effort from the stored per-entry computed.
        sum[tier] += Number(e?.computed?.[tier]) || 0;
      }
    });
  });

  return sum;
}

/**
 * The COST/PAR/RETAIL a rollout LOG (`percentageOfRollout` / `pricemarkup`) anchors
 * its markup on. WEB PARITY with `calculateMarkup` (ViewAllCalculators.js:83-116),
 * which computes the anchors as `Math.round(getCalculationResult(calc, '50'|'65'|'100',
 * 'check'))` — its comment: "ALWAYS use 'check' for anchors to standardize rollout
 * calculation". So the anchors are INDEPENDENT of the selected payment plan: pricing-
 * config DERIVATION + static company fee + the $200 FLOOR, but NO plan bank-fee
 * gross-up (`check` has fee 0). The `computeCalculatorTiers` derivation still fixes
 * blank par/cost tiers (retail-only schema) so the markup snaps to the right tier
 * (the old mobile bug: "PAR + 49%" where web shows "COST + 100%").
 *
 * Earlier this grossed up by the SELECTED plan's fee — a divergence: it made the
 * markup shift when the rep changed plans, which web never does. Removed for parity.
 */
export function computeLogTiers(
  entries: Record<string, any> = {},
  verticals: any[] = [],
  pricingConfig?: PricingConfig | null,
): { cost: number; par: number; retail: number } {
  const live = computeCalculatorTiers(entries, verticals, pricingConfig);
  const hasItems = live.retail > 0;
  // `check`-anchored (web parity): static company fee + $200 floor, NO plan fee.
  const tierValue = (key: 'cost' | 'par' | 'retail') =>
    floorTier(
      applyFeesToTier(live[key], key, pricingConfig, { hasLineItems: live[key] > 0 }),
      hasItems,
    );
  return { cost: tierValue('cost'), par: tierValue('par'), retail: tierValue('retail') };
}

/** Matches the screens field/entry the same way web does — by `name`, with a
 *  case-insensitive label fallback (`PremiumQuoteCard.js:259-272`). */
const isScreensField = (f: any) =>
  Boolean(f) && (f.name === 'number_of_screen' || /number of screen/i.test(f.label || ''));

/** Read the screens count from a calculator's entries map (`number_of_screen`). */
export function screensCountFromEntries(entries: Record<string, any> = {}): number {
  const entry = Object.values(entries).find(isScreensField);
  return Number(entry?.inputValue) || 0;
}

/**
 * Per-screen unit price, read LIVE from the schema's `number_of_screen` field —
 * web parity (`PremiumQuoteCard.js:274`, commit b48ea8d "fix - footage value and
 * screen price"):
 *
 *     const screenUnitPrice = Number(screenField?.price?.retail) || 75;
 *
 * The $75 is a LEGACY FALLBACK for calculators created before the field carried a
 * price — not the price itself. Mobile hardcoded 75 unconditionally, so a company
 * that priced screens at, say, $47 saw the rollout inflate by $75/screen while web
 * showed $47. Reading the schema (rather than the entry's `pricingAtTimeOfEntry`)
 * is deliberate and matches web: the cost always follows the CURRENT schema.
 *
 * Resolved through `resolveFieldTierPrice` so a company whose retail tier is
 * derived (`percentOf` cost/par) rather than stored resolves identically to every
 * other price on this screen.
 */
export function screenUnitPriceFromSchemas(
  verticals: any[] = [],
  pricingConfig?: PricingConfig | null,
): number {
  let screenField: any;
  (verticals || []).some((schema) =>
    (schema?.categories || []).some((cat: any) => {
      const direct = (cat?.directFields || cat?.fields || []).find(isScreensField);
      if (direct) {
        screenField = direct;
        return true;
      }
      return (cat?.sections || []).some((s: any) => {
        const found = (s?.fields || []).find(isScreensField);
        if (found) screenField = found;
        return Boolean(found);
      });
    }),
  );

  return Number(resolveFieldTierPrice(screenField, 'retail', pricingConfig)) || 75;
}
