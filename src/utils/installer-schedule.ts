/**
 * When a job may be opened.
 *
 * Two independent gates decide whether a crew gets into a job, and they answer different
 * questions:
 *
 *   - **this file — WHEN.** Today or any earlier date opens; a future date does not, and
 *     nor does today's job before its arrival window opens. A job the crew isn't due at
 *     yet has nothing for them to do, and starting it would stamp `inProgress` and a
 *     check-in on a visit that hasn't happened.
 *   - `installer-geofence.ts` — **WHERE.** Close enough to the address, or to an office.
 *
 * Both gates guard the START of a visit only. A job already `inProgress` is past them —
 * see `isJobInProgress` in `installer-card-state.ts`.
 *
 * The DATE is compared on the **local calendar day**, not on timestamps, and the window
 * gate is **one-sided**: a job scheduled 8AM today is still today's job at 5PM. The
 * window having *passed* is a matter for `workflowState: 'expired'`, not for locking the
 * crew out; only being **early** refuses. Equally, midnight tonight is already tomorrow.
 *
 * **A manager's bypass switches this whole file off for one job** — either flag of it, not
 * just `earlyStart`; the override means "let this crew in", and it is not the phone's place
 * to hold half of it back (`utils/job-bypass.ts`). It is applied at the bottom, in the two
 * predicates themselves, rather than at each call site, so every consumer — the card's
 * label, the tap's refusal — agrees for free. That agreement is the property that matters:
 * a card offering "Start Appointment" for a tap that then refuses is worse than either gate
 * on its own.
 */

import type { InstallerJob } from '../config/types/installer';
import { isJobBypassActive } from './job-bypass';

const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * True when this job is scheduled for a day after today.
 *
 * A job with no date, or an unparseable one, is NOT treated as future: a data gap must
 * not lock a crew out of work they may well be standing at. The `my-jobs` row is the only
 * source of `leadDate`, and it arrives with an offset (`2026-07-30T09:00:00+05:00`), so
 * parsing lands it in the device's own timezone — which is the crew's, and the right one
 * to compare a working day against.
 *
 * A bypassed job answers false whatever the date says: the override is what decides, and
 * a job dated ahead is the case it is most often filed for — weather moving an install up
 * is one of the reasons in hand, and that job is by definition not today's.
 */
export const isFutureDatedJob = (
  job?: InstallerJob | null,
  now: Date = new Date()
): boolean => {
  if (!job?.leadDate || isJobBypassActive(job)) return false;

  const scheduled = new Date(job.leadDate);
  if (Number.isNaN(scheduled.getTime())) return false;

  return startOfLocalDay(scheduled) > startOfLocalDay(now);
};

// ─────────────────────────────────────────────────────────────────────────────
// Arrival window
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The arrival window as the API writes it — `"8AM – 12NOON ARRIVAL"`,
 * `"12NOON - 4PM ARRIVAL"` — turned into the clock times a customer would say.
 *
 * The raw string is fine on the card, where "ARRIVAL" is the point and the shouted
 * form reads as a badge. It is wrong mid-sentence, which is where the check-in
 * refusal now uses it.
 */
interface WindowEnd {
  /** 1–12. */
  hour12: number;
  minutes: number;
  meridiem: 'AM' | 'PM';
}

/**
 * One end of the window.
 *
 * `NOON` / `MIDNIGHT` are words, not clock times, and the API writes them both bare and
 * with the hour already attached (`12NOON`) — both spellings mean the same instant.
 * Returns null for anything that isn't a time, so the caller can fall back rather than
 * print a half-parsed one.
 */
const parseWindowEnd = (raw: string): WindowEnd | null => {
  // Periods and spaces carry no meaning here: `12 P.M.` is `12PM`.
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

/**
 * `withMeridiem: false` is how a same-half window loses its first AM/PM — `12:00 - 4:00 PM`
 * rather than `12:00 PM - 4:00 PM`, which is how the time is spoken and half the reason
 * the sentence stays short. A window that crosses noon keeps both, because dropping one
 * there would be ambiguous.
 */
const formatWindowEnd = (end: WindowEnd, withMeridiem: boolean): string =>
  `${end.hour12}:${String(end.minutes).padStart(2, '0')}` +
  (withMeridiem ? ` ${end.meridiem}` : '');

/** `-`, either dash, or the word — every separator the field has been seen to use. */
const WINDOW_SEPARATOR = /\s*(?:–|—|-|\bTO\b|\bTHROUGH\b)\s*/;

interface ArrivalWindow {
  /** `12:00 - 4:00 PM`, or `9:00 AM` for a single time. */
  label: string;
  /** False for a lead that carries one time rather than a window ("9am"). */
  isRange: boolean;
  /**
   * The opening time, when it parsed as one — what the "too early" gate compares against.
   * Null for a window whose shape wasn't recognised, which is passed through as a label
   * only and must not be turned into a lockout.
   */
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
    // Parsed as two ends but at least one isn't a time — a range all the same.
    return { label: cleaned, isRange: true, start: null };
  }

  const single = parseWindowEnd(cleaned);
  if (single) {
    return { label: formatWindowEnd(single, true), isRange: false, start: single };
  }

  // An unrecognised shape still says more than no window does, so it goes through in the
  // API's own words rather than being dropped.
  return { label: cleaned, isRange: ends.length > 1, start: null };
};

/** `"12NOON - 4PM ARRIVAL"` → `"12:00 - 4:00 PM"`. Null when there is no usable time. */
export const formatArrivalWindow = (leadTime?: string | null): string | null =>
  describeArrivalWindow(leadTime)?.label ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// Too early
// ─────────────────────────────────────────────────────────────────────────────

/** 12AM → 0, 12PM → 12, everything else the obvious way. */
const to24Hour = (end: WindowEnd): number => {
  if (end.meridiem === 'AM') return end.hour12 === 12 ? 0 : end.hour12;
  return end.hour12 === 12 ? 12 : end.hour12 + 12;
};

/**
 * The instant this job's arrival window opens, on its own calendar day.
 *
 * Built from the job's local calendar day plus the window's start time, NOT from
 * `leadDate`'s own clock component — `leadDate` carries a server-side time
 * (`2026-07-30T09:00:00+05:00`) that has no relationship to the `leadTime` window the
 * customer was actually given.
 *
 * Null whenever either half is missing or unparseable. That is the "don't gate" answer:
 * a data gap must never be the reason a crew can't open work they are standing at.
 */
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

/**
 * True when the crew is trying to start this job BEFORE its arrival window opens.
 *
 * Deliberately one-sided: the window's END is not a gate. A crew running late still has
 * the job to do, and locking them out at 4:01 PM would strand real work — that is what
 * `workflowState: 'expired'` is for, a note that the slot is stale rather than a refusal.
 * So this only stops a 12–4 PM job being opened at 9 AM.
 *
 * Also one-sided about data: no window, no date, or a shape that didn't parse all return
 * false. Only a window we positively understand can refuse a tap.
 *
 * A bypassed job returns false as well — nothing about the clock refuses it.
 */
export const isBeforeArrivalWindow = (
  job?: InstallerJob | null,
  now: Date = new Date()
): boolean => {
  if (isJobBypassActive(job)) return false;

  const start = arrivalWindowStart(job);
  return !!start && now.getTime() < start.getTime();
};

/**
 * The opening time on its own — `"12:00 PM"`.
 *
 * What the early refusal quotes. It names the START, not the window, because that is the
 * one fact the crew can act on; echoing `12:00 - 4:00 PM` would leave them working out
 * which end the refusal meant. Null when there is no parseable start.
 */
export const arrivalWindowStartLabel = (job?: InstallerJob | null): string | null => {
  const start = describeArrivalWindow(job?.leadTime)?.start;
  return start ? formatWindowEnd(start, true) : null;
};

/**
 * What a crew who isn't on site yet is told.
 *
 * The refusal used to answer with distance — "You're 47 m away. Move a bit closer and try
 * again." — which is the gate's own reasoning, not the crew's question. It is also
 * actively misleading at the radius: a fix drifting 25–50 m is routine on a phone beside a
 * two-storey wall, so an installer standing in the driveway was told to walk closer to a
 * house they were already touching. What they actually need to know is that the job opens
 * on arrival, and when its window is.
 *
 * Null when the job carries no arrival window, so the caller keeps its own wording.
 */
export const arrivalWindowMessage = (job?: InstallerJob | null): string | null => {
  const window = describeArrivalWindow(job?.leadTime);
  if (!window) return null;

  return window.isRange
    ? `This job will be available between ${window.label} when you arrive on site.`
    : `This job will be available at ${window.label} when you arrive on site.`;
};
