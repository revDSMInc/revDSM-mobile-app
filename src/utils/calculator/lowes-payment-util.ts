import { paymentPlans } from './payment-plans';
import { validatePriceForPaymentMethod } from './payment-method-validation';

export const LOWES_FINANCING_KEYS = [
  'lowes_6m',
  'lowes_36m',
  'lowes_60m',
  'lowes_84m',
  'lowes_120m',
] as const;

export const LOWES_BASIC_KEYS = ['lowes_ach', 'lowes_cc'] as const;

export const LOWES_ALL_KEYS = [...LOWES_BASIC_KEYS, ...LOWES_FINANCING_KEYS];

export const STANDARD_BASIC_KEYS = ['check', 'mcVisaDscvr', 'amex'];

export type PaymentPlanCategory = {
  title: string;
  bg: string;
  text: string;
  plans: string[];
};

export function isPlanBelowMinPrice(planKey: string, price: number): boolean {
  const plan = paymentPlans[planKey];
  if (!plan?.minPrice) return false;
  if (!price || price <= 0) return false;
  const numericPrice = Number(price) || 0;
  return numericPrice === 0 || numericPrice < plan.minPrice;
}

export function getBelowMinMessage(planKey: string, price: number): string {
  const plan = paymentPlans[planKey];
  if (!plan?.minPrice) return '';
  const numericPrice = Number(price) || 0;
  if (numericPrice === 0) {
    return `This plan requires a minimum cost price of $${plan.minPrice.toLocaleString()}.`;
  }
  return `This plan requires a minimum cost price of $${plan.minPrice.toLocaleString()} (cost: $${numericPrice.toLocaleString()}).`;
}

export function getDefaultPaymentMethod(isLowesLead: boolean, existing?: string): string {
  if (isLowesLead) {
    if (!existing || existing === 'check') return 'lowes_ach';
    return existing;
  }
  return existing || 'check';
}

function getStandardPaymentCategories(): PaymentPlanCategory[] {
  return [
    {
      title: 'Basic Options',
      bg: 'bg-slate-50',
      text: 'text-slate-900',
      plans: [...STANDARD_BASIC_KEYS],
    },
    {
      title: 'GreenSky Plans',
      bg: 'bg-[#d9ead3]',
      text: 'text-[#2e4d2e]',
      plans: Object.keys(paymentPlans).filter((k) => k.startsWith('greensky')),
    },
    {
      title: 'Wells Fargo Plans',
      bg: 'bg-[#f4cccc]',
      text: 'text-[#662222]',
      plans: Object.keys(paymentPlans).filter(
        (k) =>
          k.startsWith('wf') &&
          !['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'].includes(k)
      ),
    },
    {
      title: 'Wells Fargo High (>$7,500)',
      bg: 'bg-[#f4cccc]',
      text: 'text-[#662222]',
      plans: ['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'],
    },
    {
      title: 'Concora Credit',
      bg: 'bg-[#c9daf8]',
      text: 'text-[#223366]',
      plans: ['concora'],
    },
  ];
}

export function getRolloutPaymentCategories(isLowesLead: boolean): PaymentPlanCategory[] {
  const standard = getStandardPaymentCategories();
  if (isLowesLead) {
    return [
      {
        title: "",
        bg: 'bg-slate-50',
        text: 'text-slate-900',
        plans: [...LOWES_BASIC_KEYS],
      },
      {
        title: "Lowe's Plan",
        bg: 'bg-[#e8f4fd]',
        text: 'text-slate-900',
        plans: [...LOWES_FINANCING_KEYS],
      },
      ...standard.filter((c) => c.title !== 'Basic Options'),
    ];
  }
  return standard;
}

export function getDropAddPlanCategories(isLowesLead: boolean): PaymentPlanCategory[] {
  if (isLowesLead) {
    return [
      {
        title: "Lowe's Plans",
        bg: 'bg-[#e8f4fd]',
        text: 'text-slate-900',
        plans: [...LOWES_FINANCING_KEYS],
      },
      ...getRolloutPaymentCategories(false).filter((cat) => cat.title !== 'Basic Options'),
    ];
  }
  return getRolloutPaymentCategories(false).filter(cat => cat.title !== 'Basic Options');
}

export function getOutcomeDownPaymentMethods(isLowesLead: boolean) {
  if (isLowesLead) {
    return [
      { label: 'ACH (4% Fee)', value: 'lowes_ach' },
      { label: 'CC (4% Fee)', value: 'lowes_cc' },
    ];
  }
  return [
    { label: 'Check (0% Fee)', value: 'check' },
    { label: 'MC/VISA/DSCVR (3.00% Fee)', value: 'mcVisaDscvr' },
    { label: 'AMEX (5.00% Fee)', value: 'amex' },
  ];
}

export function validatePlanSelection(
  planKey: string,
  price: number
): { ok: boolean; message: string } {
  const v = validatePriceForPaymentMethod(price, planKey);
  return { ok: v.isValid, message: v.message };
}
