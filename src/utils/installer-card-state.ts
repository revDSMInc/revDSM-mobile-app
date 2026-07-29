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

/** Web `CARD_COLORS`, verbatim. */
export const JOB_CARD_COLORS = {
  /** Start Appointment — the visit hasn't begun. */
  ACTIVE: '#ff6b35',
  /** Resume Appointment — already checked in once. */
  PROGRESS: '#6fcf97',
  /** Review Appointment — read-only revisit. */
  OFFSITE: '#9e9e9e',
  /** Preview Appointment — not actionable yet (tomorrow's schedule). */
  UPCOMING: '#2196f3',
  /** Resulted — the visit is over. */
  RESULTED: '#9e9e9e',
  /**
   * Expired — the arrival window passed unworked. Red rather than web's neutral grey:
   * this is the one state on the schedule that needs dispatch's attention, and grey
   * reads as "finished, nothing to do" beside a resulted card.
   */
  EXPIRED: '#d32f2f',
} as const;

export type JobCardStateKey = keyof typeof JOB_CARD_COLORS;

export interface JobCardState {
  key: JobCardStateKey;
  /** Border, action button, and the 10 %-alpha card wash. */
  color: string;
  /** Bottom action button text. */
  actionLabel: string;
  /**
   * Web paints a 6 px bar down the left edge for the two live states
   * (`boxShadow: '-6px 0 0 0 color'`). RN has no such shadow, so the card renders it
   * as a real 6 px view — same look, and this flag says when.
   */
  accentBar: boolean;
  /**
   * Whether tapping may open the job at all.
   *
   * False for `expired`. The card stays tappable so the tap can EXPLAIN itself
   * (`blockedReason`) — a dead card teaches an installer nothing, and "my phone won't
   * open the job" is the kind of thing that turns into a phone call to dispatch.
   */
  openable: boolean;
  /** Why it won't open, shown on the card and again if it's tapped. Set iff `!openable`. */
  blockedReason?: string;
}

/**
 * `workflowState` → label + color.
 *
 * `installer/v1/my-jobs` sends three values today — **`start`, `resume`, `expired`** —
 * and only the first two may open the job. `review` and `preview` are kept because the
 * sales side of the same backend uses them and the tomorrow tab renders `preview`;
 * neither is currently sent for an installer job.
 */
const BY_WORKFLOW_STATE: Record<string, JobCardState> = {
  start: {
    key: 'ACTIVE',
    color: JOB_CARD_COLORS.ACTIVE,
    actionLabel: 'Start Appointment',
    accentBar: true,
    openable: true,
  },
  resume: {
    key: 'PROGRESS',
    color: JOB_CARD_COLORS.PROGRESS,
    actionLabel: 'Resume Appointment',
    accentBar: true,
    openable: true,
  },
  /**
   * The arrival window has passed without the job being worked. Not openable: checking
   * in now would stamp a work session against a slot the crew never attended, and the
   * install has to be rescheduled by dispatch rather than picked up late from the phone.
   */
  expired: {
    key: 'EXPIRED',
    color: JOB_CARD_COLORS.EXPIRED,
    actionLabel: 'Appointment Expired',
    accentBar: false,
    openable: false,
    blockedReason:
      'This appointment window has passed, so the job can no longer be opened. Contact your Install Manager to have it rescheduled.',
  },
  review: {
    key: 'OFFSITE',
    color: JOB_CARD_COLORS.OFFSITE,
    actionLabel: 'Review Appointment',
    accentBar: false,
    openable: true,
  },
  preview: {
    key: 'UPCOMING',
    color: JOB_CARD_COLORS.UPCOMING,
    actionLabel: 'Preview Appointment',
    accentBar: false,
    openable: true,
  },
};

export interface JobCardStateOptions {
  /** Tomorrow's tab — preview-only regardless of what the job's own state says. */
  isTomorrow?: boolean;
  /** The card is waiting on the check-in request. */
  loading?: boolean;
}

/**
 * The card's presentation for one job.
 *
 * Precedence: **resulted → tomorrow → `workflowState`**. Resulted wins outright because
 * the visit is over whatever the workflow says, and the tomorrow tab is a preview of
 * jobs whose `workflowState` is still `start` — showing them as actionable would invite
 * a crew to open tomorrow's work today.
 */
export const resolveJobCardState = (
  job: InstallerJob,
  { isTomorrow = false, loading = false }: JobCardStateOptions = {}
): JobCardState => {
  if (loading) {
    // Mid-check-in. Keep the card's own accent so it doesn't flash a different colour
    // while the request is in flight; only the label changes.
    const base = resolveJobCardState(job, { isTomorrow });
    return { ...base, actionLabel: 'Starting Job…' };
  }

  if (job.resulted) {
    return {
      key: 'RESULTED',
      color: JOB_CARD_COLORS.RESULTED,
      actionLabel: 'Review Appointment',
      accentBar: false,
      openable: true,
    };
  }

  if (isTomorrow) {
    return {
      key: 'UPCOMING',
      color: JOB_CARD_COLORS.UPCOMING,
      actionLabel: 'Preview Appointment',
      accentBar: false,
      openable: true,
    };
  }

  const state = job.workflowState ? BY_WORKFLOW_STATE[job.workflowState] : undefined;
  // An unrecognised or missing value falls back to `start` rather than to `resume`:
  // offering to *start* a job already underway is a harmless extra check-in, while
  // offering to *resume* one never begun would skip the start the crew expects. It
  // must NOT fall back to `expired` either — an unknown state locking a crew out of a
  // job they are standing at is the worst outcome of the three.
  return state ?? BY_WORKFLOW_STATE.start;
};
