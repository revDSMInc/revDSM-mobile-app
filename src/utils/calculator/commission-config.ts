export interface CommissionTier {
  id: string;
  name: string;
  startPct: number;
  endPct: number | null;
  rate: number;
  overagePct: number;
  adminFeeApplies: boolean;
}

export interface PayoutBucket {
  fromDay: number;
  toDay: number;
  payDayOfMonth: number;
  monthOffset: number;
}

export interface PayoutConfig {
  scheduleType: string;
  earnedDateField: string;
  payDateWeekday: number | null;
  payDateAdjustment: string;
  nonBankingDayAdjustment: string;
  nonBankingDays: string[];
  periodEndWeekday: number | null;
  lagPeriods: number;
  dayOfMonthSchedule: PayoutBucket[];
}

export interface CommissionConfig {
  adminFee: number;
  tiers: CommissionTier[];
  payout: PayoutConfig;
  updatedAt: string | null;
  isConfigured: boolean;
}

export const WEEKDAY_BY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const DEFAULT_PAYOUT_CONFIG: PayoutConfig = {
  scheduleType: 'none',
  earnedDateField: 'installDate',
  payDateWeekday: 5, // Friday
  payDateAdjustment: 'next',
  nonBankingDayAdjustment: 'next',
  nonBankingDays: [],
  periodEndWeekday: null,
  lagPeriods: 0,
  dayOfMonthSchedule: [
    { fromDay: 1, toDay: 8, payDayOfMonth: 17, monthOffset: 0 },
    { fromDay: 9, toDay: 15, payDayOfMonth: 24, monthOffset: 0 },
    { fromDay: 16, toDay: 22, payDayOfMonth: 31, monthOffset: 0 },
    { fromDay: 23, toDay: 29, payDayOfMonth: 7, monthOffset: 1 },
    { fromDay: 30, toDay: 31, payDayOfMonth: 14, monthOffset: 1 },
  ],
};

function resolveWeekday(numeric: any, name: any): number | null {
  if (typeof numeric === 'number') return numeric;
  const mapped = WEEKDAY_BY_NAME[String(name || '').toLowerCase()];
  return mapped === undefined ? null : mapped;
}

export function normalizePayoutConfig(raw: any): PayoutConfig {
  if (!raw) return DEFAULT_PAYOUT_CONFIG;

  const schedule: PayoutBucket[] = (Array.isArray(raw.dayOfMonthSchedule)
    ? raw.dayOfMonthSchedule
    : []
  )
    .map((b: any) => ({
      fromDay: Number(b?.fromDay) || 1,
      toDay: Number(b?.toDay) || 31,
      payDayOfMonth: Number(b?.payDayOfMonth) || 1,
      monthOffset: Number(b?.monthOffset) || 0,
    }))
    .sort((a: PayoutBucket, b: PayoutBucket) => a.fromDay - b.fromDay);

  return {
    scheduleType: raw.scheduleType || 'none',
    earnedDateField: raw.earnedDateField || 'installDate',
    payDateWeekday: resolveWeekday(raw.payDateWeekday, raw.payDateWeekdayName),
    payDateAdjustment: raw.payDateAdjustment || 'next', // 'next' | 'previous' | 'none'
    nonBankingDayAdjustment: raw.nonBankingDayAdjustment || 'next',
    nonBankingDays: Array.isArray(raw.nonBankingDays) ? raw.nonBankingDays : [],
    periodEndWeekday: resolveWeekday(raw.periodEndWeekday, raw.periodEndWeekdayName),
    lagPeriods: Number(raw.lagPeriods) || 0,
    dayOfMonthSchedule: schedule.length ? schedule : DEFAULT_PAYOUT_CONFIG.dayOfMonthSchedule,
  };
}

export function normalizeCommissionConfig(raw: any): CommissionConfig | null {
  if (!raw) return null;

  const tiers: CommissionTier[] = (Array.isArray(raw.tiers) ? raw.tiers : [])
    .map((t: any, i: number) => ({
      id: t?.id || `tier_${i}`,
      name: t?.name || `Tier ${i + 1}`,
      startPct: Number(t?.startPct) || 0,
      endPct: t?.endPct === null || t?.endPct === undefined ? null : Number(t.endPct),
      rate: Number(t?.rate) || 0,
      overagePct: Number(t?.overagePct) || 0,
      adminFeeApplies: t?.adminFeeApplies !== false,
    }))
    .sort((a: CommissionTier, b: CommissionTier) => a.startPct - b.startPct);

  return {
    adminFee: Number(raw.adminFee) || 0,
    tiers,
    payout: normalizePayoutConfig(raw.payout),
    updatedAt: raw.updatedAt || null,
    isConfigured: tiers.length > 0,
  };
}
