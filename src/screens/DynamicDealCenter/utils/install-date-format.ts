/**
 * Install-date display format, shared by the job builder and the My Deals edit wizard.
 *
 * The two disagreed on screen: the job builder's "Scheduled Appointment" card read `11/2/2026`
 * while the edit wizard's read `2026-10-27T03:00:00-04:00`. Same card component
 * (`SummaryFinalizeCards`), different data - the job builder keeps `scheduleTime.date` as
 * `M/d/yyyy` while the rep is working and only converts to ISO on submit
 * (`normalizeScheduleTimeForSubmit`), whereas the edit wizard seeds itself from what the SERVER
 * stored, which is that ISO string, and passed it straight through.
 */

/**
 * Format an install date for display as `M/d/yyyy`, whatever shape it arrives in.
 *
 * ⚠️ AN ISO STRING IS PARSED AS TEXT, never through `new Date()`. A timezone offset shifts the
 * calendar day: `2026-10-27T03:00:00-04:00` is the 27th to the customer who booked it, but
 * `new Date(...).getDate()` returns 26 anywhere west of the offset, and this date ends up on a
 * signed agreement. Taking the `yyyy-MM-dd` head keeps the day the server recorded.
 * (Repo rule - see CLAUDE.md § "Data & correctness".)
 *
 * Passes through `TBD` and anything already `M/d/yyyy`; returns '' for empty input, so a caller
 * can treat "no date" and "unparseable" the same way.
 */
export function formatInstallDateForDisplay(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw === 'TBD') return 'TBD';

  // Already M/d/yyyy (or MM/dd/yyyy) - normalise away any leading zeros and keep it.
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    return `${Number(mm)}/${Number(dd)}/${yyyy}`;
  }

  // ISO (with or without a time part): take the date head as TEXT.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return `${Number(mm)}/${Number(dd)}/${yyyy}`;
  }

  // Unrecognised: hand it back untouched rather than inventing a date.
  return raw;
}

/** True when the value means "no date picked yet". */
export const isTbdInstallDate = (value: string | null | undefined): boolean =>
  String(value ?? '').trim() === 'TBD';
