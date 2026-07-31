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
  /** Preview Appointment — not actionable yet (the Upcoming tab). */
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

export interface JobCardStateOptions {
  /** The Upcoming tab — preview-only regardless of what the job's own state says. */
  isUpcoming?: boolean;
  /** The card is waiting on the check-in request. */
  loading?: boolean;
}

/**
 * The card's presentation for one job.
 *
 * Precedence: **resulted → upcoming → `workflowState`**. Resulted wins outright because
 * the visit is over whatever the workflow says, and the Upcoming tab is a preview of
 * jobs whose `workflowState` is still `start` — showing them as actionable would invite
 * a crew to open future work today.
 */
export const resolveJobCardState = (
  job: InstallerJob,
  { isUpcoming = false, loading = false }: JobCardStateOptions = {}
): JobCardState => {
  if (loading) {
    // Mid-request. Keep the card's own accent so it doesn't flash a different colour
    // while it is in flight; only the label changes. A resulted or upcoming card is
    // FETCHING, not starting — those open read-only, and "Starting Job…" would claim
    // a finished visit is being reopened.
    const base = resolveJobCardState(job, { isUpcoming });
    return {
      ...base,
      actionLabelKey:
        job.resulted || isUpcoming ? 'common.loading' : 'installer.startingJob',
    };
  }

  if (job.resulted) {
    // "Completed", not "Review Appointment": the card already reads RESULTED, and an
    // action-shaped label invited the crew to treat a finished visit as outstanding
    // work. The tap still opens the job read-only — the label reports its state.
    return {
      key: 'RESULTED',
      color: JOB_CARD_COLORS.RESULTED,
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
  return state ?? BY_WORKFLOW_STATE.start;
};
