import { useEffect, useMemo, useState } from 'react';
import { useIsOnline } from './useIsOnline';
import {
  fetchInstallAvailability,
  InstallAvailability,
  InstallAvailabilityWindow,
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
  }, [active, ymd, leadId]);

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
