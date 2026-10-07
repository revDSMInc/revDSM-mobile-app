import { paymentPlans } from './payment-plans';
import type { CommissionConfig, CommissionTier } from './commission-config';

const LEGACY_ADMIN_FEE = 500;

interface LegacyTier {
  name: string;
  min: number;
  rate: number;
  overageRate: number;
  overageFrom: number;
}

const LEGACY_TIERS: LegacyTier[] = [
  { name: '130% retail', min: 5102, rate: 0.24, overageRate: 0, overageFrom: 0 },
  { name: '100% retail', min: 4046, rate: 0.2, overageRate: 0, overageFrom: 0 },
  { name: '65% retail (PAR)', min: 2814, rate: 0.08, overageRate: 0.4, overageFrom: 2814 },
  { name: '50% retail', min: 2023, rate: 0.05, overageRate: 0, overageFrom: 0 },
  { name: '40% retail', min: 1619, rate: 0.02, overageRate: 0, overageFrom: 0 },
  { name: 'below 40% retail', min: 0, rate: 0.01, overageRate: 0, overageFrom: 0 },
];

export interface PaymentSplit {
  amount: number;
  method: string;
}

export interface CommissionOptions {
  config?: CommissionConfig | null;
  retailPrice?: number;
  payments?: PaymentSplit[] | null;
  adminFeeOverride?: number | null;
}

export type CommissionSource = 'config' | 'config-no-retail' | 'legacy' | 'below-lowest' | 'none';

export interface CommissionDetails {
  amount: number;
  details: {
    endPrice: number;
    bankFee: number;
    bankFeeAmount: number;
    bankPct: number;
    afterBankFee: number;
    afterDeduction: number;
    retail: number;
    threshold: number | null;
    lowestThreshold: number | null;
    commissionRate: number;
    baseCommission: number;
    overageCommission: number;
    adminFeeAmount: number;
    tierId: string | null;
    tierName: string;
    paymentMethod: string;
    paymentMethodLabel: string;
    configUpdatedAt: string | null;
    source: CommissionSource;
  };
}

interface TierWithThreshold extends CommissionTier {
  raw: number;
  adminFeeAmount: number;
  threshold: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

const baseDetails = (
  paymentMethod: string,
  source: CommissionSource
): CommissionDetails['details'] => ({
  endPrice: 0,
  bankFee: 0,
  bankFeeAmount: 0,
  bankPct: 0,
  afterBankFee: 0,
  afterDeduction: 0,
  retail: 0,
  threshold: null,
  lowestThreshold: null,
  commissionRate: 0,
  baseCommission: 0,
  overageCommission: 0,
  adminFeeAmount: 0,
  tierId: null,
  tierName: 'none',
  paymentMethod,
  paymentMethodLabel: '',
  configUpdatedAt: null,
  source,
});

export function resolveBankPct(
  payments: PaymentSplit[] | null | undefined,
  plans: Record<string, any> = paymentPlans
): number {
  const rows = (payments || []).filter((p) => Number(p?.amount) > 0);
  if (!rows.length) return 0;

  const total = rows.reduce((s, p) => s + Number(p.amount), 0);
  if (total <= 0) return 0;

  const weighted = rows.reduce((s, p) => s + Number(p.amount) * (plans?.[p.method]?.fee || 0), 0);
  return weighted / total;
}

export function buildTierThresholds(
  tiers: CommissionTier[],
  retail: number,
  adminFee: number,
  bankPct: number
): TierWithThreshold[] {
  const divisor = 1 - bankPct;
  return (tiers || []).map((t) => {
    const raw = retail * (t.startPct / 100);
    const fee = t.adminFeeApplies ? adminFee : 0;
    return {
      ...t,
      raw,
      adminFeeAmount: fee,
      threshold: divisor > 0 ? (raw + fee) / divisor : Infinity,
    };
  });
}

export function resolveTier(
  rows: TierWithThreshold[],
  endPrice: number
): TierWithThreshold | null {
  let match: TierWithThreshold | null = null;
  (rows || []).forEach((r) => {
    if (endPrice >= r.threshold) match = r;
  });
  return match;
}

export function calculateCommission(
  endPrice: number,
  paymentMethod: string,
  options: CommissionOptions = {}
): CommissionDetails {
  const { config = null, retailPrice = 0, payments = null, adminFeeOverride = null } = options;

  if (!endPrice || !paymentMethod || endPrice <= 0) {
    return { amount: 0, details: baseDetails(paymentMethod, 'none') };
  }

  const rows: PaymentSplit[] = payments?.length
    ? payments
    : [{ amount: endPrice, method: paymentMethod }];
  const bankPct = resolveBankPct(rows);
  const plan = (paymentPlans as Record<string, any>)[paymentMethod];
  const planLabel = plan?.label || paymentMethod;
  const afterBankFee = endPrice * (1 - bankPct);

  if (!config?.isConfigured) {
    const adminFeeAmount = adminFeeOverride ?? LEGACY_ADMIN_FEE;
    const afterDeduction = Math.max(0, afterBankFee - adminFeeAmount);
    const t =
      LEGACY_TIERS.find((x) => endPrice >= x.min) || LEGACY_TIERS[LEGACY_TIERS.length - 1];

    const baseCommission = afterDeduction * t.rate;
    const overageCommission = t.overageRate
      ? Math.max(0, endPrice - t.overageFrom) * t.overageRate
      : 0;

    return {
      amount: r2(baseCommission + overageCommission),
      details: {
        ...baseDetails(paymentMethod, 'legacy'),
        endPrice: r2(endPrice),
        bankFee: bankPct,
        bankPct,
        bankFeeAmount: r2(endPrice * bankPct),
        afterBankFee: r2(afterBankFee),
        afterDeduction: r2(afterDeduction),
        commissionRate: t.rate,
        threshold: t.min,
        baseCommission: r2(baseCommission),
        overageCommission: r2(overageCommission),
        adminFeeAmount: r2(adminFeeAmount),
        tierName: t.name,
        paymentMethodLabel: planLabel,
      },
    };
  }

  const retail = retailPrice > 0 ? retailPrice : endPrice;

  const adminFee = adminFeeOverride ?? config.adminFee;

  const withThresholds = buildTierThresholds(config.tiers, retail, adminFee, bankPct);
  const lowestThreshold = withThresholds.length ? withThresholds[0].threshold : 0;
  const tier = resolveTier(withThresholds, endPrice);

  if (!tier) {
    return {
      amount: 0,
      details: {
        ...baseDetails(paymentMethod, 'below-lowest'),
        endPrice: r2(endPrice),
        bankFee: bankPct,
        bankPct,
        bankFeeAmount: r2(endPrice * bankPct),
        afterBankFee: r2(afterBankFee),
        retail: r2(retail),
        lowestThreshold: r2(lowestThreshold),
        tierName: 'no matching tier',
        paymentMethodLabel: planLabel,
        configUpdatedAt: config.updatedAt,
      },
    };
  }

  const matched: TierWithThreshold = tier;
  const rate = matched.rate / 100;
  let baseCommission: number;
  let overageCommission = 0;

  if (matched.overagePct > 0) {
    baseCommission = matched.raw * rate;
    overageCommission = Math.max(0, endPrice - matched.threshold) * (matched.overagePct / 100);
  } else {
    baseCommission = Math.max(0, afterBankFee - matched.adminFeeAmount) * rate;
  }

  return {
    amount: r2(baseCommission + overageCommission),
    details: {
      ...baseDetails(paymentMethod, retailPrice > 0 ? 'config' : 'config-no-retail'),
      endPrice: r2(endPrice),
      bankFee: bankPct,
      bankPct,
      bankFeeAmount: r2(endPrice * bankPct),
      afterBankFee: r2(afterBankFee),
      afterDeduction: r2(Math.max(0, afterBankFee - matched.adminFeeAmount)),
      retail: r2(retail),
      threshold: r2(matched.threshold),
      lowestThreshold: r2(lowestThreshold),
      commissionRate: rate,
      baseCommission: r2(baseCommission),
      overageCommission: r2(overageCommission),
      adminFeeAmount: r2(matched.adminFeeAmount),
      tierId: matched.id,
      tierName: matched.name,
      paymentMethodLabel: planLabel,
      configUpdatedAt: config.updatedAt,
    },
  };
}
