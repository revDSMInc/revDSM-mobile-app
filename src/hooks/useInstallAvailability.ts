import { useEffect, useMemo, useRef, useState } from 'react';
import { endOfMonth, format, startOfMonth, startOfToday } from 'date-fns';
import { useIsOnline } from './useIsOnline';
import {
  fetchInstallAvailability,
  fetchInstallCalendarAvailability,
  InstallAvailability,
  InstallAvailabilityWindow,
  InstallCalendarAvailability,
} from '../services/api/installAvailability';

export interface BookableWindow {
  /** The text booking stores, e.g. "8:00 AM - 12:00 PM". */
  value: string;
}

export interface WindowNotice {
  tone: 'ok' | 'warn';
  text: string;
}

const clock = (hhmm?: string | null): string => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

export function windowNotice(info: InstallAvailabilityWindow | null): WindowNotice | null {
  if (!info) return null;
  if (!info.available) {
    const over = info.overflow;
    return {
      tone: 'warn',
      text: over
        ? `Not enough time for ${over.crewName || 'this crew'} — arrives about ${clock(over.arrivalTime)}, ${over.overByMins} min past the cutoff for this window.`
        : 'No crew is available for this window.',
    };
  }
  return {
    tone: 'ok',
    text: `${info.crewName || 'A crew'} can arrive around ${clock(info.arrivalTime)}.`,
  };
}

/**
 * Asks the scheduler about one day while `enabled` and online. `availability` stays null until it
 * answers — and for good if it never does, which callers treat as "no rules".
 */
export function useInstallAvailability(
  ymd: string | null,
  leadId: string | undefined,
  enabled: boolean,
  /** Bump to ask again for the same day (e.g. after a time was taken). */
  refreshKey = 0,
) {
  const online = useIsOnline();
  const [availability, setAvailability] = useState<InstallAvailability | null>(null);
  const [loading, setLoading] = useState(false);

  // Offline (or on a failing line) the scheduler cannot answer, so do not ask: no request, no
  // spinner, and `availability` stays null, which every caller already treats as "no rules".
  const active = enabled && online;

  useEffect(() => {
    if (!active || !ymd) {
      setAvailability(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setAvailability(null);
    setLoading(true);
    fetchInstallAvailability({ date: ymd, leadId }).then((result) => {
      if (cancelled) return;
      setAvailability(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active, ymd, leadId, refreshKey]);

  return { availability, loading };
}

/**
 * The windows to offer: everyone sees what the scheduler says is bookable, and only a
 * manager (who may override) also sees the ones that do not fit — flagged by the notice.
 */
export function offeredWindows<T extends BookableWindow>(
  all: T[],
  availability: InstallAvailability | null,
): T[] {
  if (!availability?.enforced || availability.canOverride) return all;
  return all.filter((window) => {
    const info = availability.windows.find((w) => w.label === window.value);
    return info ? info.available : true;
  });
}

export function windowInfo(
  window: BookableWindow | undefined,
  availability: InstallAvailability | null,
): InstallAvailabilityWindow | null {
  if (!window || !availability?.enforced) return null;
  return availability.windows.find((w) => w.label === window.value) || null;
}

export function useOfferedWindows<T extends BookableWindow>(
  all: T[],
  availability: InstallAvailability | null,
): T[] {
  return useMemo(() => offeredWindows(all, availability), [all, availability]);
}

/**
 * The days to dull out: those where no crew can take the job. A manager can book over a
 * full day (Step 3), so for them nothing is dimmed.
 */
export function blockedDates(calendar: InstallCalendarAvailability | null): Set<string> {
  if (!calendar?.enforced || calendar.canOverride) return new Set();
  return new Set(calendar.days.filter((day) => !day.available).map((day) => day.date));
}

/**
 * Asks the scheduler which days of `month` are bookable while `enabled`. Months already
 * answered are kept, so paging back and forth costs nothing. `blocked` stays empty until
 * it answers, and for good if it never does, which callers treat as "dim nothing".
 */
export function useInstallCalendarAvailability(
  month: Date,
  leadId: string | undefined,
  enabled: boolean,
  refreshKey = 0,
) {
  const [byMonth, setByMonth] = useState<Record<string, InstallCalendarAvailability | null>>({});
  const asked = useRef(new Set<string>());
  const monthKey = format(month, 'yyyy-MM');
  const cacheKey = `${leadId || ''}|${monthKey}|${refreshKey}`;

  useEffect(() => {
    if (!enabled || asked.current.has(cacheKey)) return undefined;
    asked.current.add(cacheKey);
    let cancelled = false;
    const today = startOfToday();
    const first = startOfMonth(month) < today ? today : startOfMonth(month);
    const last = endOfMonth(month);
    if (last < today) return undefined;
    fetchInstallCalendarAvailability({
      startDate: format(first, 'yyyy-MM-dd'),
      endDate: format(last, 'yyyy-MM-dd'),
      leadId,
    }).then((result) => {
      if (cancelled) return;
      if (!result) asked.current.delete(cacheKey); // try again next time it is shown
      setByMonth((prev) => ({ ...prev, [cacheKey]: result }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey]);

  const blocked = useMemo(() => blockedDates(byMonth[cacheKey] ?? null), [byMonth, cacheKey]);
  return { blocked };
}
