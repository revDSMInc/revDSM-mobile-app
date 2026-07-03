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
  /** true when the backend supplied plans (vs the static fallback). */
  isDynamic: boolean;
  isLoading: boolean;
}

// ── Payment-plan normalization (ports web `normalizePlan`/`normalizeResponse`) ──

function normalizePlan(plan: any, providerName?: string, providerColor?: string): DealPlan {
  return {
    key: plan.key || plan.id || plan.code,
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

/** Build the rollout picker groups from dynamic plans: basics flat, financing per provider. */
function buildCategories(plans: DealPlan[]): PayCategory[] {
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
    cats.push({ title: g, bg: groupColor(g, groups[g][0]?.providerColor), text: '#1C252E', plans: groups[g].map((p) => p.key) });
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
}
const DISCOUNT_FALLBACK: DiscountShape = {
  preOrderOptions: [15, 20, 25],
  defaultPreOrder: 25,
  seniorVetPct: 10,
};
function normalizeDiscount(raw: any): DiscountShape {
  const config = raw?.data?.config;
  if (!config || config.isActive === false || !Array.isArray(config.discounts) || !config.discounts.length) {
    return DISCOUNT_FALLBACK;
  }
  const preOrder = config.discounts.find((d: any) => d.key === 'pre_order');
  const seniors = config.discounts.find((d: any) => d.key === 'seniors');
  const options: any[] = Array.isArray(preOrder?.options) ? preOrder.options : [];
  const values = options.map((o) => Number(o.value)).filter((n) => n > 0);
  const def = options.find((o) => o.isDefault);
  return {
    preOrderOptions: values.length ? values : DISCOUNT_FALLBACK.preOrderOptions,
    defaultPreOrder: def ? Number(def.value) : values[values.length - 1] || DISCOUNT_FALLBACK.defaultPreOrder,
    seniorVetPct: seniors && seniors.type === 'fixed' ? Number(seniors.value) || 10 : DISCOUNT_FALLBACK.seniorVetPct,
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
      const plans: Record<string, DealPlan> = {};
      dyn.forEach((p) => {
        plans[p.key] = p;
      });
      const categories = buildCategories(dyn);
      const basics = dyn.filter((p) => p.type === 'cash' || p.type === 'card');
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

/** Monthly payment for a financing plan (pf-based multiply, else duration divide). */
export function calcMonthly(plans: Record<string, DealPlan>, principal: number, key?: string): number {
  const plan = plans[key || ''] as DealPlan | undefined;
  if (!plan || plan.type !== 'financing' || !principal || principal <= 0) return 0;
  if (plan.pf) return principal * plan.pf;
  return principal / (plan.duration || 12);
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
  return n === 0
    ? `This plan requires a minimum cost price of $${min.toLocaleString()}.`
    : `This plan requires a minimum cost price of $${min.toLocaleString()} (cost: $${n.toLocaleString()}).`;
}
