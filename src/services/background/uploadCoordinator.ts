import { hasSession } from '../api';
import { isOnline } from '../connectivity';
import { drainActivityLogs, isActivityLogDraining, queuedActivityLogCount } from '../offlineActivityLog';
import {
  drainOfflineWork,
  isOfflineWorkDraining,
  pendingOfflineWorkCount,
} from '../offlineLeadStore';
import {
  isUploadQueueSyncing,
  pendingInstallerUploadCount,
  processUploadQueue,
} from '../api/offlineUploadManager';
import { uploadQueueManager } from '../../utils/uploadQueue';
import {
  BACKGROUND_POLL_MS,
  decideBackgroundStep,
  isStalledPass,
  type BackgroundDecision,
} from '../../utils/background-upload-policy';
import { remainingGraceSeconds } from './nativeBackgroundTask';

export const pendingUploadCount = (): number => {
  if (!hasSession()) return 0;
  return (
    pendingOfflineWorkCount() +
    uploadQueueManager.heldCount() +
    pendingInstallerUploadCount() +
    queuedActivityLogCount()
  );
};

const anyEngineBusy = (): boolean =>
  isActivityLogDraining() ||
  isOfflineWorkDraining() ||
  isUploadQueueSyncing() ||
  uploadQueueManager.getActiveUploadId() !== null;

const runPass = async (): Promise<void> => {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['activity-logs', drainActivityLogs],
    ['lead-work', drainOfflineWork],
    ['photos', () => uploadQueueManager.processQueue()],
    ['installer-images', () => processUploadQueue()],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (e) {
      console.warn(`[uploadCoordinator] ${name} pass failed`, e);
    }
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface BackgroundDrainOptions {
  onProgress?: (state: { pending: number; online: boolean }) => void;
}

let inFlight: Promise<BackgroundDecision> | null = null;

export const runBackgroundDrain = (
  reason: string,
  options: BackgroundDrainOptions = {}
): Promise<BackgroundDecision> => {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<BackgroundDecision> => {
    console.log(`[uploadCoordinator] drain started (${reason}), pending=${pendingUploadCount()}`);
    let stalledPasses = 0;
    let offlineSince: number | null = null;
    try {
      for (;;) {
        const online = isOnline();
        if (online) offlineSince = null;
        else if (offlineSince === null) offlineSince = Date.now();

        const pending = pendingUploadCount();
        options.onProgress?.({ pending, online });

        const decision = decideBackgroundStep({
          pending,
          online,
          remainingSeconds: await remainingGraceSeconds(),
          stalledPasses,
          offlineForMs: offlineSince === null ? 0 : Date.now() - offlineSince,
        });
        if (decision === 'done' || decision === 'give-up') {
          console.log(`[uploadCoordinator] drain ${decision}, pending=${pending}`);
          return decision;
        }
        if (decision === 'wait') {
          await sleep(BACKGROUND_POLL_MS);
          continue;
        }

        const before = pending;
        await runPass();
        const after = pendingUploadCount();
        stalledPasses = isStalledPass(before, after, isOnline() && !anyEngineBusy())
          ? stalledPasses + 1
          : 0;
        if (after > 0) await sleep(BACKGROUND_POLL_MS);
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};
