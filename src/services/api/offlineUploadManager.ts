import { Platform, DeviceEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import { storage } from '../../utils/storage';
import { hasSession } from './index';
import { LeadService } from './leads';
import { isOnline, onReconnect, refreshConnectivity } from '../connectivity';
import { getSessionOwner } from '../sessionScope';
import { isOwnedBy } from '../../utils/session-scope';
import {
  MAX_INSTALLER_ATTEMPTS,
  afterFailure,
  installerBackoffMs,
  isDue,
  isUnauthorizedError,
  rearmItem,
} from '../../utils/upload-retry-policy';

export interface OfflineUploadFile {
  localPath: string;
  type: string;
  name: string;
}

export interface OfflineUploadItem {
  id: string;
  jobNumber: string;
  companyId: string;
  houseNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  price: string | number;
  installationDate: string;
  type: 'before' | 'after';
  files: OfflineUploadFile[];
  timestamp: number;
  /** The rep who queued it. Absent on items queued before owners existed - those belong to whoever is signed in. */
  ownerId?: string;
  attempts?: number;
  lastError?: string;
  /** Set after MAX_INSTALLER_ATTEMPTS failures: kept on the device, skipped until the rep retries. */
  parkedAt?: string;
  /** Backoff: do not try again before this time (ms epoch). */
  nextAttemptAt?: number;
}

const STORAGE_KEY = 'offline_image_uploads';
const OFFLINE_DIR = `${RNFS.DocumentDirectoryPath}/offline_uploads`;
let isSyncing = false;
let syncInterval: any = null;
let unsubscribeReconnect: (() => void) | null = null;

export async function checkOnlineStatus(): Promise<boolean> {
  return refreshConnectivity();
}

async function ensureOfflineDirExists(): Promise<void> {
  const exists = await RNFS.exists(OFFLINE_DIR);
  if (!exists) {
    await RNFS.mkdir(OFFLINE_DIR);
  }
}

const queueListeners = new Set<() => void>();

export function subscribeUploadQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

function notifyQueue(): void {
  queueListeners.forEach((l) => {
    try {
      l();
    } catch {
    }
  });
}

/** Every item on the device, whoever queued it. Only the writers below should use this. */
function readAllItems(): OfflineUploadItem[] {
  const data = storage.getString(STORAGE_KEY);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[OfflineUpload] Failed to parse queue:', e);
    return [];
  }
}

function writeAllItems(items: OfflineUploadItem[]): void {
  storage.set(STORAGE_KEY, JSON.stringify(items));
  notifyQueue();
}

const isMine = (item: OfflineUploadItem): boolean =>
  !item.ownerId || isOwnedBy(item.ownerId, getSessionOwner());

/** The signed-in rep's items (parked ones included, so the UI can still show them). */
export function getUploadQueue(): OfflineUploadItem[] {
  return readAllItems().filter(isMine);
}

/**
 * ⚠️ Read-modify-write against the FRESH list. The sync loop used to save a snapshot taken
 * before it started, which erased anything enqueued while it was running.
 */
function updateItem(id: string, fn: (item: OfflineUploadItem) => OfflineUploadItem): void {
  writeAllItems(readAllItems().map((i) => (i.id === id ? fn(i) : i)));
}

function removeItem(id: string): void {
  writeAllItems(readAllItems().filter((i) => i.id !== id));
}

/** What the background drain is still responsible for: mine, not parked, and past its backoff. */
export function pendingInstallerUploadCount(): number {
  if (!hasSession()) return 0;
  const now = Date.now();
  return getUploadQueue().filter((i) => isDue(i, now)).length;
}

export function getParkedInstallerUploads(): OfflineUploadItem[] {
  return getUploadQueue().filter((i) => !!i.parkedAt);
}

export function retryInstallerUpload(id?: string): number {
  let touched = 0;
  writeAllItems(
    readAllItems().map((i) => {
      if (!isMine(i) || !i.parkedAt || (id && i.id !== id)) return i;
      touched += 1;
      return rearmItem(i);
    })
  );
  if (touched) void processUploadQueue();
  return touched;
}

export async function discardInstallerUpload(id: string): Promise<void> {
  const item = getUploadQueue().find((i) => i.id === id);
  if (!item) return;
  removeItem(id);
  await cleanupItemFiles(item);
}

export async function enqueueOfflineUpload(params: {
  jobNumber: string;
  companyId: string;
  houseNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  price: string | number;
  installationDate: string;
  type: 'before' | 'after';
  images: Array<{ uri: string; type?: string; fileName?: string }>;
}): Promise<void> {
  await ensureOfflineDirExists();
  const itemId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const files: OfflineUploadFile[] = [];

  for (let i = 0; i < params.images.length; i++) {
    const img = params.images[i];
    if (!img.uri) continue;

    const fileExt = img.fileName?.split('.').pop() || 'jpg';
    const destFileName = `${itemId}_file_${i}.${fileExt}`;
    const destPath = `${OFFLINE_DIR}/${destFileName}`;

    try {
      let srcPath = img.uri;
      if (Platform.OS === 'ios' && srcPath.startsWith('file://')) {
        srcPath = srcPath.replace('file://', '');
      }
      await RNFS.copyFile(srcPath, destPath);
      files.push({
        localPath: destPath,
        type: img.type || 'image/jpeg',
        name: img.fileName || `image_${i}.jpg`,
      });
    } catch (err) {
      console.error('[OfflineUpload] Failed to copy file:', img.uri, err);
    }
  }

  if (files.length === 0) {
    throw new Error('No files could be saved offline.');
  }

  const newItem: OfflineUploadItem = {
    id: itemId,
    jobNumber: params.jobNumber,
    companyId: params.companyId,
    houseNumber: params.houseNumber,
    streetName: params.streetName,
    city: params.city,
    state: params.state,
    zip: params.zip,
    price: params.price,
    installationDate: params.installationDate,
    type: params.type,
    files,
    timestamp: Date.now(),
    ownerId: getSessionOwner() || undefined,
  };

  writeAllItems([...readAllItems(), newItem]);

  console.log(`[OfflineUpload] Successfully enqueued upload item ${itemId} with ${files.length} images.`);
}

export function isUploadQueueSyncing(): boolean {
  return isSyncing;
}

export async function processUploadQueue(onItemProcessed?: (itemId: string, success: boolean) => void): Promise<void> {
  if (isSyncing) return;
  const queue = getUploadQueue().filter((i) => isDue(i));
  if (queue.length === 0) return;

  if (!hasSession()) return;

  if (!isOnline()) {
    console.log('[OfflineUpload] Offline, skipping sync.');
    return;
  }

  isSyncing = true;
  console.log(`[OfflineUpload] Sync starting. ${queue.length} item(s) in queue.`);

  for (const item of queue) {
    if (!isOnline()) break;
    console.log(`[OfflineUpload] Uploading item ${item.id} (${item.type} images)...`);
    try {
      const formData = new FormData();
      formData.append('jobNumber', item.jobNumber);
      formData.append('companyId', item.companyId);
      formData.append('houseNumber', item.houseNumber || '');
      formData.append('streetName', item.streetName || '');
      formData.append('city', item.city || '');
      formData.append('state', item.state || '');
      formData.append('zip', item.zip || '');
      formData.append('price', item.price || 0);
      formData.append('installationDate', item.installationDate || '');

      let allFilesExist = true;
      for (const file of item.files) {
        const exists = await RNFS.exists(file.localPath);
        if (!exists) {
          console.warn(`[OfflineUpload] Local file missing: ${file.localPath}`);
          allFilesExist = false;
          break;
        }

        let uploadUri = file.localPath;
        if (!uploadUri.startsWith('file://')) {
          uploadUri = `file://${uploadUri}`;
        }

        formData.append('files', {
          uri: uploadUri,
          type: file.type,
          name: file.name,
        } as any);
      }

      if (!allFilesExist) {
        console.warn(`[OfflineUpload] Skipping item ${item.id} due to missing local files.`);
        await cleanupItemFiles(item);
        removeItem(item.id);
        onItemProcessed?.(item.id, false);
        continue;
      }

      const response =
        item.type === 'before'
          ? await LeadService.updateBeforeImages(formData)
          : await LeadService.updateAfterImages(formData);

      if (response && response.data) {
        console.log(`[OfflineUpload] Successfully uploaded item ${item.id} to S3.`);
        await cleanupItemFiles(item);
        removeItem(item.id);

        DeviceEventEmitter.emit('OFFLINE_UPLOAD_SUCCESS', { jobNumber: item.jobNumber });
        
        onItemProcessed?.(item.id, true);
      } else {
        throw new Error('Invalid response structure received.');
      }
    } catch (err) {
      console.error(`[OfflineUpload] Failed to process item ${item.id}:`, err);
      // Session gone or signal lost: not this item's fault, so it spends no attempt.
      if (isUnauthorizedError(err) || !isOnline()) break;
      // ⚠️ One bad item used to `break` the whole loop and block every item behind it forever.
      // Back it off (and park it eventually) and carry on with the rest.
      const reason = (err as any)?.message;
      updateItem(item.id, (current) =>
        afterFailure(current, MAX_INSTALLER_ATTEMPTS, {
          error: reason ? String(reason) : undefined,
          backoff: installerBackoffMs,
        })
      );
    }
  }

  isSyncing = false;
  console.log(`[OfflineUpload] Sync processing iteration complete. ${getUploadQueue().length} item(s) remaining.`);
}

async function cleanupItemFiles(item: OfflineUploadItem): Promise<void> {
  for (const file of item.files) {
    try {
      const exists = await RNFS.exists(file.localPath);
      if (exists) {
        await RNFS.unlink(file.localPath);
        console.log(`[OfflineUpload] Deleted local file: ${file.localPath}`);
      }
    } catch (e) {
      console.error(`[OfflineUpload] Failed to delete file: ${file.localPath}`, e);
    }
  }
}

export function startOfflineSyncTimer(): void {
  if (syncInterval) return;

  console.log('[OfflineUpload] Starting offline sync (reconnect-driven + 60s safety net).');
  processUploadQueue();

  unsubscribeReconnect = onReconnect(() => {
    console.log('[OfflineUpload] Connectivity returned — draining queue.');
    processUploadQueue();
  });

  syncInterval = setInterval(() => {
    processUploadQueue();
  }, 60000);
}

export function stopOfflineSyncTimer(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  unsubscribeReconnect?.();
  unsubscribeReconnect = null;
  console.log('[OfflineUpload] Stopped offline sync.');
}

export function getOfflineImagesForJob(jobNumber: string, type: 'before' | 'after'): Array<{ uri: string; isExisting: boolean; isOfflinePending: boolean; index: number }> {
  if (!jobNumber) return [];
  const queue = getUploadQueue();
  const jobItems = queue.filter((item) => item.jobNumber === jobNumber && item.type === type);
  const uris: Array<{ uri: string; isExisting: boolean; isOfflinePending: boolean; index: number }> = [];

  jobItems.forEach((item) => {
    item.files.forEach((file) => {
      let displayUri = file.localPath;
      if (!displayUri.startsWith('file://')) {
        displayUri = `file://${displayUri}`;
      }
      uris.push({
        uri: displayUri,
        isExisting: true, // We treat enqueued images as existing so they are display-only and cannot be re-uploaded
        isOfflinePending: true,
        index: -1,
      });
    });
  });

  return uris;
}
