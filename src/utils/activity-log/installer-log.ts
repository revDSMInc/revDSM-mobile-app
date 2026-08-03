/**
 * Installer activity log.
 *
 * One named helper per app event, mirroring the shape the sales side already uses
 * (`src/utils/lead-activity-log.ts`, `./calculator-log.ts`): a pure function that
 * takes the signed-in `user`, builds the meta, and hands off to `logEvent`. Nothing
 * here throws or awaits the caller's critical path — a log must never be able to
 * break a step.
 *
 * Two conventions the portal depends on:
 *
 *  - **A job visit is a session.** The first open of a job logs `click` /
 *    `job_check_in`, backing out logs `pause` / `job_session`, and coming back logs
 *    `click` / `job_resume`. Which one applies is decided by whether the job id has
 *    been seen before (persisted, so it survives an app restart).
 *  - **Step work is logged under its step.** `module_type` is the step's own name
 *    (`pickup`, `pre_existing_conditions`, `pre_install_photos`, `verify_jobs`,
 *    `post_install_photos`, `coc`, `return`), not a generic installer module.
 *
 * Job context (jobId / leadId / customer / address) is captured once when a job is
 * opened (`persistActiveInstallerJob`) and merged into every subsequent log, so the
 * deeply-nested step screens don't have to thread the job down through props.
 */

import { Storage } from '../storage';
import { logEvent } from '../../services/api/LoggerService';
import {
  INSTALLER_MODULES,
  INSTALLER_STEP_MODULES,
  LOG_ACTIONS,
} from '../../constants/activity-log.constants';
import type {
  GeoCoordinates,
  InstallerJob,
  InstallStepKey,
  InstallStepStatus,
  InstallerResultType,
  SoldProduct,
} from '../../config/types/installer';

/** Where the active job's log context lives between screens. */
const ACTIVE_JOB_KEY = 'installer:activeJob';

/** Job ids this device has already checked into — drives check-in vs resume. */
const VISITED_JOBS_KEY = 'installer:visitedJobs';

/**
 * Key the LoggerService reads to auto-attach `meta.leadId`. Shared with the sales
 * flow on purpose — the portal links a log row to a record through this field.
 */
const ACTIVE_LEAD_KEY = 'leadId';

export interface InstallerJobContext {
  jobId?: string;
  leadId?: string;
  leadDisplayId?: string;
  jobNumber?: string;
  customerName?: string;
  address?: string;
}

const userIdOf = (user: any): string | undefined => user?._id || user?.id;

const contextOf = (job?: InstallerJob | null): InstallerJobContext => ({
  jobId: job?._id,
  leadId: job?.leadId,
  leadDisplayId: job?.leadDisplayId,
  jobNumber: job?.jobNumber,
  customerName:
    job?.customerName ||
    [job?.customerDetails?.firstName, job?.customerDetails?.lastName]
      .filter(Boolean)
      .join(' ') ||
    undefined,
  address: job?.fullAddress,
});

/** Strips undefined so the payload stays clean for the portal. */
const compact = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** `'pec'` → `'pre_existing_conditions'`. */
export const stepModule = (step: InstallStepKey): string =>
  INSTALLER_STEP_MODULES[step] ?? step;

// ─────────────────────────────────────────────────────────────────────────────
// Job context + visit tracking
// ─────────────────────────────────────────────────────────────────────────────

const readVisitedJobs = (): string[] => {
  try {
    const raw = Storage.getItem(VISITED_JOBS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** True the first time a job is opened on this device, false on every return. */
export const isFirstJobVisit = (jobId?: string): boolean =>
  !!jobId && !readVisitedJobs().includes(jobId);

/** Records a job as visited, so the next open logs a resume rather than a check-in. */
export const markJobVisited = (jobId?: string): void => {
  if (!jobId) return;
  try {
    const visited = readVisitedJobs();
    if (visited.includes(jobId)) return;
    // Bounded so a long-lived install account can't grow this without limit; the tail
    // is the oldest jobs, which will never be reopened.
    const next = [...visited, jobId].slice(-200);
    Storage.setItem(VISITED_JOBS_KEY, JSON.stringify(next));
  } catch {
    // A storage failure just means the next open logs a check-in again.
  }
};

/**
 * Remembers the job an installer just opened so every downstream log carries it.
 * Also writes `leadId` to the key the LoggerService auto-attaches from.
 */
export const persistActiveInstallerJob = (job?: InstallerJob | null): void => {
  if (!job?._id) return;
  try {
    Storage.setItem(ACTIVE_JOB_KEY, JSON.stringify(compact(contextOf(job))));
    if (job.leadId) Storage.setItem(ACTIVE_LEAD_KEY, job.leadId);
  } catch {
    // Never let a storage failure take down the screen that opened the job.
  }
};

/** Called on sign-out, or when the installer leaves the job for the schedule. */
export const clearActiveInstallerJob = (): void => {
  try {
    Storage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    // no-op
  }
};

export const getActiveInstallerJobContext = (): InstallerJobContext => {
  try {
    const raw = Storage.getItem(ACTIVE_JOB_KEY);
    return raw ? (JSON.parse(raw) as InstallerJobContext) : {};
  } catch {
    return {};
  }
};

/**
 * Core emitter. `job` is optional — when omitted the stored context is used, which
 * is what the step screens rely on.
 */
const emit = (
  user: any,
  action: string,
  moduleType: string,
  meta: Record<string, any> = {},
  job?: InstallerJob | null
): void => {
  const userId = userIdOf(user);
  if (!userId) return;

  const context = job ? compact(contextOf(job)) : getActiveInstallerJobContext();

  // Fire-and-forget: logEvent already swallows transport errors, this guards the
  // synchronous portion (storage reads, JSON) as well.
  try {
    Promise.resolve(
      logEvent(action, {
        user_id: userId,
        created_by: userId,
        module_type: moduleType,
        meta: compact({ ...context, ...meta }),
      })
    ).catch(() => {});
  } catch (err) {
    console.warn('[InstallerLog] Failed to queue log:', err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

/** Installer schedule rendered. Not lead-scoped. */
export const logInstallerDashboardViewed = (
  user: any,
  meta: { period: string; jobCount: number; companyName?: string }
) =>
  emit(
    user,
    LOG_ACTIONS.VIEW,
    INSTALLER_MODULES.DASHBOARD,
    { ...meta, action: 'installer_dashboard_viewed' },
    null
  );

/** Today / Tomorrow tab. */
export const logInstallerPeriodChanged = (user: any, period: string) =>
  emit(
    user,
    LOG_ACTIONS.TOGGLE,
    INSTALLER_MODULES.DASHBOARD,
    { period, action: 'period_changed' },
    null
  );

export const logInstallerJobsRefreshed = (user: any, period: string) =>
  emit(
    user,
    LOG_ACTIONS.VIEW,
    INSTALLER_MODULES.DASHBOARD,
    { period, action: 'jobs_refreshed' },
    null
  );

// ─────────────────────────────────────────────────────────────────────────────
// Job session — check in / pause / resume
// ─────────────────────────────────────────────────────────────────────────────

/** Check-in + `status: inProgress` succeeded; the working payload is in hand. */
export const logInstallerJobStarted = (user: any, job: InstallerJob) =>
  emit(
    user,
    LOG_ACTIONS.START,
    INSTALLER_MODULES.JOB,
    {
      action: 'job_started',
      status: job?.status,
      hasContract: !!job?.contract,
      hasRepPhotos: !!job?.preInstallPhotos,
      productCount: job?.products?.length ?? 0,
    },
    job
  );

export const logInstallerJobStartFailed = (user: any, job: InstallerJob, error?: unknown) =>
  emit(
    user,
    LOG_ACTIONS.START,
    INSTALLER_MODULES.JOB,
    {
      action: 'job_start_failed',
      success: false,
      error: error instanceof Error ? error.message : undefined,
    },
    job
  );

/**
 * The installer opened the job detail screen.
 *
 * First visit → `click` / `job_check_in`. Every later visit → `click` / `job_resume`.
 * The job is marked visited here, so a re-open in the same session already resumes.
 */
export const logInstallerJobOpened = (
  user: any,
  job: InstallerJob,
  meta: { readOnly: boolean; completedSteps: number; totalSteps: number }
) => {
  const firstVisit = isFirstJobVisit(job?._id);
  emit(
    user,
    LOG_ACTIONS.CLICK,
    firstVisit ? INSTALLER_MODULES.JOB_CHECK_IN : INSTALLER_MODULES.JOB_RESUME,
    { ...meta, action: firstVisit ? 'job_checked_in' : 'job_resumed' },
    job
  );
  markJobVisited(job?._id);
};

/**
 * Backing out to the schedule. The job isn't finished — it's paused — so this is
 * deliberately not a "close".
 */
export const logInstallerJobPaused = (
  user: any,
  job: InstallerJob,
  meta: { completedSteps: number; totalSteps: number }
) =>
  emit(
    user,
    LOG_ACTIONS.PAUSE,
    INSTALLER_MODULES.JOB_SESSION,
    { ...meta, action: 'job_session_paused' },
    job
  );

/** The installer signed the job off — every step done and `status: completed` sent. */
export const logInstallerJobCompleted = (
  user: any,
  job: InstallerJob,
  meta: { completedSteps: number; totalSteps: number }
) =>
  emit(
    user,
    LOG_ACTIONS.SUBMIT,
    INSTALLER_MODULES.JOB,
    { ...meta, status: 'completed', action: 'job_completed' },
    job
  );

/** Every capture, note and selection wiped — the crew is starting the job over. */
export const logInstallerJobReset = (user: any, job: InstallerJob) =>
  emit(user, LOG_ACTIONS.RESET, INSTALLER_MODULES.JOB, { action: 'job_reset' }, job);

export type CustomerContactMethod = 'call' | 'text' | 'copy_number';

export const logInstallerCustomerContact = (user: any, method: CustomerContactMethod) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, {
    action: `customer_${method}`,
    method,
  });

/** Address tapped — the installer is handing off to Google / Apple Maps. */
export const logInstallerAddressOpened = (user: any, address?: string) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, {
    action: 'address_map_opened',
    address,
  });

export const logInstallerPacketViewed = (user: any, fileName?: string) =>
  emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.JOB, { action: 'packet_viewed', fileName });

export const logInstallerOpsChatOpened = (user: any) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, { action: 'ops_chat_opened' });

// ─────────────────────────────────────────────────────────────────────────────
// Timeline steps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prose `meta.action` for a step's open / close, replacing the generic `step_opened`
 * and `step_closed` codes.
 *
 * The portal renders `meta.action` straight into the activity feed, so a step listed
 * here reads as a sentence instead of a code. Only listed steps are overridden —
 * anything absent keeps the generic code, which is what every other step still sends.
 * `action_type` (`view` / `close`) and `module_type` are untouched, so existing
 * filters on those keep working.
 */
const STEP_ACTION_LABELS: Partial<
  Record<InstallStepKey, { opened?: string; closed?: string }>
> = {
  pickup: {
    opened: 'Opened the Warehouse Pickup',
    closed: 'Completed the Warehouse Pickup',
  },
};

export const logInstallStepOpened = (
  user: any,
  step: InstallStepKey,
  status?: InstallStepStatus
) =>
  emit(user, LOG_ACTIONS.VIEW, stepModule(step), {
    step,
    status,
    action: STEP_ACTION_LABELS[step]?.opened ?? 'step_opened',
  });

export const logInstallStepClosed = (user: any, step: InstallStepKey) =>
  emit(user, LOG_ACTIONS.CLOSE, stepModule(step), {
    step,
    action: STEP_ACTION_LABELS[step]?.closed ?? 'step_closed',
  });

export const logInstallStepCompleted = (
  user: any,
  step: InstallStepKey,
  meta: Record<string, any> = {}
) =>
  emit(user, LOG_ACTIONS.SUBMIT, stepModule(step), {
    step,
    ...meta,
    action: 'step_completed',
  });

// ─────────────────────────────────────────────────────────────────────────────
// Photos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the portal needs to render one install photo, matching the sales
 * `inspection_photo` payload field for field — `imageData` is what the portal reads
 * to show the thumbnail, the outer copies are what it filters and sorts on.
 */
export interface InstallerPhotoLogMeta {
  /** Which timeline step the shot belongs to — becomes `module_type`. */
  step: InstallStepKey;
  /** Grouping label, e.g. the rep category "Flooring — EXT". */
  category?: string;
  /** The slot / tag / area this shot documents, e.g. "Back-Left". */
  subcategory?: string;
  timestamp: string;
  coordinates?: GeoCoordinates | null;
  /** Bytes on disk. 0 when the file could not be stat'd. */
  size?: number;
  s3url?: string;
  bucketName?: string;
}

const photoMeta = (meta: InstallerPhotoLogMeta, action: string) =>
  compact({
    category: meta.category,
    subcategory: meta.subcategory,
    timestamp: meta.timestamp,
    coordinates: meta.coordinates ?? null,
    size: meta.size ?? 0,
    action,
    // Only present once the upload came back with a key — a CoC page never has one,
    // and a failed upload must not claim it does.
    imageData: meta.s3url
      ? compact({
          s3url: meta.s3url,
          bucketName: meta.bucketName,
          category: meta.category,
          subcategory: meta.subcategory,
          timestampTaken: meta.timestamp,
          coordinates: meta.coordinates ?? null,
        })
      : undefined,
  });

/** A new shot landed in S3. */
export const logInstallerPhotoUploaded = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.ADD, stepModule(meta.step), photoMeta(meta, 'photo_uploaded'));

/** A retake — the shot replaces one already matched to this tag. */
export const logInstallerPhotoReplaced = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.UPDATE, stepModule(meta.step), photoMeta(meta, 'photo_replaced'));

export const logInstallerPhotoRemoved = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.DELETE, stepModule(meta.step), photoMeta(meta, 'photo_removed'));

/** The upload failed — the capture is on the device but not in S3. */
export const logInstallerPhotoFailed = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.ADD, stepModule(meta.step), {
    ...photoMeta(meta, 'photo_upload_failed'),
    success: false,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Material pickup / return
// ─────────────────────────────────────────────────────────────────────────────

export type MaterialMode = 'pickup' | 'return';

/** "Had material on truck" / "Used all material". */
export const logMaterialSkipped = (user: any, mode: MaterialMode) =>
  emit(user, LOG_ACTIONS.SUBMIT, stepModule(mode), {
    mode,
    skipped: true,
    reason: mode === 'pickup' ? 'had_material_on_truck' : 'used_all_material',
    action: `${mode}_skipped`,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Pre-existing conditions
// ─────────────────────────────────────────────────────────────────────────────

const PEC = INSTALLER_STEP_MODULES.pec;

export const logPecAnswered = (user: any, hasConditions: boolean | null) =>
  emit(user, LOG_ACTIONS.CHANGE, PEC, {
    hasConditions,
    action: hasConditions ? 'conditions_present' : 'no_conditions_found',
  });

export const logPecAreaToggled = (
  user: any,
  area: { id: string; label: string },
  flagged: boolean
) =>
  emit(user, flagged ? LOG_ACTIONS.ADD : LOG_ACTIONS.DELETE, PEC, {
    areaId: area.id,
    subcategory: area.label,
    action: flagged ? 'area_flagged' : 'area_unflagged',
  });

export const logPecNoteEntered = (
  user: any,
  area: { id: string; label: string },
  note: string
) =>
  emit(user, LOG_ACTIONS.CHANGE, PEC, {
    areaId: area.id,
    subcategory: area.label,
    note,
    action: 'condition_note_entered',
  });

export const logPecConfirmed = (
  user: any,
  meta: { hasConditions: boolean | null; areaCount: number; photoCount: number; areas: string[] }
) => emit(user, LOG_ACTIONS.SUBMIT, PEC, { ...meta, action: 'pec_confirmed' });

// ─────────────────────────────────────────────────────────────────────────────
// Pre / post install photo matching
// ─────────────────────────────────────────────────────────────────────────────

export const logPhotoSectionChanged = (
  user: any,
  step: InstallStepKey,
  section: { id: string; name: string }
) =>
  emit(user, LOG_ACTIONS.SELECT, stepModule(step), {
    sectionId: section.id,
    category: section.name,
    action: 'section_changed',
  });

export const logPhotoPhaseCompleted = (
  user: any,
  step: InstallStepKey,
  meta: { matched: number; total: number; extras: number }
) => emit(user, LOG_ACTIONS.SUBMIT, stepModule(step), { ...meta, action: 'photos_completed' });

// ─────────────────────────────────────────────────────────────────────────────
// Scope verification & discrepancies
// ─────────────────────────────────────────────────────────────────────────────

const SCOPE = INSTALLER_STEP_MODULES.measure;

export const logScopeConfirmed = (user: any, product: SoldProduct) =>
  emit(user, LOG_ACTIONS.CHANGE, SCOPE, {
    productId: product.id,
    subcategory: product.name,
    state: 'confirmed',
    action: 'scope_confirmed',
  });

export const logScopeUndone = (user: any, product: SoldProduct) =>
  emit(user, LOG_ACTIONS.CHANGE, SCOPE, {
    productId: product.id,
    subcategory: product.name,
    state: 'unset',
    action: 'scope_confirmation_undone',
  });

export const logScopeResolved = (user: any, product: SoldProduct, issue?: string) =>
  emit(user, LOG_ACTIONS.UPDATE, SCOPE, {
    productId: product.id,
    subcategory: product.name,
    issue,
    state: 'resolved',
    action: 'scope_discrepancy_resolved',
  });

export const logScopeCompleted = (
  user: any,
  meta: { productCount: number; confirmed: number; resolved: number }
) => emit(user, LOG_ACTIONS.SUBMIT, SCOPE, { ...meta, action: 'scope_verified' });

export const logDiscrepancyOpened = (user: any, product: SoldProduct) =>
  emit(user, LOG_ACTIONS.OPEN, SCOPE, {
    productId: product.id,
    subcategory: product.name,
    action: 'discrepancy_form_opened',
  });

export const logDiscrepancyReported = (
  user: any,
  product: SoldProduct,
  report: { issue: string; note: string; attachments: string[] }
) =>
  emit(user, LOG_ACTIONS.SUBMIT, SCOPE, {
    productId: product.id,
    subcategory: product.name,
    issue: report.issue,
    note: report.note,
    attachmentCount: report.attachments.length,
    action: 'discrepancy_reported',
  });

// ─────────────────────────────────────────────────────────────────────────────
// Certificate of Completion
// ─────────────────────────────────────────────────────────────────────────────

const COC = INSTALLER_STEP_MODULES.coc;

export const logCocCompleted = (user: any, totalPages: number) =>
  emit(user, LOG_ACTIONS.SUBMIT, COC, { totalPages, action: 'coc_completed' });

// ─────────────────────────────────────────────────────────────────────────────
// Result
// ─────────────────────────────────────────────────────────────────────────────

export const logInstallerResultOpened = (user: any, result: InstallerResultType) =>
  emit(user, LOG_ACTIONS.OPEN, INSTALLER_MODULES.RESULT, {
    result,
    action: 'result_form_opened',
  });

export const logInstallerResultSubmitted = (
  user: any,
  result: InstallerResultType,
  reason: string
) =>
  emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.RESULT, {
    result,
    reason,
    action: 'job_resulted',
  });

export const logInstallerResultFailed = (
  user: any,
  result: InstallerResultType,
  reason: string
) =>
  emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.RESULT, {
    result,
    reason,
    success: false,
    action: 'job_result_failed',
  });
