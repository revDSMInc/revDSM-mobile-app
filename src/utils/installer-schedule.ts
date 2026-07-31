/**
 * When a job may be opened.
 *
 * Two independent gates decide whether a crew gets into a job, and they answer different
 * questions:
 *
 *   - **this file — WHEN.** Today or any earlier date opens; a future date does not. A
 *     job the crew isn't due at yet has nothing for them to do, and starting it would
 *     stamp `inProgress` and a check-in on a visit that hasn't happened.
 *   - `installer-geofence.ts` — **WHERE.** Close enough to the address, or to an office.
 *
 * Compared on the **local calendar day**, not on timestamps. A job scheduled 8AM today is
 * still today's job at 5PM — the window having passed is a matter for `workflowState:
 * 'expired'`, not for locking the crew out. Equally, midnight tonight is already tomorrow.
 */

import type { InstallerJob } from '../config/types/installer';

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
 */
export const isFutureDatedJob = (
  job?: InstallerJob | null,
  now: Date = new Date()
): boolean => {
  if (!job?.leadDate) return false;

  const scheduled = new Date(job.leadDate);
  if (Number.isNaN(scheduled.getTime())) return false;

  return startOfLocalDay(scheduled) > startOfLocalDay(now);
};
