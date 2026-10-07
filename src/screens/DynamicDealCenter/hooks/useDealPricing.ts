import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

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

export interface PayCategory {
  title: string;
  bg: string;
  text: string;
  plans: string[];
}

export interface DealPricing {
  plans: Record<string, DealPlan>;
  categories: PayCategory[];
  dropAddCategories: PayCategory[];
  outcomeDownPaymentMethods: { label: string; value: string }[];
  defaultMethod: string;
  preOrderOptions: number[];
  defaultPreOrder: number;
  seniorVetPct: number;
  discountConfig: DiscountConfig | null;
  isDynamic: boolean;
  isLoading: boolean;
}

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

function groupColor(group: string, fallback?: string): string {
  if (fallback) return fallback;
  const l = (group || '').toLowerCase();
  if (l.includes('greensky') || l.includes('green_sky')) return '#d9ead3';
  if (l.includes('wellsfargo') || l.includes('wells_fargo') || l.includes('wells fargo')) return '#f4cccc';
  if (l.includes('concora')) return '#c9daf8';
  if (l.includes('lowes') || l.includes('lowe')) return '#c9daf8';
  return '#f5f5f5';
}

function isLowesPlan(p: DealPlan): boolean {
  const key = (p.key || '').toLowerCase();
  const prov = (p.provider || '').toLowerCase();
  return key.startsWith('lowes') || prov.includes('lowe');
}

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
    if (base.length && high.length) {
      cats.push({ title: g, bg: color, text: '#1C252E', plans: base.map((p) => p.key) });
      cats.push({ title: `${g} (Jobs over $${WF_HIGH_MIN_PRICE.toLocaleString()})`, bg: color, text: '#1C252E', plans: high.map((p) => p.key) });
    } else {
      cats.push({ title: g, bg: color, text: '#1C252E', plans: groups[g].map((p) => p.key) });
    }
  });
  return cats;
}

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

interface DiscountShape {
  preOrderOptions: number[];
  defaultPreOrder: number;
  seniorVetPct: number;
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
  const preOrder = getSelectableOptionsDiscount(config.discounts);
  const seniors = config.discounts.find((d: any) => d.key === 'seniors');
  const options: any[] = Array.isArray(preOrder?.options) ? preOrder.options : [];
  const values = options.map((o) => Number(o.value)).filter((n) => n > 0);
  const def = options.find((o) => o.isDefault);
  return {
    preOrderOptions: values.length ? values : DISCOUNT_FALLBACK.preOrderOptions,
    defaultPreOrder: def ? Number(def.value) : values[values.length - 1] || DISCOUNT_FALLBACK.defaultPreOrder,
    seniorVetPct: seniors && seniors.type === 'fixed' ? Number(seniors.value) || 10 : DISCOUNT_FALLBACK.seniorVetPct,
    discountConfig: { discounts: config.discounts, programs: config.programs || [], isActive: config.isActive },
  };
}

export function useDealPricing(lead: any): DealPricing {
  const isLowesLead = lead?.lowesLead === true;
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data: plansData, isLoading: plansLoading } = useQuery<DealPlan[]>({
    queryKey: ['dealCenterProviderPlans'],
    queryFn: () =>
      cachedFetch(
        OFFLINE_CACHE.PAYMENT_PLANS,
        async () => {
          const res = await api.get<any>(PROVIDER_PLANS_URL);
          return normalizePlanResponse(res.data);
        },
        { online: isOnline(), userId }
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: discountData, isLoading: discountLoading } = useQuery<DiscountShape>({
    queryKey: ['dealCenterDiscountConfig'],
    queryFn: () =>
      cachedFetch(
        OFFLINE_CACHE.DISCOUNT_CONFIG,
        async () => {
          const res = await api.get<any>(DISCOUNT_CONFIG_URL);
          return normalizeDiscount(res.data);
        },
        // ⚠️ A discount config legitimately has no plans array; "empty" here is no config at all.
        { online: isOnline(), userId, isEmpty: (d: any) => !d }
      ),
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
      const relevant = isLowesLead ? dyn : dyn.filter((p) => !isLowesPlan(p));

      if (isLowesLead && !relevant.some(isLowesPlan)) {
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
      const allBasics = relevant.filter((p) => p.type === 'cash' || p.type === 'card');
      const basics = isLowesLead ? allBasics.filter(isLowesPlan) : allBasics;
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

export function planLabelOf(plans: Record<string, DealPlan>, key?: string): string {
  return plans[key || '']?.label || 'Select payment plan';
}

export function planProviderAbbr(plan?: DealPlan, key?: string): string {
  const prov = (plan?.provider || '').trim();
  if (prov) {
    const lower = prov.toLowerCase();
    if (lower.includes('wells')) return 'WF';
    if (lower.includes('green')) return 'GS';
    if (lower.includes('concora')) return 'CN';
    if (lower.includes('lowe')) return 'LW';
    const words = prov.split(/\s+/).filter(Boolean);
    if (words.length > 1) return words.map((w) => w[0]).join('').toUpperCase().slice(0, 3);
    const caps = prov.replace(/[^A-Z]/g, '');
    if (caps.length >= 2) return caps.slice(0, 3);
    return prov.slice(0, 2).toUpperCase();
  }
  const k = (key || plan?.key || '').toLowerCase();
  if (k.startsWith('wf')) return 'WF';
  if (k.startsWith('greensky') || k.startsWith('gs')) return 'GS';
  if (k.startsWith('concora')) return 'CN';
  if (k.startsWith('lowes')) return 'LW';
  return '';
}

export function compactPlanLabel(plans: Record<string, DealPlan>, key?: string): string {
  const plan = plans[key || ''];
  if (!plan) return '';
  const label = String(plan.label || '');
  const abbr = planProviderAbbr(plan, key);
  const code = label.match(/^\s*(\d+)/)?.[1] || '';
  const aprRaw = Number(plan.apr) || 0;
  const aprPct = aprRaw > 0 && aprRaw < 1 ? aprRaw * 100 : aprRaw;
  const months = Number(label.match(/(\d+)\s*Months?/i)?.[1] || 0) || Number(plan.duration) || 0;
  const parts: string[] = [];
  const codePart = `${abbr}${code}`.trim();
  if (codePart) parts.push(codePart);
  parts.push(aprPct > 0 ? `${Number(aprPct.toFixed(2))}% APR` : '0% APR');
  if (months > 0) parts.push(`${months}M`);
  return parts.length ? parts.join(', ') : label;
}

export function isFinancing(plans: Record<string, DealPlan>, key?: string): boolean {
  return plans[key || '']?.type === 'financing';
}

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
    ? `This payment plan requires a minimum price of $${min.toLocaleString()}.`
    : `This payment plan requires a minimum price of $${min.toLocaleString()}. Current price: $${n.toLocaleString()}.`;
}
