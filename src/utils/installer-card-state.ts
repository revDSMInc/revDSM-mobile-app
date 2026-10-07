import { isBeforeArrivalWindow } from './installer-schedule';
import { isJobBypassActive } from './job-bypass';
import type { InstallerJob } from '../config/types/installer';
import type { TranslationKey } from '../i18n/translations';

export const JOB_CARD_COLORS = {
  ACTIVE: '#ff6b35',
  PROGRESS: '#6fcf97',
  OFFSITE: '#9e9e9e',
  UPCOMING: '#2196f3',
  RESULTED: '#9e9e9e',
  EXPIRED: '#64748b',
} as const;

export type JobCardStateKey = keyof typeof JOB_CARD_COLORS;

export interface JobCardState {
  key: JobCardStateKey;
  color: string;
  actionLabelKey: TranslationKey;
  actionLabel?: string;
  accentBar: boolean;
}

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

export const humanizeStatus = (value: string): string =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const resultedActionLabel = (job: InstallerJob): string | null => {
  if (typeof job.status === 'string' && job.status.trim().toLowerCase() === 'completed') {
    return null;
  }

  const raw = [job.status, job.workflowState]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .find(Boolean);

  if (!raw) return null;

  const outcome = humanizeStatus(raw);
  return outcome.toLowerCase() === 'resulted' ? 'Resulted!' : `Resulted - ${outcome}!`;
};

export const isJobInProgress = (job?: InstallerJob | null): boolean => {
  if (!job || job.resulted) return false;

  const status = String(job.status ?? '').trim().toLowerCase();
  if (status === 'inprogress') return true;

  return String(job.workflowState ?? '').trim().toLowerCase() === 'resume';
};

export interface JobCardStateOptions {
  isUpcoming?: boolean;
  loading?: boolean;
  offSite?: boolean;
  now?: Date;
}

export const resolveJobCardState = (
  job: InstallerJob,
  {
    isUpcoming = false,
    loading = false,
    offSite = false,
    now = new Date(),
  }: JobCardStateOptions = {}
): JobCardState => {
  if (loading) {
    const base = resolveJobCardState(job, { isUpcoming, offSite, now });
    return {
      ...base,
      actionLabel: undefined,
      actionLabelKey:
        job.resulted || isUpcoming ? 'common.loading' : 'installer.startingJob',
    };
  }

  if (job.resulted) {
    return {
      key: 'RESULTED',
      color: JOB_CARD_COLORS.RESULTED,
      actionLabel: resultedActionLabel(job) ?? undefined,
      actionLabelKey: 'installer.completedAppointment',
      accentBar: false,
    };
  }

  if (isUpcoming && !isJobBypassActive(job)) {
    return {
      key: 'UPCOMING',
      color: JOB_CARD_COLORS.UPCOMING,
      actionLabelKey: 'installer.previewAppointment',
      accentBar: false,
    };
  }

  const state = job.workflowState ? BY_WORKFLOW_STATE[job.workflowState] : undefined;
  const resolved =
    state ??
    (isJobInProgress(job) ? BY_WORKFLOW_STATE.resume : BY_WORKFLOW_STATE.start);

  const startable = !isJobInProgress(job);

  const preview: JobCardState = {
    key: 'UPCOMING',
    color: JOB_CARD_COLORS.UPCOMING,
    actionLabelKey: 'installer.previewAppointment',
    accentBar: false,
  };

  if (startable && isBeforeArrivalWindow(job, now)) return preview;

  if (offSite && !isJobBypassActive(job)) return preview;

  if (resolved.key === 'EXPIRED') {
    return { ...resolved, actionLabelKey: 'installer.startAppointment' };
  }

  return resolved;
};

const BASE_WORKFLOW_STATES = new Set([
  ...Object.keys(BY_WORKFLOW_STATE),
  'resulted',
]);

export const installStatusPhrase = (job: InstallerJob): string | null => {
  const value = String(job?.workflowState ?? '').trim();
  if (!value) return null;
  return BASE_WORKFLOW_STATES.has(value) ? null : value;
};
