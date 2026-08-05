import { Platform, DeviceEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import { storage } from '../../utils/storage';
import { hasSession } from './index';
import { LeadService } from './leads';

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

// Lightweight connection check using fetch ping
export async function checkOnlineStatus(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    // Ping google to verify actual internet access
    await fetch('https://www.google.com', {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return false;
  }
}

// Ensure offline uploads directory exists
async function ensureOfflineDirExists(): Promise<void> {
  const exists = await RNFS.exists(OFFLINE_DIR);
  if (!exists) {
    await RNFS.mkdir(OFFLINE_DIR);
  }
}

// Get the current queue from MMKV
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

// Save queue to MMKV
function saveUploadQueue(queue: OfflineUploadItem[]): void {
  storage.set(STORAGE_KEY, JSON.stringify(queue));
}

// Enqueue a new upload item
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
      // On iOS / Android, handle file uri scheme
      if (Platform.OS === 'ios' && srcPath.startsWith('file://')) {
        srcPath = srcPath.replace('file://', '');
      }
      // Copy to persistent local folder
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

// Process the queue sequential list
export async function processUploadQueue(onItemProcessed?: (itemId: string, success: boolean) => void): Promise<void> {
  if (isSyncing) return;
  const queue = getUploadQueue();
  if (queue.length === 0) return;

  // The timer runs for the whole app lifetime, including while signed out. Uploading
  // then would send every queued item up with no bearer token, spend its retries on
  // 401s, and — before the response interceptor learned to ignore post-logout 401s —
  // put a "Session Expired" banner on the login screen. The queue is durable, so
  // waiting for the next sign-in costs nothing.
  if (!hasSession()) return;

  const isOnline = await checkOnlineStatus();
  if (!isOnline) {
    console.log('[OfflineUpload] Check failed. Still offline, skipping sync.');
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

        // Format uri for Android/iOS Hermes compatibility
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
        // Remove item to avoid loop locks, cleanup any remaining partial files
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
        // Delete local files immediately
        await cleanupItemFiles(item);
        // Remove from persistent queue list
        remainingQueue = remainingQueue.filter((q) => q.id !== item.id);
        saveUploadQueue(remainingQueue);
        
        // Broadcast completion to trigger active UI/modal refreshes silently
        DeviceEventEmitter.emit('OFFLINE_UPLOAD_SUCCESS', { jobNumber: item.jobNumber });
        
        onItemProcessed?.(item.id, true);
      } else {
        throw new Error('Invalid response structure received.');
      }
    } catch (err) {
      console.error(`[OfflineUpload] Failed to process item ${item.id}:`, err);
      // Stop queue processing and retry on next interval (to preserve queue order)
      break;
    }
  }

  isSyncing = false;
  console.log(`[OfflineUpload] Sync processing iteration complete. ${remainingQueue.length} item(s) remaining.`);
}

// Cleanup local image files on successful upload
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

// Start periodic syncing
export function startOfflineSyncTimer(): void {
  if (syncInterval) return;

  console.log('[OfflineUpload] Starting background offline sync timer (15s interval).');
  // Trigger an initial process run
  processUploadQueue();

  syncInterval = setInterval(() => {
    processUploadQueue();
  }, 15000);
}

// Stop sync timer
export function stopOfflineSyncTimer(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[OfflineUpload] Stopped background offline sync timer.');
  }
}

// Get enqueued local images for a specific job & type
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
