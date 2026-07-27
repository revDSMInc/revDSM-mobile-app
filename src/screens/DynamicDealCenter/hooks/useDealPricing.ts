import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { paymentPlans as STATIC_PLANS } from '../../../utils/calculator/payment-plans';
import {
  getRolloutPaymentCategories,
  getDropAddPlanCategories,
  getOutcomeDownPaymentMethods,
  getDefaultPaymentMethod,
} from '../../../utils/calculator/lowes-payment-util';
import { getSelectableOptionsDiscount, type DiscountConfig } from '../utils/dynamic-discount';
import { WF_HIGH_MIN_PRICE } from '../../../utils/calculator/payment-method-validation';

/**
 * Backend-driven pricing for the Dynamic Deal Center — payment plans + discount
 * config — ported 1:1 from the web app so the dynamic rollout/result flow reads
 * the SAME data the web reads instead of the mobile static constants.
 *
 *   plans     : GET /payment-plans/v1/sales/provider-plans   (web `useGetPaymentPlans`)
 *   discounts : GET /company/v1/discount-config/sales         (web `useGetDiscountConfig`)
 *
 * The calculator schema (`/calculator-form-schemas/deal-center`) carries NONE of
 * this — payment plans, discount tiers, and the Sr+Vet % are three independent
 * backend concerns, exactly as on web. Demo/result reasons have NO endpoint on
 * either platform (hardcoded everywhere), so they stay static in ResultJobModal.
 *
 * When an endpoint returns nothing configured (or fails) we fall back to the same
 * shared static utils the regular mobile Deal Center uses, so the flow keeps
 * working pre-config / offline — the UI is identical either way.
 */

const PROVIDER_PLANS_URL = '/payment-plans/v1/sales/provider-plans';
const DISCOUNT_CONFIG_URL = '/company/v1/discount-config/sales';

export interface DealPlan {
  key: string;
  label: string;
  type: 'cash' | 'card' | 'financing';
  fee: number;
  pf: number;
  duration: number;
  apr: number;
  minPrice: number;
  minPriceNote?: string;
  shortlabel?: string;
  displayMonths?: string;
  provider?: string;
  providerColor?: string;
}

/** Grouped picker category — `bg`/`text` are concrete hex (this screen is inline-styled). */
export interface PayCategory {
  title: string;
  bg: string;
  text: string;
  plans: string[];
}

export interface DealPricing {
  /** key → plan (dynamic byKey, else the static map). */
  plans: Record<string, DealPlan>;
  /** rollout payment-plan picker groups (basics flat + one group per financing provider). */
  categories: PayCategory[];
  /** drop modal "+ Add Plan" groups (financing only). */
  dropAddCategories: PayCategory[];
  /** outcome-modal down-payment methods (cash/card only). */
  outcomeDownPaymentMethods: { label: string; value: string }[];
  /** default payment plan for a new rollout on this lead. */
  defaultMethod: string;
  /** pre-order discount options (e.g. [15, 20, 25]). */
  preOrderOptions: number[];
  /** default pre-order discount %. */
  defaultPreOrder: number;
  /** Sr+Vet discount % that grosses up MSRP (usually 10). */
  seniorVetPct: number;
  /** Raw backend discount config (discounts[] + programs[]) for data-driven MSRP/program math. Null pre-config. */
  discountConfig: DiscountConfig | null;
  /** true when the backend supplied plans (vs the static fallback). */
  isDynamic: boolean;
  isLoading: boolean;
}

// ── Payment-plan normalization (ports web `normalizePlan`/`normalizeResponse`) ──

/**
 * Lowe's plans arrive from the API with auto-generated keys (e.g. "ACHBankFee4",
 * "6Mat799APRBankFee4"), but the whole Lowe's flow (ACH default, `isLowesPlan`
 * filtering, `plans[key]` lookups, min-price gating) is keyed on the CANONICAL keys
 * `lowes_ach` / `lowes_cc` / `lowes_<months>m`. Without this mapping the plans keep
 * their raw API keys, `isLowesPlan` (which tests the `lowes` prefix) never matches,
 * and a Lowe's lead's picker comes back EMPTY. Verbatim port of web
 * `src/api/payment-plans.js:canonicalLowesKey`. Returns null for non-Lowe's plans.
 */
function canonicalLowesKey(plan: any, providerName?: string): string | null {
  if (!/lowe/i.test(providerName || '')) return null;
  const label = String(plan.label || plan.name || '').toLowerCase();
  const type = plan.type || 'cash';
  if (type === 'cash' || /\bach\b/.test(label)) return 'lowes_ach';
  if (/\bcc\b|credit\s*card/.test(label)) return 'lowes_cc';
  const months = label.match(/(\d+)\s*m\b/); // "36m at 7.99% apr…" → lowes_36m
  if (months) return `lowes_${months[1]}m`;
  return null;
}

function normalizePlan(plan: any, providerName?: string, providerColor?: string): DealPlan {
  return {
    key: canonicalLowesKey(plan, providerName) || plan.key || plan.id || plan.code,
    label: plan.label || plan.name || '',
    type: (plan.type as DealPlan['type']) || 'cash',
    fee: Number(plan.fee) || 0,
    pf: Number(plan.paymentFactor) || 0,
    duration: Number(plan.duration) || 0,
    apr: Number(plan.apr) || 0,
    minPrice: plan.minPrice != null ? Number(plan.minPrice) : 0,
    minPriceNote: plan.minPriceNote || '',
    shortlabel: plan.shortlabel || '',
    displayMonths: plan.displayMonths || '',
    provider: providerName || '',
    providerColor: providerColor || '',
  };
}

function normalizePlanResponse(data: any): DealPlan[] {
  const providers = data?.data?.providers || [];
  const standalone = data?.data?.standalonePlans || [];
  const all: DealPlan[] = [];
  providers.forEach((provider: any) => {
    if (provider.isActive === false) return;
    const name = provider.name || 'Unknown';
    (provider.plans || []).forEach((p: any) => {
      if (p.isActive !== false) all.push(normalizePlan(p, name, provider.color || ''));
    });
  });
  standalone.forEach((p: any) => {
    if (p.isActive !== false) all.push(normalizePlan(p, p.key === 'check' ? 'Check' : 'Other'));
  });
  return all.filter((p) => p.key);
}

/** Provider → fallback group color (ports web `getGroupColor`). */
function groupColor(group: string, fallback?: string): string {
  if (fallback) return fallback;
  const l = (group || '').toLowerCase();
  if (l.includes('greensky') || l.includes('green_sky')) return '#d9ead3';
  if (l.includes('wellsfargo') || l.includes('wells_fargo') || l.includes('wells fargo')) return '#f4cccc';
  if (l.includes('concora')) return '#c9daf8';
  if (l.includes('lowes') || l.includes('lowe')) return '#c9daf8';
  return '#f5f5f5';
}

/**
 * Is this a Lowe's plan? Lowe's leads must ONLY see Lowe's plans and non-Lowe's
 * leads must NEVER see them (web parity — see `getRolloutPaymentCategories`). We
 * detect by the plan key prefix (`lowes_ach`, `lowes_60m`, …) or provider name.
 */
function isLowesPlan(p: DealPlan): boolean {
  const key = (p.key || '').toLowerCase();
  const prov = (p.provider || '').toLowerCase();
  return key.startsWith('lowes') || prov.includes('lowe');
}

/**
 * Build the rollout picker groups from dynamic plans: basics flat, financing per
 * provider. Within a provider, plans whose minimum is the high-value threshold
 * (`WF_HIGH_MIN_PRICE`, $7,500) are split into their OWN "{provider} (Jobs over
 * $7,500)" group — web parity with the static `getRolloutPaymentCategories`
 * "Wells Fargo High (>$7,500)" split. Grouping purely by provider lumped the
 * high-value Wells Fargo plans (3672/3667/…) under the same header as the regular
 * WF plans, so the "(Jobs over $7,500)" heading was missing on mobile. The split
 * is threshold-driven (only WF has $7,500 plans today), so providers like GreenSky
 * — whose plans carry various sub-$7,500 minimums — stay in a single group.
 */
export function buildCategories(plans: DealPlan[]): PayCategory[] {
  const basics = plans.filter((p) => p.type === 'cash' || p.type === 'card');
  const cats: PayCategory[] = [];
  if (basics.length) cats.push({ title: '', bg: '#F8FAFC', text: '#0F172A', plans: basics.map((p) => p.key) });
  const groups: Record<string, DealPlan[]> = {};
  const order: string[] = [];
  plans
    .filter((p) => p.type === 'financing')
    .forEach((p) => {
      const g = p.provider || 'Other';
      if (!groups[g]) {
        groups[g] = [];
        order.push(g);
      }
      groups[g].push(p);
    });
  order.forEach((g) => {
    const color = groupColor(g, groups[g][0]?.providerColor);
    const base = groups[g].filter((p) => (p.minPrice || 0) < WF_HIGH_MIN_PRICE);
    const high = groups[g].filter((p) => (p.minPrice || 0) >= WF_HIGH_MIN_PRICE);
    // Only split into two headers when the provider genuinely has both tiers;
    // a single-tier provider keeps one group titled with just its name.
    if (base.length && high.length) {
      cats.push({ title: g, bg: color, text: '#1C252E', plans: base.map((p) => p.key) });
      cats.push({ title: `${g} (Jobs over $${WF_HIGH_MIN_PRICE.toLocaleString()})`, bg: color, text: '#1C252E', plans: high.map((p) => p.key) });
    } else {
      cats.push({ title: g, bg: color, text: '#1C252E', plans: groups[g].map((p) => p.key) });
    }
  });
  return cats;
}

// ── Static-fallback helpers (convert the shared utils' Tailwind tokens → hex) ──

const NAMED_HEX: Record<string, string> = {
  'bg-slate-50': '#F8FAFC',
  'text-slate-900': '#0F172A',
};
function toHex(cls: string): string {
  if (NAMED_HEX[cls]) return NAMED_HEX[cls];
  const m = (cls || '').match(/\[(#(?:[0-9a-fA-F]{3}){1,2})\]/);
  if (m) return m[1];
  return cls.startsWith('bg') ? '#F1F5F9' : '#1C252E';
}
function staticCategories(isLowesLead: boolean): PayCategory[] {
  return getRolloutPaymentCategories(isLowesLead).map((c) => ({
    title: c.title,
    bg: toHex(c.bg),
    text: toHex(c.text),
    plans: c.plans,
  }));
}
function staticDropAddCategories(isLowesLead: boolean): PayCategory[] {
  return getDropAddPlanCategories(isLowesLead).map((c) => ({
    title: c.title,
    bg: toHex(c.bg),
    text: toHex(c.text),
    plans: c.plans,
  }));
}

// ── Discount-config normalization (ports web `normalizeDealCenterConfig`) ──

interface DiscountShape {
  preOrderOptions: number[];
  defaultPreOrder: number;
  seniorVetPct: number;
  /** Raw config (discounts[] + programs[]) for data-driven MSRP/program math; null pre-config. */
  discountConfig: DiscountConfig | null;
}
const DISCOUNT_FALLBACK: DiscountShape = {
  preOrderOptions: [15, 20, 25],
  defaultPreOrder: 25,
  seniorVetPct: 10,
  discountConfig: null,
};
function normalizeDiscount(raw: any): DiscountShape {
  const config = raw?.data?.config;
  if (!config || config.isActive === false || !Array.isArray(config.discounts) || !config.discounts.length) {
    return DISCOUNT_FALLBACK;
  }
  // Resolve the rep-selectable discount the SAME way the MSRP math does
  // (`getSelectableDiscountKey`) rather than hardcoding `pre_order` — otherwise a
  // config keyed differently renders the static fallback tiles while MSRP is
  // computed from the config, and the two silently disagree.
  const preOrder = getSelectableOptionsDiscount(config.discounts);
  const seniors = config.discounts.find((d: any) => d.key === 'seniors');
  const options: any[] = Array.isArray(preOrder?.options) ? preOrder.options : [];
  const values = options.map((o) => Number(o.value)).filter((n) => n > 0);
  const def = options.find((o) => o.isDefault);
  return {
    preOrderOptions: values.length ? values : DISCOUNT_FALLBACK.preOrderOptions,
    defaultPreOrder: def ? Number(def.value) : values[values.length - 1] || DISCOUNT_FALLBACK.defaultPreOrder,
    seniorVetPct: seniors && seniors.type === 'fixed' ? Number(seniors.value) || 10 : DISCOUNT_FALLBACK.seniorVetPct,
    // Preserve the full config so the rollout can compute MSRP/programs data-driven (web parity).
    discountConfig: { discounts: config.discounts, programs: config.programs || [], isActive: config.isActive },
  };
}

/**
 * Fetch + normalize backend payment plans and discount config for the lead, with
 * a static fallback. `isLowesLead` only affects the fallback grouping/default.
 */
export function useDealPricing(lead: any): DealPricing {
  const isLowesLead = lead?.lowesLead === true;

  const { data: plansData, isLoading: plansLoading } = useQuery<DealPlan[]>({
    queryKey: ['dealCenterProviderPlans'],
    queryFn: async () => {
      const res = await api.get<any>(PROVIDER_PLANS_URL);
      return normalizePlanResponse(res.data);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: discountData, isLoading: discountLoading } = useQuery<DiscountShape>({
    queryKey: ['dealCenterDiscountConfig'],
    queryFn: async () => {
      const res = await api.get<any>(DISCOUNT_CONFIG_URL);
      return normalizeDiscount(res.data);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const dyn = plansData || [];
    const isDynamic = dyn.length > 0;
    const discount = discountData || DISCOUNT_FALLBACK;

    if (isDynamic) {
      // Full lookup map keeps every key resolvable (labels for already-saved
      // methods), but the picker/categories only surface plans relevant to the
      // lead: Lowe's leads see Lowe's plans only, others see non-Lowe's only.
      const plans: Record<string, DealPlan> = {};
      dyn.forEach((p) => {
        plans[p.key] = p;
      });
      const relevant = dyn.filter((p) => (isLowesLead ? isLowesPlan(p) : !isLowesPlan(p)));

      // A Lowe's lead whose dynamic provider-plans response carried NO Lowe's plans
      // (the company hasn't published Lowe's provider plans, or they arrived without
      // a recognizable Lowe's provider/key) would otherwise leave the picker EMPTY.
      // Fall back to the shared static Lowe's plans (lowes_ach / lowes_cc / financing)
      // so the dropdown is always populated with Lowe's-ONLY methods — the whole flow
      // is keyed on those canonical keys anyway. Non-Lowe's leads keep the dynamic set.
      if (isLowesLead && relevant.length === 0) {
        const lowesCategories = staticCategories(true);
        const mergedPlans: Record<string, DealPlan> = { ...plans };
        lowesCategories.forEach((c) =>
          c.plans.forEach((k) => {
            const sp = (STATIC_PLANS as Record<string, DealPlan>)[k];
            if (sp) mergedPlans[k] = sp;
          })
        );
        return {
          plans: mergedPlans,
          categories: lowesCategories,
          dropAddCategories: staticDropAddCategories(true),
          outcomeDownPaymentMethods: getOutcomeDownPaymentMethods(true),
          defaultMethod: getDefaultPaymentMethod(true),
          preOrderOptions: discount.preOrderOptions,
          defaultPreOrder: discount.defaultPreOrder,
          seniorVetPct: discount.seniorVetPct,
          discountConfig: discount.discountConfig,
          isDynamic: true,
          isLoading: plansLoading || discountLoading,
        };
      }

      const categories = buildCategories(relevant);
      const basics = relevant.filter((p) => p.type === 'cash' || p.type === 'card');
      const preferred = isLowesLead
        ? basics.find((p) => /ach/i.test(p.key)) || basics[0]
        : basics.find((p) => p.key === 'check') || basics[0];
      return {
        plans,
        categories,
        dropAddCategories: categories.filter((c) => c.title !== ''),
        outcomeDownPaymentMethods: basics.map((p) => ({ label: p.label, value: p.key })),
        defaultMethod: preferred?.key || getDefaultPaymentMethod(isLowesLead),
        preOrderOptions: discount.preOrderOptions,
        defaultPreOrder: discount.defaultPreOrder,
        seniorVetPct: discount.seniorVetPct,
        discountConfig: discount.discountConfig,
        isDynamic: true,
        isLoading: plansLoading || discountLoading,
      };
    }

    // Static fallback — identical to the regular mobile Deal Center's source.
    return {
      plans: STATIC_PLANS as Record<string, DealPlan>,
      categories: staticCategories(isLowesLead),
      dropAddCategories: staticDropAddCategories(isLowesLead),
      outcomeDownPaymentMethods: getOutcomeDownPaymentMethods(isLowesLead),
      defaultMethod: getDefaultPaymentMethod(isLowesLead),
      preOrderOptions: discount.preOrderOptions,
      defaultPreOrder: discount.defaultPreOrder,
      seniorVetPct: discount.seniorVetPct,
      discountConfig: discount.discountConfig,
      isDynamic: false,
      isLoading: plansLoading || discountLoading,
    };
  }, [plansData, discountData, isLowesLead, plansLoading, discountLoading]);
}

// ── Pure plan-math helpers (take the resolved `plans` map so they work with
//    either the dynamic or the static source) ──────────────────────────────

export function planLabelOf(plans: Record<string, DealPlan>, key?: string): string {
  return plans[key || '']?.label || 'Select payment plan';
}

export function isFinancing(plans: Record<string, DealPlan>, key?: string): boolean {
  return plans[key || '']?.type === 'financing';
}

/**
 * Monthly payment for a financing plan. Ports web
 * `calculateMonthlyPaymentForPlan` (PremiumQuoteCard.js:25-49) EXACTLY, including
 * the $35 minimum-payment floor and the plan-label special cases — previously
 * missing on mobile, so reps could quote a monthly the paperwork won't honor:
 *   - labels starting `3198`/`1529` → flat $35 when basePrice < 2500
 *   - labels starting `1148`/`1019` → floor the pf-based payment to $35
 */
const MIN_MONTHLY_PAYMENT = 35;
export function calcMonthly(plans: Record<string, DealPlan>, principal: number, key?: string): number {
  const plan = plans[key || ''] as DealPlan | undefined;
  if (!plan || plan.type !== 'financing' || !principal || principal <= 0) return 0;

  const label = plan.label || '';
  const isLowBasePricePlan = label.startsWith('3198') || label.startsWith('1529');
  if (isLowBasePricePlan && principal < 2500) return MIN_MONTHLY_PAYMENT;

  if (plan.pf && plan.pf > 0) {
    const payment = principal * plan.pf;
    const isMinPaymentPlan = label.startsWith('1148') || label.startsWith('1019');
    if (isMinPaymentPlan && payment < MIN_MONTHLY_PAYMENT) return MIN_MONTHLY_PAYMENT;
    return payment;
  }
  if (plan.duration && plan.duration > 0) return principal / plan.duration;
  return 0;
}

/** Inflate a tier value by the selected plan's bank fee (web `calculateResultUtil`). */
export function withPlanFee(plans: Record<string, DealPlan>, value: number, method?: string): number {
  const fee = plans[method || '']?.fee || 0;
  return fee >= 1 ? value : value / (1 - fee);
}

export function planBelowMin(plans: Record<string, DealPlan>, key: string, price: number): boolean {
  const min = plans[key]?.minPrice || 0;
  if (!min || !price || price <= 0) return false;
  return price < min;
}

export function belowMinMsg(plans: Record<string, DealPlan>, key: string, price: number): string {
  const min = plans[key]?.minPrice || 0;
  if (!min) return '';
  const n = Number(price) || 0;
  // Web (`validatePriceForPaymentMethod`) validates the END PRICE against the plan
  // minimum, not a "cost price" — string aligned to web.
  return n === 0
    ? `This payment plan requires a minimum price of $${min.toLocaleString()}.`
    : `This payment plan requires a minimum price of $${min.toLocaleString()}. Current price: $${n.toLocaleString()}.`;
}
