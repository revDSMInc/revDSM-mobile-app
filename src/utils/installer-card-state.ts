/**
 * Installer job card — action label + colors, driven by `workflowState`.
 *
 * Ports the web card's state machine (`sections/map/utils/job-card-utils.js` →
 * `CARD_COLORS` / `getJobStatus`) so a job reads the same on both platforms.
 *
 * **Where mobile deliberately differs from web.** The web derives its state from GPS
 * range and the appointment time window, and treats `workflowState` as a single
 * boolean (`=== 'resume'`) — which is why a `workflowState: 'start'` from the API hits
 * no branch there at all. Mobile reads the field directly, as the API means it: the
 * backend has already decided whether this visit is a start, a resume or a review, and
 * re-deriving that on the phone would just be a second opinion that can disagree.
 * Being on site is enforced separately, at the tap, by `installer-geofence.ts`.
 */

import type { InstallerJob } from '../config/types/installer';
import type { TranslationKey } from '../i18n/translations';

/** Web `CARD_COLORS`, verbatim. */
export const JOB_CARD_COLORS = {
  /** Start Appointment — the visit hasn't begun. */
  ACTIVE: '#ff6b35',
  /** Resume Appointment — already checked in once. */
  PROGRESS: '#6fcf97',
  /** Review Appointment — read-only revisit. */
  OFFSITE: '#9e9e9e',
  /**
   * Preview Appointment — readable but not actionable from here. Two ways in: the
   * Upcoming tab (not due yet) and an off-site device fix (not there yet).
   */
  UPCOMING: '#2196f3',
  /** Resulted — the visit is over. Web's neutral grey. */
  RESULTED: '#9e9e9e',
  /**
   * Expired — the arrival window passed, but the job still opens and works normally.
   *
   * A DARKER, cooler grey than `RESULTED` on purpose. Both states are grey, and at
   * arm's length in sunlight two identical greys would make an expired job (still to be
   * done) indistinguishable from a resulted one (finished) — the one comparison on this
   * screen where being wrong costs a wasted drive. The rest of the card separates them
   * too: resulted is washed out at 85 % opacity behind a RESULTED chip, expired is at
   * full strength.
   */
  EXPIRED: '#64748b',
} as const;

export type JobCardStateKey = keyof typeof JOB_CARD_COLORS;

export interface JobCardState {
  key: JobCardStateKey;
  /** Border, action button, and the 10 %-alpha card wash. */
  color: string;
  /**
   * Translation key for the bottom action button — NOT the text.
   *
   * A pure function can't read the language context, and threading `t` through it would
   * make every caller carry a hook's output into a helper that has no other reason to
   * know about React. So the state machine names the string and the card renders it.
   */
  actionLabelKey: TranslationKey;
  /**
   * Literal button text, when the label comes from the API rather than from the phrase
   * book — a resulted job reports its own outcome (`CantDoWork|Resulted`), and those
   * values are open-ended, so there is no translation key to name.
   *
   * Wins over `actionLabelKey` when set. `actionLabelKey` is still filled in as the
   * fallback for a job whose outcome fields are missing.
   */
  actionLabel?: string;
  /**
   * Web paints a 6 px bar down the left edge for the two live states
   * (`boxShadow: '-6px 0 0 0 color'`). RN has no such shadow, so the card renders it
   * as a real 6 px view — same look, and this flag says when.
   */
  accentBar: boolean;
}

/**
 * `workflowState` → label + color.
 *
 * `installer/v1/my-jobs` sends three values today — **`start`, `resume`, `expired`** —
 * and every one of them opens the job. `review` and `preview` are kept because the
 * sales side of the same backend uses them and the Upcoming tab renders `preview`;
 * neither is currently sent for an installer job.
 */
const BY_WORKFLOW_STATE: Record<string, JobCardState> = {
  start: {
    key: 'ACTIVE',
    color: JOB_CARD_COLORS.ACTIVE,
    actionLabelKey: 'installer.startAppointment',
    accentBar: true,
  },
  resume: {
    key: 'PROGRESS',
    color: JOB_CARD_COLORS.PROGRESS,
    actionLabelKey: 'installer.resumeAppointment',
    accentBar: true,
  },
  /**
   * The arrival window has passed. The job still opens and works exactly like any
   * other — the grey is a note that the slot is stale, not a lock.
   */
  expired: {
    key: 'EXPIRED',
    color: JOB_CARD_COLORS.EXPIRED,
    actionLabelKey: 'installer.appointmentExpired',
    accentBar: false,
  },
  review: {
    key: 'OFFSITE',
    color: JOB_CARD_COLORS.OFFSITE,
    actionLabelKey: 'installer.reviewAppointment',
    accentBar: false,
  },
  preview: {
    key: 'UPCOMING',
    color: JOB_CARD_COLORS.UPCOMING,
    actionLabelKey: 'installer.previewAppointment',
    accentBar: false,
  },
};

/**
 * A wire status → the words an installer reads.
 *
 *   `cantDoWork` → `Cant Do Work`
 *   `notHit`     → `Not Hit`
 *   `reset`      → `Reset`
 *
 * Derived rather than looked up in a table: the backend's own naming already carries the
 * word boundaries, so splitting on them means a result action added server-side reads
 * correctly with no mobile release. Handles camelCase, PascalCase (`CantDoWork`, if the
 * API ever capitalises it), and snake/kebab separators.
 */
export const humanizeStatus = (value: string): string =>
  value
    .trim()
    // `tDo` → `t Do`
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // `HOAIssue` → `HOA Issue`, so an acronym doesn't get split letter by letter.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * The outcome of a resulted job: **`Resulted - {status}`** — `Resulted - Cant Do Work`,
 * `Resulted - Not Hit`, `Resulted - Reset`.
 *
 * Same shape as the sales LeadCard's resulted bar (`Resulted — Sale`), so a resulted job
 * reads the same on both cards. The status is derived from the wire value by
 * `humanizeStatus` rather than mapped to a fixed phrase, so a new result action on the
 * backend needs no mobile release; `workflowState` is not appended, because on a resulted
 * job it only ever says `resulted` — which is exactly what the prefix already says.
 *
 * A resulted card used to read "Completed Appointment" whatever the outcome was, which
 * is wrong the moment the outcome is anything but completion: a job the crew could NOT
 * do reported itself as finished work.
 *
 * Returns null when there is nothing to name; the caller falls back to the phrase book.
 */
export const resultedActionLabel = (job: InstallerJob): string | null => {
  // A job that WAS completed is the one case the phrase book says better than the raw
  // status does: "Completed Appointment" reads as finished work, "Resulted - Completed"
  // reads as a status dump. Returning null hands it back to
  // `installer.completedAppointment`, which also keeps it translated.
  if (typeof job.status === 'string' && job.status.trim().toLowerCase() === 'completed') {
    return null;
  }

  // `status` is the outcome; `workflowState` is the fallback for a job that carries only
  // that. Whichever answers, it is the thing the prefix is qualifying.
  const raw = [job.status, job.workflowState]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .find(Boolean);

  if (!raw) return null;

  const outcome = humanizeStatus(raw);
  // Nothing to qualify — "Resulted - Resulted" is noise, so the prefix stands alone.
  return outcome.toLowerCase() === 'resulted' ? 'Resulted' : `Resulted - ${outcome}`;
};

export interface JobCardStateOptions {
  /** The Upcoming tab — preview-only regardless of what the job's own state says. */
  isUpcoming?: boolean;
  /** The card is waiting on the check-in request. */
  loading?: boolean;
  /**
   * A device fix exists and it matches NEITHER the job's coordinates NOR any company
   * office. The card then renders as the light-blue UPCOMING preview.
   *
   * Must be false while the position is unknown (no fix yet, permission refused), not
   * true: an unresolved location is not evidence of being somewhere else.
   */
  offSite?: boolean;
}

/**
 * The card's presentation for one job.
 *
 * Precedence: **resulted → upcoming → off-site → `workflowState`**. Resulted wins
 * outright because the visit is over whatever the workflow says, and the Upcoming tab is
 * a preview of jobs whose `workflowState` is still `start` — showing them as actionable
 * would invite a crew to open future work today.
 */
export const resolveJobCardState = (
  job: InstallerJob,
  { isUpcoming = false, loading = false, offSite = false }: JobCardStateOptions = {}
): JobCardState => {
  if (loading) {
    // Mid-request. Keep the card's own accent so it doesn't flash a different colour
    // while it is in flight; only the label changes. A resulted or upcoming card is
    // FETCHING, not starting — those open read-only, and "Starting Job…" would claim
    // a finished visit is being reopened.
    const base = resolveJobCardState(job, { isUpcoming, offSite });
    return {
      ...base,
      // Cleared, not just overridden: a literal `actionLabel` outranks the key, so
      // leaving a resulted job's outcome text in place would hide the spinner label.
      actionLabel: undefined,
      actionLabelKey:
        job.resulted || isUpcoming ? 'common.loading' : 'installer.startingJob',
    };
  }

  if (job.resulted) {
    // Not an action-shaped label: the visit is over, and inviting the crew to treat it
    // as outstanding work was the original bug here. What it reports is the OUTCOME —
    // `CantDoWork|Resulted` — because "Completed Appointment" is a lie on a job that
    // could not be done. The tap still opens the job read-only.
    return {
      key: 'RESULTED',
      color: JOB_CARD_COLORS.RESULTED,
      actionLabel: resultedActionLabel(job) ?? undefined,
      actionLabelKey: 'installer.completedAppointment',
      accentBar: false,
    };
  }

  if (isUpcoming) {
    return {
      key: 'UPCOMING',
      color: JOB_CARD_COLORS.UPCOMING,
      actionLabelKey: 'installer.previewAppointment',
      accentBar: false,
    };
  }

  const state = job.workflowState ? BY_WORKFLOW_STATE[job.workflowState] : undefined;
  // An unrecognised or missing value falls back to `start` rather than to `resume`:
  // offering to *start* a job already underway is a harmless extra check-in, while
  // offering to *resume* one never begun would skip the start the crew expects.
  const resolved = state ?? BY_WORKFLOW_STATE.start;

  if (offSite) {
    // The installer is not at the address and not at an office, so the check-in at the
    // end of this tap would be refused — the card must not promise to start a visit it
    // cannot start.
    //
    // Presented exactly like the Upcoming tab's preview: the same light blue, the same
    // label, no accent bar. Both say the same thing — this job is readable but not
    // actionable from here — so they should not look like two different states. It
    // reverts to the workflow colour the moment the crew arrives.
    return {
      key: 'UPCOMING',
      color: JOB_CARD_COLORS.UPCOMING,
      actionLabelKey: 'installer.previewAppointment',
      accentBar: false,
    };
  }

  return resolved;
};
