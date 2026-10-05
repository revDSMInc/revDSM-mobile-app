/**
 * uploadCoordinator.ts — one drain loop over every offline queue, for use while the app is
 * backgrounded.
 *
 * The app holds FOUR durable queues, each with its own engine and its own foreground triggers:
 *
 *   activity logs   `services/offlineActivityLog`     arrival events the office reads
 *   lead work       `services/offlineLeadStore`       leads, appointments, calculators, consent…
 *   photos          `utils/uploadQueue`               inspection photos
 *   installer imgs  `services/api/offlineUploadManager`  before / after job images
 *
 * ⚠️ This file does NOT replace those engines or their triggers — each still guards its own
 * `draining` flag, so a second caller is a harmless no-op. It adds the one thing none of them had:
 * a SINGLE loop that runs them in a safe order, measures progress across all of them, and knows
 * when to stop. The background services (`androidUploadService`, `backgroundUploadService`) are
 * thin wrappers that run this loop inside whatever time the OS grants.
 *
 * ⚠️ ORDER MATTERS. Lead work must run before photos: a photo shot at a door the rep created
 * offline is queued under a CLIENT id and is only re-addressed (`rekeyLead`) when the lead's
 * create lands. Photos first would find nothing sendable and report "stalled".
 *
 * ⚠️ Calculator-settings are deliberately NOT drained here. Their flush takes an `onApplied`
 * callback that patches the Redux user (see `useAppInitialization`); flushing without it would
 * clear the pending record and let the rep's toggle spring back to the old server value.
 *
 * Imports no React and no screen, so it is also safe from a headless / service context.
 */

import { hasSession } from '../api';
import { isOnline } from '../connectivity';
import { drainActivityLogs, isActivityLogDraining, queuedActivityLogCount } from '../offlineActivityLog';
import {
  drainOfflineWork,
  isOfflineWorkDraining,
  pendingOfflineWorkCount,
} from '../offlineLeadStore';
import {
  getUploadQueue,
  isUploadQueueSyncing,
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

/** Everything this device can send right now, across all four queues. 0 when signed out. */
export const pendingUploadCount = (): number => {
  if (!hasSession()) return 0;
  return (
    pendingOfflineWorkCount() +
    uploadQueueManager.uploadableCount() +
    getUploadQueue().length +
    queuedActivityLogCount()
  );
};

/**
 * Whether any engine is mid-upload — including one started by a foreground trigger.
 *
 * ⚠️ A pass that returns at once because an engine is already draining made no progress OF ITS OWN,
 * and counting it as a stall would give up while a large photo is still on the wire.
 */
const anyEngineBusy = (): boolean =>
  isActivityLogDraining() ||
  isOfflineWorkDraining() ||
  isUploadQueueSyncing() ||
  uploadQueueManager.getActiveUploadId() !== null;

/**
 * One pass over every queue, in dependency order. Never throws: a failing queue must not stop the
 * ones behind it, and each engine already records its own failure on the item it concerns.
 */
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
  /** Called before each decision, so a service can refresh its notification text. */
  onProgress?: (state: { pending: number; online: boolean }) => void;
}

let inFlight: Promise<BackgroundDecision> | null = null;

/**
 * Drain until the queues are empty, the platform budget runs out, the queue is stuck, or the
 * device has been offline too long. Resolves with why it stopped (`done` or `give-up`).
 *
 * ⚠️ SINGLE-FLIGHT. Backgrounding can fire twice (iOS `inactive` then `background`) and on Android
 * the foreground service and the AppState hook both ask. A second caller joins the loop already
 * running rather than starting a rival one.
 */
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
