/**
 * Company commission ladder + payout calendar.
 *
 *   GET /company/v1/sales/commission-config
 *
 * Pure and RN-free on purpose (same reason `utils/addendum-drafts.ts` and
 * `utils/inspection-photos.ts` are): the rules that decide what a rep is paid
 * must be testable under jest, and every consumer of them pulls in React
 * Native.
 *
 * `normalizeCommissionConfig` returns null only when the document is missing.
 * A document with no tiers still carries `payout`, which is useful on its own —
 * `isConfigured` is the flag the calculator gates on.
 */

export interface CommissionTier {
  id: string;
  name: string;
  /** Inclusive lower bound as a % of RETAIL. Feeds a dollar threshold. */
  startPct: number;
  /** Label only — never used in the arithmetic. `null` = open-ended top tier. */
  endPct: number | null;
  /** Whole number: `20` means 20%. */
  rate: number;
  /** Whole number. Applied to the amount above the tier's own threshold. */
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
  /** Which field on the job is the "earned" date. Currently `installDate`. */
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
  /** Flat dollars, e.g. 500. NOT a percentage. */
  adminFee: number;
  tiers: CommissionTier[];
  payout: PayoutConfig;
  updatedAt: string | null;
  isConfigured: boolean;
}

/** JS Date#getDay() numbering — matches the API's weekday numbers exactly. */
export const WEEKDAY_BY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * WARNING `scheduleType` is `'none'`, per PAYOUT-DATE-GUIDE.md - a company that
 * has not configured a schedule has NO payout date, and the Job Tracker shows
 * `TBD` rather than a fabricated one. The band table below is the guide's
 * documented default for `dayOfMonthSchedule` ONLY (the legacy hardcoded
 * rule), used when a `dayOfMonth` config arrives carrying no bands.
 */
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
    // No schedule means no date - never a guessed one. See the warning above.
    scheduleType: raw.scheduleType || 'none',
    earnedDateField: raw.earnedDateField || 'installDate',
    payDateWeekday: resolveWeekday(raw.payDateWeekday, raw.payDateWeekdayName),
    payDateAdjustment: raw.payDateAdjustment || 'next', // 'next' | 'previous' | 'none'
    nonBankingDayAdjustment: raw.nonBankingDayAdjustment || 'next',
    nonBankingDays: Array.isArray(raw.nonBankingDays) ? raw.nonBankingDays : [],
    // Period fields are inert while scheduleType is 'dayOfMonth'; the day-of-month
    // fields are inert while it is 'payPeriodLag'. Both are carried either way.
    periodEndWeekday: resolveWeekday(raw.periodEndWeekday, raw.periodEndWeekdayName),
    // WARNING PAY DATES, not days. The engine floors it at 1: a 0 would put the
    // pay date a week BEFORE the first one after the period closed.
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
      // Absent means it applies, matching the static behaviour it replaces.
      adminFeeApplies: t?.adminFeeApplies !== false,
    }))
    // Ascending — `resolveTier` relies on this ordering to pick the highest band.
    .sort((a: CommissionTier, b: CommissionTier) => a.startPct - b.startPct);

  return {
    adminFee: Number(raw.adminFee) || 0,
    tiers,
    payout: normalizePayoutConfig(raw.payout),
    updatedAt: raw.updatedAt || null,
    isConfigured: tiers.length > 0,
  };
}
