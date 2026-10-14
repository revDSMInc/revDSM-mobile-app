import { useCallback, useEffect, useState } from 'react';
import { activeWork, type OfflineLeadWork } from '../utils/offline-lead-work';
import { getOfflineWork, subscribeOfflineWork } from '../services/offlineLeadStore';
import { uploadQueueManager, type UploadQueueItem } from '../utils/uploadQueue';
import {
  getUploadQueue,
  subscribeUploadQueue,
  type OfflineUploadItem,
} from '../services/api/offlineUploadManager';
import { queuedActivityLogCount } from '../services/offlineActivityLog';

export interface PendingUploadsSnapshot {
  work: OfflineLeadWork[];
  photos: UploadQueueItem[];
  parkedPhotos: UploadQueueItem[];
  installer: OfflineUploadItem[];
  parkedInstaller: OfflineUploadItem[];
  activityLogs: number;
  /** Items the rep has to look at: failed / needs-review work and everything parked. */
  attention: number;
  /** Everything queued, parked or not. */
  total: number;
}

const read = (): PendingUploadsSnapshot => {
  const work = activeWork(getOfflineWork());
  const photos = uploadQueueManager.getQueue();
  const parkedPhotos = photos.filter((p) => !!p.parkedAt);
  const installer = getUploadQueue();
  const parkedInstaller = installer.filter((i) => !!i.parkedAt);
  const activityLogs = queuedActivityLogCount();
  const attention =
    work.filter((w) => w.status === 'failed' || w.status === 'needs-review').length +
    parkedPhotos.length +
    parkedInstaller.length;
  return {
    work,
    photos,
    parkedPhotos,
    installer,
    parkedInstaller,
    activityLogs,
    attention,
    total: work.length + photos.length + installer.length + activityLogs,
  };
};

const REFRESH_MS = 2_000;

/** Live view of every offline queue. Three queues notify; the activity log is polled. */
export const usePendingUploads = (): PendingUploadsSnapshot => {
  const [snapshot, setSnapshot] = useState<PendingUploadsSnapshot>(read);
  const refresh = useCallback(() => setSnapshot(read()), []);

  useEffect(() => {
    const offWork = subscribeOfflineWork(refresh);
    const offPhotos = uploadQueueManager.addListener(refresh);
    const offInstaller = subscribeUploadQueue(refresh);
    const timer = setInterval(refresh, REFRESH_MS);
    refresh();
    return () => {
      offWork();
      offPhotos();
      offInstaller();
      clearInterval(timer);
    };
  }, [refresh]);

  return snapshot;
};
