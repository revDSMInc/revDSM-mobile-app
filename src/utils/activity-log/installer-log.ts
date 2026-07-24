/**
 * Installer activity log.
 *
 * One named helper per app event in the installer module, mirroring the shape the
 * sales side already uses (`src/utils/lead-activity-log.ts`, `./calculator-log.ts`):
 * a pure function that takes the signed-in `user`, builds the meta, and hands off to
 * `logEvent`. Nothing here throws or awaits the caller's critical path — a log must
 * never be able to break a step.
 *
 * Job context (jobId / leadId / customer / address) is captured once when a job is
 * opened (`persistActiveInstallerJob`) and merged into every subsequent log, so the
 * deeply-nested step screens don't have to thread the job down through props.
 */

import { Storage } from '../storage';
import { logEvent } from '../../services/api/LoggerService';
import { INSTALLER_MODULES, LOG_ACTIONS } from '../../constants/activity-log.constants';
import type {
  InstallerJob,
  InstallStepKey,
  InstallStepStatus,
  InstallerResultType,
  PhotoPhase,
  SoldProduct,
} from '../../config/types/installer';

/** Where the active job's log context lives between screens. */
const ACTIVE_JOB_KEY = 'installer:activeJob';

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
) => emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.DASHBOARD, { ...meta, action: 'installer_dashboard_viewed' }, null);

/** Today / Tomorrow tab. */
export const logInstallerPeriodChanged = (user: any, period: string) =>
  emit(user, LOG_ACTIONS.TOGGLE, INSTALLER_MODULES.DASHBOARD, { period, action: 'period_changed' }, null);

export const logInstallerJobsRefreshed = (user: any, period: string) =>
  emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.DASHBOARD, { period, action: 'jobs_refreshed' }, null);

// ─────────────────────────────────────────────────────────────────────────────
// Job
// ─────────────────────────────────────────────────────────────────────────────

/** The job card was tapped, before the status call goes out. */
export const logInstallerJobCardTapped = (
  user: any,
  job: InstallerJob,
  meta: { period: string; readOnly: boolean }
) => emit(user, LOG_ACTIONS.SELECT, INSTALLER_MODULES.JOB, { ...meta, action: 'job_card_tapped' }, job);

/** `PUT update-job-status` → inProgress succeeded; the working payload is in hand. */
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

/** Job detail screen rendered. `readOnly` = a preview or an already-resulted job. */
export const logInstallerJobOpened = (
  user: any,
  job: InstallerJob,
  meta: { readOnly: boolean; completedSteps: number; totalSteps: number }
) => emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.JOB, { ...meta, action: 'job_opened' }, job);

export const logInstallerJobClosed = (user: any, job: InstallerJob, completedSteps: number) =>
  emit(user, LOG_ACTIONS.CLOSE, INSTALLER_MODULES.JOB, { completedSteps, action: 'job_closed' }, job);

export type CustomerContactMethod = 'call' | 'text' | 'copy_number';

export const logInstallerCustomerContact = (user: any, method: CustomerContactMethod) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, { action: `customer_${method}`, method });

export const logInstallerPacketViewed = (user: any, fileName?: string) =>
  emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.JOB, { action: 'packet_viewed', fileName });

export const logInstallerOpsChatOpened = (user: any) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, { action: 'ops_chat_opened' });

// ─────────────────────────────────────────────────────────────────────────────
// Timeline steps
// ─────────────────────────────────────────────────────────────────────────────

export const logInstallStepOpened = (
  user: any,
  step: InstallStepKey,
  status?: InstallStepStatus
) => emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.STEP, { step, status, action: 'step_opened' });

export const logInstallStepClosed = (user: any, step: InstallStepKey) =>
  emit(user, LOG_ACTIONS.CLOSE, INSTALLER_MODULES.STEP, { step, action: 'step_closed' });

export const logInstallStepCompleted = (
  user: any,
  step: InstallStepKey,
  meta: Record<string, any> = {}
) => emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.STEP, { step, ...meta, action: 'step_completed' });

// ─────────────────────────────────────────────────────────────────────────────
// Material pickup / return
// ─────────────────────────────────────────────────────────────────────────────

export type MaterialMode = 'pickup' | 'return';

export const logMaterialPhotoAdded = (user: any, mode: MaterialMode, totalPhotos: number) =>
  emit(user, LOG_ACTIONS.ADD, INSTALLER_MODULES.MATERIAL, {
    mode,
    totalPhotos,
    action: `${mode}_photo_added`,
  });

export const logMaterialPhotoRemoved = (user: any, mode: MaterialMode, totalPhotos: number) =>
  emit(user, LOG_ACTIONS.DELETE, INSTALLER_MODULES.MATERIAL, {
    mode,
    totalPhotos,
    action: `${mode}_photo_removed`,
  });

/** "Had material on truck" / "Used all material". */
export const logMaterialSkipped = (user: any, mode: MaterialMode) =>
  emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.MATERIAL, {
    mode,
    skipped: true,
    reason: mode === 'pickup' ? 'had_material_on_truck' : 'used_all_material',
    action: `${mode}_skipped`,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Pre-existing conditions
// ─────────────────────────────────────────────────────────────────────────────

export const logPecAnswered = (user: any, hasConditions: boolean | null) =>
  emit(user, LOG_ACTIONS.CHANGE, INSTALLER_MODULES.PEC, {
    hasConditions,
    action: hasConditions ? 'conditions_present' : 'no_conditions_found',
  });

export const logPecAreaToggled = (
  user: any,
  area: { id: string; label: string },
  flagged: boolean
) =>
  emit(user, flagged ? LOG_ACTIONS.ADD : LOG_ACTIONS.DELETE, INSTALLER_MODULES.PEC, {
    areaId: area.id,
    areaLabel: area.label,
    action: flagged ? 'area_flagged' : 'area_unflagged',
  });

export const logPecPhotoAdded = (
  user: any,
  area: { id: string; label: string },
  totalPhotos: number
) =>
  emit(user, LOG_ACTIONS.ADD, INSTALLER_MODULES.PEC, {
    areaId: area.id,
    areaLabel: area.label,
    totalPhotos,
    action: 'condition_photo_added',
  });

export const logPecNoteEntered = (
  user: any,
  area: { id: string; label: string },
  note: string
) =>
  emit(user, LOG_ACTIONS.CHANGE, INSTALLER_MODULES.PEC, {
    areaId: area.id,
    areaLabel: area.label,
    note,
    action: 'condition_note_entered',
  });

export const logPecConfirmed = (
  user: any,
  meta: { hasConditions: boolean | null; areaCount: number; photoCount: number; areas: string[] }
) => emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.PEC, { ...meta, action: 'pec_confirmed' });

// ─────────────────────────────────────────────────────────────────────────────
// Pre / post install photo matching
// ─────────────────────────────────────────────────────────────────────────────

export const logPhotoMatched = (
  user: any,
  phase: PhotoPhase,
  tag: { id: string; label: string },
  meta: { matched: number; total: number; retake?: boolean }
) =>
  emit(user, LOG_ACTIONS.ADD, INSTALLER_MODULES.PHOTOS, {
    phase,
    tagId: tag.id,
    tagLabel: tag.label,
    ...meta,
    action: meta.retake ? `${phase}_photo_retaken` : `${phase}_photo_matched`,
  });

export const logPhotoExtraAdded = (
  user: any,
  phase: PhotoPhase,
  section: { id: string; name: string },
  totalExtras: number
) =>
  emit(user, LOG_ACTIONS.ADD, INSTALLER_MODULES.PHOTOS, {
    phase,
    sectionId: section.id,
    sectionName: section.name,
    totalExtras,
    action: `${phase}_extra_photo_added`,
  });

export const logPhotoSectionChanged = (
  user: any,
  phase: PhotoPhase,
  section: { id: string; name: string }
) =>
  emit(user, LOG_ACTIONS.SELECT, INSTALLER_MODULES.PHOTOS, {
    phase,
    sectionId: section.id,
    sectionName: section.name,
    action: `${phase}_section_changed`,
  });

export const logPhotoPhaseCompleted = (
  user: any,
  phase: PhotoPhase,
  meta: { matched: number; total: number; extras: number }
) =>
  emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.PHOTOS, {
    phase,
    ...meta,
    action: `${phase}_photos_completed`,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Scope verification & discrepancies
// ─────────────────────────────────────────────────────────────────────────────

export const logScopeConfirmed = (user: any, product: SoldProduct) =>
  emit(user, LOG_ACTIONS.CHANGE, INSTALLER_MODULES.SCOPE, {
    productId: product.id,
    productName: product.name,
    state: 'confirmed',
    action: 'scope_confirmed',
  });

export const logScopeUndone = (user: any, product: SoldProduct) =>
  emit(user, LOG_ACTIONS.CHANGE, INSTALLER_MODULES.SCOPE, {
    productId: product.id,
    productName: product.name,
    state: 'unset',
    action: 'scope_confirmation_undone',
  });

export const logScopeResolved = (user: any, product: SoldProduct, issue?: string) =>
  emit(user, LOG_ACTIONS.UPDATE, INSTALLER_MODULES.SCOPE, {
    productId: product.id,
    productName: product.name,
    issue,
    state: 'resolved',
    action: 'scope_discrepancy_resolved',
  });

export const logScopeCompleted = (
  user: any,
  meta: { productCount: number; confirmed: number; resolved: number }
) => emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.SCOPE, { ...meta, action: 'scope_verified' });

export const logDiscrepancyOpened = (user: any, product: SoldProduct) =>
  emit(user, LOG_ACTIONS.OPEN, INSTALLER_MODULES.DISCREPANCY, {
    productId: product.id,
    productName: product.name,
    action: 'discrepancy_form_opened',
  });

export const logDiscrepancyReported = (
  user: any,
  product: SoldProduct,
  report: { issue: string; note: string; attachments: string[] }
) =>
  emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.DISCREPANCY, {
    productId: product.id,
    productName: product.name,
    issue: report.issue,
    note: report.note,
    attachmentCount: report.attachments.length,
    action: 'discrepancy_reported',
  });

// ─────────────────────────────────────────────────────────────────────────────
// Certificate of Completion
// ─────────────────────────────────────────────────────────────────────────────

export const logCocPagesScanned = (user: any, added: number, totalPages: number) =>
  emit(user, LOG_ACTIONS.ADD, INSTALLER_MODULES.COC, {
    added,
    totalPages,
    action: 'coc_pages_scanned',
  });

export const logCocPageRemoved = (user: any, totalPages: number) =>
  emit(user, LOG_ACTIONS.DELETE, INSTALLER_MODULES.COC, {
    totalPages,
    action: 'coc_page_removed',
  });

export const logCocCompleted = (user: any, totalPages: number) =>
  emit(user, LOG_ACTIONS.SUBMIT, INSTALLER_MODULES.COC, {
    totalPages,
    action: 'coc_completed',
  });

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
