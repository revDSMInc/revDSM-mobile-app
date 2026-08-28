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

/**
 * Investment Center — the in-home presentation surface. A NEW grouped category for
 * the Forever Record: entering the center, viewing each priced calculator, opting IN
 * to / OUT of the In-Home Pre-Order vs 1-Year programs, financing-plan add/remove,
 * payment-method selection, and down-payment edits. First introduced on mobile (no
 * web counterpart yet), so all of its events share this one module so a portal filter
 * reads as the presentation's own audit trail — see
 * `src/utils/activity-log/investment-center-log.ts`.
 */
export const INVESTMENT_CENTER_MODULE = 'investment_center';

/**
 * Funding — how the contract actually gets paid, and how far each payment has got.
 *
 * A NEW grouped category for the Forever Record covering the Result Lead sheet's
 * pricing panel (the payment rows) and the Funding screen behind it: the structure
 * (down payment + balance vs upfront), every row added / removed / given a method,
 * the save that files them, and then each payment's own life cycle — link sent,
 * card on file, charged, check collected, lender decision, loan activated — through
 * to the submit.
 *
 * Its own module rather than `calculator` / `job_builder` because this is the only
 * place in the app where **money moves** (`POST …/charge`) and where a third party
 * (a processor, a lender) decides the outcome. A portal filter on `funding` should
 * read as the money trail for a job and nothing else — see
 * `src/utils/activity-log/funding-log.ts`.
 *
 * First introduced on mobile (the web funding screen does not log yet), so the
 * vocabulary is defined here.
 */
/**
 * Result Lead — the sheet a rep results a job from, up to and including **Confirm**.
 *
 * ONE module for everything that happens on that screen: the sheet opening, the
 * web-parity field rows (One Leg, Result, contract price, the payment-method
 * scalars — see `useOutcomeLogging`), the payment structure choice, every payment
 * line added / removed / given a method, and the Confirm that ends it.
 *
 * ⚠️ **It ends at Confirm, and `funding` begins there.** Before the rep confirms,
 * the split is an unsaved local draft and nothing has been asked of a processor or
 * a lender; after it, `PUT …/funding` has filed the rows and every subsequent row is
 * about money actually moving. Splitting the two there is what lets a portal filter
 * answer "how was this job resulted?" separately from "how did the money come in?" —
 * previously the two were interleaved under `funding`.
 *
 * ⚠️ The module follows the SCREEN, not the deal's history: **Edit payments** returns
 * to the pricing panel, so a re-price after a lender decision fires
 * `result_lead_opened` again and files its edits here, not under `funding`.
 *
 * ⚠️ This is the Result Lead SHEET only. `DynamicDealEditScreen`'s Job Price step
 * renders the same pricing components inside the My Deals wizard and deliberately
 * keeps logging to `funding`: it is a different screen and is not a Result Lead.
 *
 * ⚠️ Distinct from `lead_result_field_entry`, the module the CLASSIC Outcome modal
 * and the Lead Center Result Lead modal still emit into byte-identically to web.
 * Only the DYNAMIC sheet opts in to this one — see `useOutcomeLogging`'s `moduleType`.
 *
 * Events are namespaced `result_lead_*` and carry the same flow prefix and
 * `meta.fundingSource` the funding module does, so the portal badges both the same
 * way — see `src/utils/activity-log/result-lead-log.ts`.
 */
export const RESULT_LEAD_MODULE = 'result_lead';

export const FUNDING_MODULE = 'funding';

/**
 * WHICH FLOW the rep reached the funding module through.
 *
 * The funding screen itself is identical in all three, but the timeline is not:
 * money collected while re-pitching a `rehash` lead, money on a fresh `sale`, and
 * money touched from the `my_deals` deal-edit flow answer different questions, and
 * the backend has to tell them apart to display them under the right heading.
 *
 * ⚠️ This does NOT become the `module_type` — that stays `funding` for every one of
 * them, so a single filter still returns the whole money trail. It is composed onto
 * `meta.action` instead (`rehash_funding_card_charged`) and carried alongside as
 * `meta.fundingSource` — see `composeFundingAction` in
 * `src/utils/activity-log/funding-log.ts`.
 */
export const FUNDING_SOURCES = {
  /** A re-pitch of a lead that was already sold once (`lead.isRehashed`). */
  REHASH: 'rehash',
  /** The ordinary new-deal path: calculator → rollout → Result Lead → funding. */
  SALE: 'sale',
  /** Reached from My Deals / the deal-edit flow on an already-submitted job. */
  MY_DEALS: 'my_deals',
} as const;

export type FundingSource = (typeof FUNDING_SOURCES)[keyof typeof FUNDING_SOURCES];
