/**
 * Activity-log vocabulary — `action_type` and `module_type` values accepted by
 * `POST /user-activity-log/v1/create` and rendered by the portal timeline.
 *
 * The portal labels a row from the pair (action_type, module_type). A value it does
 * not know still POSTs 201 but renders as an unlabeled row, so new events should reuse
 * an existing verb from `LOG_ACTIONS` and only introduce a module when a genuinely new
 * surface appears.
 *
 * Verbs below are the ones already in use across the sales app (see
 * `src/utils/activity-log/*` and `src/utils/lead-activity-log.ts`).
 */

export const LOG_ACTIONS = {
  /** A surface was opened / rendered. */
  VIEW: 'view',
  /** A modal or overlay was opened. */
  OPEN: 'open',
  CLOSE: 'close',
  CLICK: 'click',
  SELECT: 'select',
  TOGGLE: 'toggle',
  NAVIGATE: 'navigate',
  /** Something new was attached (a photo, a page, a row). */
  ADD: 'add',
  CREATE: 'create',
  UPDATE: 'update',
  /** A field value changed. */
  CHANGE: 'change',
  DELETE: 'delete',
  /** A form / step was committed. */
  SUBMIT: 'submit',
  SAVE: 'save',
  START: 'start',
  /** Left a session without finishing it — e.g. backing out of a job. */
  PAUSE: 'pause',
  PREVIEW: 'preview',
  SEND: 'send',
  RESET: 'reset',
  APPLY: 'apply',
} as const;

export type LogAction = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS];

/**
 * Installer-module surfaces.
 *
 * The job-session trio mirrors how the sales side splits a lead visit
 * (`lead_check_in` / `lead_resume` / `lead_check_out`): the first open of a job is a
 * check-in, backing out pauses the session, and coming back is a resume. Everything
 * inside the timeline is logged under the step it happened in — see
 * `INSTALLER_STEP_MODULES` — so the portal can group a job's activity by step.
 */
export const INSTALLER_MODULES = {
  /** The installer's own schedule (not lead-scoped — see `ExcludedModuleTypes`). */
  DASHBOARD: 'installer_dashboard',
  /** First time this job is opened. */
  JOB_CHECK_IN: 'job_check_in',
  /** Backing out of the job detail screen — the session is paused, not finished. */
  JOB_SESSION: 'job_session',
  /** Re-opening a job that has been opened before. */
  JOB_RESUME: 'job_resume',
  /** Job-level actions that belong to no single step: address, packet, ops chat… */
  JOB: 'installer_job',
  /** Can't Do Work / Reset / Not Hit. */
  RESULT: 'installer_result',
} as const;

export type InstallerModule = (typeof INSTALLER_MODULES)[keyof typeof INSTALLER_MODULES];

/**
 * Timeline step → `module_type`.
 *
 * Anything that happens inside a step — opening it, a photo added or removed, a
 * selection, completing it — is logged under the step's own name rather than a
 * generic "installer_step", so a portal filter by module reads as the install
 * timeline itself.
 */
export const INSTALLER_STEP_MODULES = {
  pickup: 'pickup',
  pec: 'pre_existing_conditions',
  pre: 'pre_install_photos',
  measure: 'verify_jobs',
  post: 'post_install_photos',
  coc: 'coc',
  return: 'return',
} as const;

export type InstallerStepModule =
  (typeof INSTALLER_STEP_MODULES)[keyof typeof INSTALLER_STEP_MODULES];

/** Auth / session events. Excluded from lead auto-attach. */
export const SYSTEM_MODULE = 'system';
