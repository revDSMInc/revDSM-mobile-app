import type { InstallerJob } from '../config/types/installer';
import { isJobBypassActive } from './job-bypass';

const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export const isFutureDatedJob = (
  job?: InstallerJob | null,
  now: Date = new Date()
): boolean => {
  if (!job?.leadDate || isJobBypassActive(job)) return false;

  const scheduled = new Date(job.leadDate);
  if (Number.isNaN(scheduled.getTime())) return false;

  return startOfLocalDay(scheduled) > startOfLocalDay(now);
};

interface WindowEnd {
  hour12: number;
  minutes: number;
  meridiem: 'AM' | 'PM';
}

const parseWindowEnd = (raw: string): WindowEnd | null => {
  const token = raw.toUpperCase().replace(/[.\s]/g, '');
  if (/^(12)?NOON$/.test(token)) return { hour12: 12, minutes: 0, meridiem: 'PM' };
  if (/^(12)?MIDNIGHT$/.test(token)) return { hour12: 12, minutes: 0, meridiem: 'AM' };

  const parts = token.match(/^(\d{1,2})(?::?(\d{2}))?(AM|PM)$/);
  if (!parts) return null;

  const hour12 = Number(parts[1]);
  const minutes = parts[2] ? Number(parts[2]) : 0;
  if (hour12 < 1 || hour12 > 12 || minutes > 59) return null;

  return { hour12, minutes, meridiem: parts[3] as 'AM' | 'PM' };
};

const formatWindowEnd = (end: WindowEnd, withMeridiem: boolean): string =>
  `${end.hour12}:${String(end.minutes).padStart(2, '0')}` +
  (withMeridiem ? ` ${end.meridiem}` : '');

const WINDOW_SEPARATOR = /\s*(?:–|—|-|\bTO\b|\bTHROUGH\b)\s*/;

interface ArrivalWindow {
  label: string;
  isRange: boolean;
  start: WindowEnd | null;
}

const describeArrivalWindow = (leadTime?: string | null): ArrivalWindow | null => {
  if (typeof leadTime !== 'string') return null;

  const cleaned = leadTime.replace(/ARRIVAL/gi, '').trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;

  const ends = cleaned.toUpperCase().split(WINDOW_SEPARATOR).filter(Boolean);
  if (ends.length === 2) {
    const start = parseWindowEnd(ends[0]);
    const end = parseWindowEnd(ends[1]);
    if (start && end) {
      const sameHalf = start.meridiem === end.meridiem;
      return {
        label: `${formatWindowEnd(start, !sameHalf)} - ${formatWindowEnd(end, true)}`,
        isRange: true,
        start,
      };
    }
    return { label: cleaned, isRange: true, start: null };
  }

  const single = parseWindowEnd(cleaned);
  if (single) {
    return { label: formatWindowEnd(single, true), isRange: false, start: single };
  }

  return { label: cleaned, isRange: ends.length > 1, start: null };
};

export const formatArrivalWindow = (leadTime?: string | null): string | null =>
  describeArrivalWindow(leadTime)?.label ?? null;

const to24Hour = (end: WindowEnd): number => {
  if (end.meridiem === 'AM') return end.hour12 === 12 ? 0 : end.hour12;
  return end.hour12 === 12 ? 12 : end.hour12 + 12;
};

export const arrivalWindowStart = (job?: InstallerJob | null): Date | null => {
  const start = describeArrivalWindow(job?.leadTime)?.start;
  if (!start || !job?.leadDate) return null;

  const scheduled = new Date(job.leadDate);
  if (Number.isNaN(scheduled.getTime())) return null;

  return new Date(
    scheduled.getFullYear(),
    scheduled.getMonth(),
    scheduled.getDate(),
    to24Hour(start),
    start.minutes,
    0,
    0
  );
};

export const isBeforeArrivalWindow = (
  job?: InstallerJob | null,
  now: Date = new Date()
): boolean => {
  if (isJobBypassActive(job)) return false;

  const start = arrivalWindowStart(job);
  return !!start && now.getTime() < start.getTime();
};

export const arrivalWindowStartLabel = (job?: InstallerJob | null): string | null => {
  const start = describeArrivalWindow(job?.leadTime)?.start;
  return start ? formatWindowEnd(start, true) : null;
};

export const arrivalWindowMessage = (job?: InstallerJob | null): string | null => {
  const window = describeArrivalWindow(job?.leadTime);
  if (!window) return null;

  return window.isRange
    ? `This job will be available between ${window.label} when you arrive on site.`
    : `This job will be available at ${window.label} when you arrive on site.`;
};
