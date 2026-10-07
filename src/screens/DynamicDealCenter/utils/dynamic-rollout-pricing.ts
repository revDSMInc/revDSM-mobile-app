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

export const WELLS_FARGO_HIGH_KEYS = ['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'];
export const WF_HIGH_MIN_PRICE = 7500;

export const floorTier = (value: number, hasItems: boolean): number =>
  hasItems && value < 200 ? 200 : value;

export function effectiveCostOf(totals?: { cost?: number; retail?: number }): number {
  return floorTier(totals?.cost || 0, (totals?.retail || 0) > 0);
}

export function withPlanFee(plan: PlanLike | undefined, value: number): number {
  const fee = plan?.fee || 0;
  return fee >= 1 ? value : value / (1 - fee);
}

export const isWfHigh = (method?: string): boolean => WELLS_FARGO_HIGH_KEYS.includes(method || '');

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
  monthly: number;
  isDataDriven: boolean;
}

const MIN_MONTHLY_PAYMENT = 35;
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
  screensCount?: number;
  screenUnitPrice?: number;
  discountConfig?: DiscountConfig | null;
  discountPct: number;
  seniorVetPct: number;
  downPayment?: number;
  plan?: PlanLike;
}

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

export function computeCalculatorTiers(
  entries: Record<string, any> = {},
  verticals: any[] = [],
  pricingConfig?: PricingConfig | null,
): { cost: number; par: number; retail: number } {
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
        sum[tier] += Number(e?.computed?.[tier]) || 0;
      }
    });
  });

  return sum;
}

export function computeLogTiers(
  entries: Record<string, any> = {},
  verticals: any[] = [],
  pricingConfig?: PricingConfig | null,
): { cost: number; par: number; retail: number } {
  const live = computeCalculatorTiers(entries, verticals, pricingConfig);
  const hasItems = live.retail > 0;
  const tierValue = (key: 'cost' | 'par' | 'retail') =>
    floorTier(
      applyFeesToTier(live[key], key, pricingConfig, { hasLineItems: live[key] > 0 }),
      hasItems,
    );
  return { cost: tierValue('cost'), par: tierValue('par'), retail: tierValue('retail') };
}

const isScreensField = (f: any) =>
  Boolean(f) && (f.name === 'number_of_screen' || /number of screen/i.test(f.label || ''));

export function screensCountFromEntries(entries: Record<string, any> = {}): number {
  const entry = Object.values(entries).find(isScreensField);
  return Number(entry?.inputValue) || 0;
}

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
