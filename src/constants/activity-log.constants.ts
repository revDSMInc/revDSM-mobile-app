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
  PREVIEW: 'preview',
  SEND: 'send',
  RESET: 'reset',
  APPLY: 'apply',
} as const;

export type LogAction = (typeof LOG_ACTIONS)[keyof typeof LOG_ACTIONS];

/**
 * Installer-module surfaces.
 *
 * ⚠️ Confirm these against the portal's module vocabulary before release — the sales
 * modules below them are verified, the installer ones are new with this module.
 */
export const INSTALLER_MODULES = {
  /** The installer's own schedule (not lead-scoped — see `ExcludedModuleTypes`). */
  DASHBOARD: 'installer_dashboard',
  /** One job: opening it, contacting the customer, reference cards, ops chat. */
  JOB: 'installer_job',
  /** Timeline step open / complete. */
  STEP: 'installer_step',
  /** Material pickup & return photos. */
  MATERIAL: 'installer_material',
  /** Pre-existing conditions. */
  PEC: 'installer_pec',
  /** Pre / post install ghost-match photos. */
  PHOTOS: 'installer_photos',
  /** Sold-scope verification. */
  SCOPE: 'installer_scope',
  /** A scope discrepancy routed to the Install Manager. */
  DISCREPANCY: 'installer_discrepancy',
  /** Certificate of Completion scan. */
  COC: 'installer_coc',
  /** Can't Do Work / Reset / Not Hit. */
  RESULT: 'installer_result',
} as const;

export type InstallerModule = (typeof INSTALLER_MODULES)[keyof typeof INSTALLER_MODULES];

/** Auth / session events. Excluded from lead auto-attach. */
export const SYSTEM_MODULE = 'system';
