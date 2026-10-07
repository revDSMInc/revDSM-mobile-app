import type { PayoutConfig, PayoutBucket } from './commission-config';

export const PAYOUT_SCHEDULE_TYPES = {
  NONE: 'none',
  PAY_PERIOD_LAG: 'payPeriodLag',
  DAY_OF_MONTH: 'dayOfMonth',
} as const;

const MAX_GUARD_WEEKS = 60;
const MAX_SHIFT_DAYS = 30;

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseEarnedDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : startOfDay(value);

  const text = String(value).trim();
  if (!text || text.toUpperCase() === 'TBD') return null;

  const iso = ISO_DATE.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const us = US_DATE.exec(text);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));

  const native = new Date(text);
  return isNaN(native.getTime()) ? null : startOfDay(native);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function snapForwardToWeekday(date: Date, weekday: number): Date {
  return addDays(date, (((weekday - date.getDay()) % 7) + 7) % 7);
}

function snapBackwardToWeekday(date: Date, weekday: number): Date {
  return addDays(date, -((((date.getDay() - weekday) % 7) + 7) % 7));
}

function snapToWeekday(date: Date, weekday: number | null, adjustment: string): Date {
  if (weekday === null || weekday === undefined) return date;
  if (adjustment === 'none') return date;
  if (adjustment === 'previous') return snapBackwardToWeekday(date, weekday);
  return snapForwardToWeekday(date, weekday);
}

function isNonBankingDay(date: Date, config: PayoutConfig): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  const holidays = Array.isArray(config.nonBankingDays) ? config.nonBankingDays : [];
  return holidays.some((h) => String(h).slice(0, 10) === dateKey(date));
}

function shiftOffNonBankingDays(date: Date, config: PayoutConfig): Date {
  const step = config.nonBankingDayAdjustment === 'previous' ? -1 : 1;
  let out = date;
  for (let i = 0; i < MAX_SHIFT_DAYS && isNonBankingDay(out, config); i += 1) {
    out = addDays(out, step);
  }
  return out;
}

export function findPayoutBand(earned: Date, config: PayoutConfig): PayoutBucket | null {
  const bands = Array.isArray(config.dayOfMonthSchedule) ? config.dayOfMonthSchedule : [];
  const day = earned.getDate();
  return bands.find((b) => day >= b.fromDay && day <= b.toDay) || null;
}

interface PayoutStep {
  label: string;
  date: Date;
}

function resolveTarget(
  earned: Date,
  config: PayoutConfig
): { target: Date; step: PayoutStep } | null {
  if (config.scheduleType === PAYOUT_SCHEDULE_TYPES.PAY_PERIOD_LAG) {
    if (config.periodEndWeekday === null || config.periodEndWeekday === undefined) return null;

    const periodEnd = snapForwardToWeekday(earned, config.periodEndWeekday);
    const firstPayDate =
      config.payDateWeekday === null || config.payDateWeekday === undefined
        ? periodEnd
        : snapForwardToWeekday(periodEnd, config.payDateWeekday);

    const lag = Math.max(1, Number(config.lagPeriods) || 1);

    return {
      target: addDays(firstPayDate, (lag - 1) * 7),
      step: { label: 'Period ends', date: periodEnd },
    };
  }

  if (config.scheduleType === PAYOUT_SCHEDULE_TYPES.DAY_OF_MONTH) {
    const band = findPayoutBand(earned, config);
    if (!band) return null;

    const monthIndex = earned.getMonth() + (Number(band.monthOffset) || 0);
    const year = earned.getFullYear() + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const day = Math.min(band.payDayOfMonth, daysInMonth(year, month));
    const aimed = new Date(year, month, day);

    return {
      target: snapToWeekday(aimed, config.payDateWeekday, config.payDateAdjustment),
      step: { label: 'Target day', date: aimed },
    };
  }

  return null;
}

export function calculateExpectedPayoutDate(
  earnedDate: any,
  config: PayoutConfig | null | undefined
): Date | null {
  if (!config || config.scheduleType === PAYOUT_SCHEDULE_TYPES.NONE) return null;

  const earned = parseEarnedDate(earnedDate);
  if (!earned) return null;

  const resolved = resolveTarget(earned, config);
  if (!resolved) return null;

  let candidate = resolved.target;
  for (let i = 0; i < MAX_GUARD_WEEKS; i += 1) {
    const shifted = shiftOffNonBankingDays(candidate, config);
    if (shifted.getTime() >= earned.getTime()) return shifted;
    candidate = addDays(candidate, 7);
  }
  return shiftOffNonBankingDays(candidate, config);
}

export function explainPayoutDate(
  earnedDate: any,
  config: PayoutConfig | null | undefined
): { earned: Date | null; payDate: Date | null; lag: number | null; step: PayoutStep | null } {
  const earned = parseEarnedDate(earnedDate);
  const payDate = calculateExpectedPayoutDate(earnedDate, config);
  const step = earned && config ? resolveTarget(earned, config)?.step || null : null;

  return {
    earned,
    payDate,
    lag: earned && payDate ? Math.round((payDate.getTime() - earned.getTime()) / 86400000) : null,
    step,
  };
}

export function payoutLagDays(
  earnedDate: any,
  config: PayoutConfig | null | undefined
): number | null {
  return explainPayoutDate(earnedDate, config).lag;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function describePayoutSchedule(config: PayoutConfig | null | undefined): string {
  if (!config || config.scheduleType === PAYOUT_SCHEDULE_TYPES.NONE) {
    return 'No payout schedule configured.';
  }

  const payDay =
    config.payDateWeekday === null || config.payDateWeekday === undefined
      ? 'pay date'
      : WEEKDAY_LABELS[config.payDateWeekday];

  if (config.scheduleType === PAYOUT_SCHEDULE_TYPES.PAY_PERIOD_LAG) {
    if (config.periodEndWeekday === null || config.periodEndWeekday === undefined) {
      return 'No payout schedule configured.';
    }
    const lag = Math.max(1, Number(config.lagPeriods) || 1);
    return `Pay periods end ${WEEKDAY_LABELS[config.periodEndWeekday]}, paid on the ${ordinal(
      lag
    )} ${payDay} after.`;
  }

  const bands = Array.isArray(config.dayOfMonthSchedule) ? config.dayOfMonthSchedule : [];
  if (!bands.length) return 'No payout schedule configured.';
  return `Paid by day of the month across ${bands.length} band${
    bands.length === 1 ? '' : 's'
  }, on the nearest ${payDay}.`;
}

export function resolveEarnedDate(job: any, config: PayoutConfig | null | undefined): any {
  if (!job) return null;
  const field = config?.earnedDateField === 'soldDate' ? 'soldDate' : 'installDate';
  return job[field] ?? null;
}

export function expectedPayoutDateFor(
  job: any,
  config: PayoutConfig | null | undefined
): Date | null {
  return calculateExpectedPayoutDate(resolveEarnedDate(job, config), config);
}
