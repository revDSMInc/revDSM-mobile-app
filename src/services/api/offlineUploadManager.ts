import { Platform, DeviceEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import { storage } from '../../utils/storage';
import { hasSession } from './index';
import { LeadService } from './leads';
import { isOnline, onReconnect, refreshConnectivity } from '../connectivity';

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

export function getUploadQueue(): OfflineUploadItem[] {
  const data = storage.getString(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('[OfflineUpload] Failed to parse queue:', e);
    return [];
  }
}

function saveUploadQueue(queue: OfflineUploadItem[]): void {
  storage.set(STORAGE_KEY, JSON.stringify(queue));
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
  };

  const queue = getUploadQueue();
  queue.push(newItem);
  saveUploadQueue(queue);

  console.log(`[OfflineUpload] Successfully enqueued upload item ${itemId} with ${files.length} images.`);
}

export function isUploadQueueSyncing(): boolean {
  return isSyncing;
}

export async function processUploadQueue(onItemProcessed?: (itemId: string, success: boolean) => void): Promise<void> {
  if (isSyncing) return;
  const queue = getUploadQueue();
  if (queue.length === 0) return;

  if (!hasSession()) return;

  if (!isOnline()) {
    console.log('[OfflineUpload] Offline, skipping sync.');
    return;
  }

  isSyncing = true;
  console.log(`[OfflineUpload] Sync starting. ${queue.length} item(s) in queue.`);

  let remainingQueue = [...queue];

  for (const item of queue) {
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
        remainingQueue = remainingQueue.filter((q) => q.id !== item.id);
        saveUploadQueue(remainingQueue);
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
        remainingQueue = remainingQueue.filter((q) => q.id !== item.id);
        saveUploadQueue(remainingQueue);
        
        DeviceEventEmitter.emit('OFFLINE_UPLOAD_SUCCESS', { jobNumber: item.jobNumber });
        
        onItemProcessed?.(item.id, true);
      } else {
        throw new Error('Invalid response structure received.');
      }
    } catch (err) {
      console.error(`[OfflineUpload] Failed to process item ${item.id}:`, err);
      break;
    }
  }

  isSyncing = false;
  console.log(`[OfflineUpload] Sync processing iteration complete. ${remainingQueue.length} item(s) remaining.`);
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
