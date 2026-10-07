import { Storage } from '../storage';
import { logEvent } from '../../services/api/LoggerService';
import {
  INSTALLER_MODULES,
  INSTALLER_STEP_MODULES,
  LOG_ACTIONS,
} from '../../constants/activity-log.constants';
import {
  earlyStartBypassReason,
  gpsBypassReason,
  isEarlyStartBypassActive,
  isGpsBypassActive,
} from '../job-bypass';
import type {
  GeoCoordinates,
  InstallerJob,
  InstallStepKey,
  InstallStepStatus,
  CocRelationshipType,
  InstallerResultType,
  SoldProduct,
} from '../../config/types/installer';

const ACTIVE_JOB_KEY = 'installer:activeJob';

const VISITED_JOBS_KEY = 'installer:visitedJobs';

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

const compact = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

export const stepModule = (step: InstallStepKey): string =>
  INSTALLER_STEP_MODULES[step] ?? step;

const readVisitedJobs = (): string[] => {
  try {
    const raw = Storage.getItem(VISITED_JOBS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const isFirstJobVisit = (jobId?: string): boolean =>
  !!jobId && !readVisitedJobs().includes(jobId);

export const markJobVisited = (jobId?: string): void => {
  if (!jobId) return;
  try {
    const visited = readVisitedJobs();
    if (visited.includes(jobId)) return;
    const next = [...visited, jobId].slice(-200);
    Storage.setItem(VISITED_JOBS_KEY, JSON.stringify(next));
  } catch {
  }
};

export const persistActiveInstallerJob = (job?: InstallerJob | null): void => {
  if (!job?._id) return;
  try {
    Storage.setItem(ACTIVE_JOB_KEY, JSON.stringify(compact(contextOf(job))));
    if (job.leadId) Storage.setItem(ACTIVE_LEAD_KEY, job.leadId);
  } catch {
  }
};

export const clearActiveInstallerJob = (): void => {
  try {
    Storage.removeItem(ACTIVE_JOB_KEY);
  } catch {
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
      ...(isGpsBypassActive(job) && {
        usedGpsBypass: true,
        gpsBypassReason: gpsBypassReason(job),
      }),
      ...(isEarlyStartBypassActive(job) && {
        usedEarlyStartBypass: true,
        earlyStartBypassReason: earlyStartBypassReason(job),
      }),
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

export const logInstallerJobReset = (user: any, job: InstallerJob) =>
  emit(user, LOG_ACTIONS.RESET, INSTALLER_MODULES.JOB, { action: 'job_reset' }, job);

export type CustomerContactMethod = 'call' | 'text' | 'copy_number';

export const logInstallerCustomerContact = (user: any, method: CustomerContactMethod) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, {
    action: `customer_${method}`,
    method,
  });

export const logInstallerAddressOpened = (user: any, address?: string) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, {
    action: 'address_map_opened',
    address,
  });

export const logInstallerPacketViewed = (user: any, fileName?: string) =>
  emit(user, LOG_ACTIONS.VIEW, INSTALLER_MODULES.JOB, { action: 'packet_viewed', fileName });

export const logInstallerOpsChatOpened = (user: any) =>
  emit(user, LOG_ACTIONS.CLICK, INSTALLER_MODULES.JOB, { action: 'ops_chat_opened' });

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

export interface InstallerPhotoLogMeta {
  step: InstallStepKey;
  category?: string;
  subcategory?: string;
  timestamp: string;
  coordinates?: GeoCoordinates | null;
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

export const logInstallerPhotoUploaded = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.ADD, stepModule(meta.step), photoMeta(meta, 'photo_uploaded'));

export const logInstallerPhotoReplaced = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.UPDATE, stepModule(meta.step), photoMeta(meta, 'photo_replaced'));

export const logInstallerPhotoRemoved = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.DELETE, stepModule(meta.step), photoMeta(meta, 'photo_removed'));

export const logInstallerPhotoFailed = (user: any, meta: InstallerPhotoLogMeta) =>
  emit(user, LOG_ACTIONS.ADD, stepModule(meta.step), {
    ...photoMeta(meta, 'photo_upload_failed'),
    success: false,
  });

export type MaterialMode = 'pickup' | 'return';

export const logMaterialSkipped = (user: any, mode: MaterialMode) =>
  emit(user, LOG_ACTIONS.SUBMIT, stepModule(mode), {
    mode,
    skipped: true,
    reason: mode === 'pickup' ? 'had_material_on_truck' : 'used_all_material',
    action: `${mode}_skipped`,
  });

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

const COC = INSTALLER_STEP_MODULES.coc;

type CocConfirmationKey =
  | 'is18OrOlder'
  | 'isHomeownerOrAuthorized'
  | 'installationCompletedAsPerContract';

type CocSignatureSlot = 'installer' | 'customer';

export const logCocCompleted = (user: any, totalPages: number) =>
  emit(user, LOG_ACTIONS.SUBMIT, COC, { totalPages, action: 'coc_completed' });

export const logCocFormOpened = (
  user: any,
  source: 'auto' | 'edit' | 'scan_cancelled' | 'scan'
) => emit(user, LOG_ACTIONS.OPEN, COC, { source, action: 'coc_form_opened' });

export const logCocFormDismissed = (
  user: any,
  meta: { via: 'cancel' | 'close'; signed: boolean }
) => emit(user, LOG_ACTIONS.CLOSE, COC, { ...meta, action: 'coc_form_dismissed' });

export const logCocConfirmationToggled = (
  user: any,
  meta: { confirmation: CocConfirmationKey; checked: boolean }
) => emit(user, LOG_ACTIONS.TOGGLE, COC, { ...meta, action: 'coc_confirmation_toggled' });

export const logCocRelationshipSelected = (
  user: any,
  meta: { relationship: CocRelationshipType | null; otherRelationship?: string }
) => emit(user, LOG_ACTIONS.SELECT, COC, { ...meta, action: 'coc_relationship_selected' });

export const logCocSignaturePadOpened = (user: any, who: CocSignatureSlot) =>
  emit(user, LOG_ACTIONS.OPEN, COC, { who, action: 'coc_signature_pad_opened' });

export const logCocSignatureSaved = (
  user: any,
  meta: { who: CocSignatureSlot; strokes: number; replaced: boolean }
) => emit(user, LOG_ACTIONS.SAVE, COC, { ...meta, action: 'coc_signature_saved' });

export const logCocSignatureCleared = (user: any, who: CocSignatureSlot) =>
  emit(user, LOG_ACTIONS.DELETE, COC, { who, action: 'coc_signature_cleared' });

export const logCocSignaturePadCancelled = (user: any, who: CocSignatureSlot) =>
  emit(user, LOG_ACTIONS.CLOSE, COC, { who, action: 'coc_signature_pad_cancelled' });

export const logCocPaperFallback = (user: any) =>
  emit(user, LOG_ACTIONS.CLICK, COC, { action: 'coc_paper_fallback' });

export const logCocScanned = (user: any, meta: { pages: number; totalPages: number }) =>
  emit(user, LOG_ACTIONS.ADD, COC, { ...meta, action: 'coc_pages_scanned' });

export const logCocSigned = (
  user: any,
  meta: {
    jobNumber?: string;
    date?: string;
    relationship?: string;
    relationshipOther?: string;
    signatureCount: number;
  }
  ) => emit(user, LOG_ACTIONS.SUBMIT, COC, { ...meta, action: 'coc_signed' });

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
