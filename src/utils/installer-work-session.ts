import { Storage } from './storage';
import { InstallerService } from '../services/api/installer';

const ACTIVE_WORK_JOB_KEY = 'installer:activeWorkJob';

export type WorkSessionEndReason =
  | 'left_job'
  | 'logout'
  | 'app_background'
  | 'stale_launch';

export const getActiveInstallerWorkJobId = (): string | undefined => {
  try {
    return Storage.getItem(ACTIVE_WORK_JOB_KEY) || undefined;
  } catch {
    return undefined;
  }
};

export const beginInstallerWorkSession = (jobId?: string): void => {
  if (!jobId) return;
  try {
    Storage.setItem(ACTIVE_WORK_JOB_KEY, jobId);
  } catch {
  }
};

const clearActiveInstallerWorkJob = (): void => {
  try {
    Storage.removeItem(ACTIVE_WORK_JOB_KEY);
  } catch {
  }
};

export const endInstallerWorkSession = async (
  reason: WorkSessionEndReason,
  jobId?: string
): Promise<string | undefined> => {
  const id = jobId || getActiveInstallerWorkJobId();
  if (!id) return undefined;

  clearActiveInstallerWorkJob();

  try {
    await InstallerService.endWork(id);
    console.log(`[InstallerWork] Checked out of ${id} (${reason}).`);
  } catch (err) {
    console.warn(`[InstallerWork] Check-out failed (${reason}):`, err);
  }
  return id;
};

export const endStaleInstallerWorkSession = async (): Promise<void> => {
  if (!getActiveInstallerWorkJobId()) return;
  await endInstallerWorkSession('stale_launch');
};
