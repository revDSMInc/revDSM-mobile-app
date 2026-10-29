import { AppState } from 'react-native';
import { removeCachedPath } from '../utils/imageFileCache';
import { uploadQueueManager } from '../utils/uploadQueue';
import { getOfflineWork, subscribeOfflineWork } from './offlineLeadStore';
import { readLeadPhotoIndex, writeLeadPhotoIndex } from './leadPhotoIndex';
import { selectLeadsToPrune } from '../utils/lead-photo-index';

const sameLead = (a?: string | null, b?: string | null) => !!a && !!b && String(a) === String(b);

/**
 * True while this lead still has anything that has not reached the server: queued photos, a photo log
 * waiting for its image url, or offline lead work (created / checked in / deal data / documents).
 */
export const leadHasOfflineWork = (leadId?: string | null): boolean => {
  if (!leadId) return false;
  if (uploadQueueManager.getQueue().some((i) => sameLead(i.leadId, leadId))) return true;
  if (uploadQueueManager.hasPendingPhotoLogsFor(leadId)) return true;
  return getOfflineWork().some(
    (w) => sameLead(w.clientId, leadId) || sameLead(w.serverIds?.leadId, leadId)
  );
};

let pruning = false;

/** Delete the saved photos of every lead whose offline work is fully delivered (after a grace period). */
export const pruneDeliveredLeadPhotos = async (): Promise<number> => {
  if (pruning) return 0;
  pruning = true;
  let removed = 0;
  try {
    const index = readLeadPhotoIndex();
    const leads = selectLeadsToPrune(index, leadHasOfflineWork);
    if (!leads.length) return 0;
    for (const leadId of leads) {
      for (const path of index[leadId].paths) {
        if (await removeCachedPath(path)) removed += 1;
      }
      delete index[leadId];
    }
    writeLeadPhotoIndex(index);
  } catch (e) {
    console.warn('[leadPhotoCache] prune failed', e);
  } finally {
    pruning = false;
  }
  return removed;
};

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const schedule = () => {
  if (timer) return;
  // Debounced: queues notify on every item, and the grace period means nothing is due sooner anyway.
  timer = setTimeout(() => {
    timer = null;
    void pruneDeliveredLeadPhotos();
  }, 30_000);
};

export const startLeadPhotoCacheSync = (): void => {
  if (started) return;
  started = true;
  uploadQueueManager.addListener(schedule);
  subscribeOfflineWork(schedule);
  AppState.addEventListener('change', (s) => {
    if (s === 'active') schedule();
  });
  schedule();
};
