import { storage } from './storage';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { LeadService } from '../services/api/leads';
import { logEvent } from '../services/api/LoggerService';
import { queryClient } from '../services/api/queryClient';
import { isClientId } from './offline-lead-work';
import { AppState } from 'react-native';
import { isOnline, onReconnect } from '../services/connectivity';
import { getSessionOwner, registerSessionResetHook } from '../services/sessionScope';
import { isOwnedBy } from './session-scope';
import { adoptLocalFileAsCached } from './imageFileCache';
import { resolveS3Url } from './s3-utils';
import { isCacheFile } from './image-cache-policy';
import {
  MAX_PHOTO_ATTEMPTS,
  isUnauthorizedError,
} from './upload-retry-policy';

export interface UploadQueueItem {
  id: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  uri: string;
  type: string;
  name: string;
  timestamp: string;
  coordinates?: { latitude: number; longitude: number };
  retryCount?: number;
  userId?: string;
  /**
   * Set once the item has failed MAX_PHOTO_ATTEMPTS times. A parked photo is KEPT (file and
   * all) and skipped by the drain until the rep retries or discards it - it used to be dropped,
   * which silently destroyed a photo taken at a door.
   */
  parkedAt?: string;
  lastError?: string;
}

class UploadQueueManager {
  private queue: UploadQueueItem[] = [];
  private isProcessing = false;
  private activeUploadId: string | null = null;
  private onQueueChangeListeners: (() => void)[] = [];

  constructor() {
    this.loadQueue();
  }

  private loadQueue() {
    try {
      const saved = storage.getString('upload_photo_queue');
      if (saved) {
        this.queue = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('[UploadQueue] Failed to load upload queue from MMKV:', e);
      this.queue = [];
    }
  }

  private saveQueue() {
    try {
      storage.set('upload_photo_queue', JSON.stringify(this.queue));
      this.notifyListeners();
    } catch (e) {
      console.warn('[UploadQueue] Failed to save upload queue to MMKV:', e);
    }
  }

  private ownedByCurrentSession(item: UploadQueueItem): boolean {
    return isOwnedBy(item.userId, getSessionOwner());
  }

  public getQueue() {
    return this.queue.filter((i) => this.ownedByCurrentSession(i));
  }

  public getActiveUploadId(): string | null {
    return this.activeUploadId;
  }

  private canDrain(i: UploadQueueItem): boolean {
    return !isClientId(i.leadId) && !i.parkedAt && this.ownedByCurrentSession(i);
  }

  public hasUploadableWork(): boolean {
    return this.queue.some((i) => this.canDrain(i));
  }

  public uploadableCount(): number {
    return this.queue.filter((i) => this.canDrain(i)).length;
  }

  /** Everything the background drain is still responsible for (parked items are NOT: they wait for the rep). */
  public heldCount(): number {
    return this.queue.filter((i) => !i.parkedAt && this.ownedByCurrentSession(i)).length;
  }

  public getParked(): UploadQueueItem[] {
    return this.queue.filter((i) => !!i.parkedAt && this.ownedByCurrentSession(i));
  }

  public parkedCount(): number {
    return this.getParked().length;
  }

  /** Manual retry of one parked photo (or all of them when no id is given). */
  public retryParked(id?: string): number {
    let touched = 0;
    this.queue = this.queue.map((item) => {
      if (!item.parkedAt || !this.ownedByCurrentSession(item)) return item;
      if (id && item.id !== id) return item;
      touched += 1;
      return { ...item, retryCount: 0, parkedAt: undefined, lastError: undefined };
    });
    if (!touched) return 0;
    this.saveQueue();
    this.processQueue();
    return touched;
  }

  public resetForNewSession() {
    this.queue = [];
    this.loadQueue();
    this.isProcessing = false;
    this.activeUploadId = null;
    this.notifyListeners();
  }

  public dropQueuedItem(id: string): boolean {
    if (!id || id === this.activeUploadId) return false;
    const item = this.queue.find((i) => i.id === id);
    if (!item || !this.ownedByCurrentSession(item)) return false;
    this.removeItem(id);
    this.saveQueue();
    this.cleanupPersistedFile(item);
    this.notifyListeners();
    return true;
  }

  private removeItem(id: string) {
    this.queue = this.queue.filter((i) => i.id !== id);
  }

  public rekeyLead(fromLeadId: string, toLeadId: string) {
    if (!fromLeadId || !toLeadId || fromLeadId === toLeadId) return;
    let touched = 0;
    this.queue = this.queue.map((item) => {
      if (item.leadId !== fromLeadId) return item;
      touched += 1;
      return { ...item, leadId: toLeadId, retryCount: 0 };
    });
    if (!touched) return;
    console.log(`[UploadQueue] Re-addressed ${touched} queued photo(s) ${fromLeadId} -> ${toLeadId}`);
    this.saveQueue();
    this.processQueue();
  }

  public dropLead(leadId: string): number {
    if (!leadId) return 0;
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => item.leadId !== leadId);
    const dropped = before - this.queue.length;
    if (!dropped) return 0;
    console.log(`[UploadQueue] Dropped ${dropped} queued photo(s) for deleted lead ${leadId}`);
    this.saveQueue();
    return dropped;
  }

  public addListener(listener: () => void) {
    this.onQueueChangeListeners.push(listener);
    return () => {
      this.onQueueChangeListeners = this.onQueueChangeListeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.onQueueChangeListeners.forEach(l => {
      try { l(); } catch (e) { console.error('[UploadQueue] Listener error:', e); }
    });
  }

  public async addToQueue(item: Omit<UploadQueueItem, 'id' | 'timestamp'>) {
    const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let uri = item.uri;
    try {
      const persisted = await this.persistLocalFile(item.uri, id);
      if (persisted) uri = persisted;
    } catch (e) {
      console.warn('[UploadQueue] Could not persist queued file, using original uri:', e);
    }
    const newItem: UploadQueueItem = {
      ...item,
      uri,
      id,
      userId: item.userId || getSessionOwner() || undefined,
      timestamp: new Date().toISOString(),
    };
    this.queue.push(newItem);
    this.saveQueue();

    this.processQueue();
    return newItem.id;
  }

  private toFsPath(uri: string): string {
    return decodeURIComponent(String(uri || '').replace(/^file:\/\//i, '')).replace(/^\/+/, '/');
  }

  private toFileUri(uri: string): string {
    return `file://${this.toFsPath(uri)}`;
  }

  private async persistLocalFile(uri: string, id: string): Promise<string | null> {
    if (!uri) return null;
    if (/^(https?|content):/i.test(uri)) return null;
    const fs = ReactNativeBlobUtil.fs;
    const src = this.toFsPath(uri);
    if (src.includes('/pending_uploads/') || src.includes('/upload_queue/')) {
      return (await fs.exists(src)) ? this.toFileUri(src) : null;
    }
    try {
      if (!(await fs.exists(src))) return null; // already gone → let uploadItem skip it
      const dir = `${fs.dirs.DocumentDir}/upload_queue`;
      if (!(await fs.exists(dir))) await fs.mkdir(dir);
      const ext = (src.split('/').pop() || '').split('.').pop()?.split('?')[0] || 'jpg';
      const dest = `${dir}/${id}.${ext}`;
      await fs.cp(src, dest);
      return this.toFileUri(dest);
    } catch (e) {
      console.warn('[UploadQueue] persistLocalFile failed:', e);
      return null;
    }
  }

  private async cleanupPersistedFile(item: UploadQueueItem) {
    try {
      const path = this.toFsPath(item.uri);
      const fs = ReactNativeBlobUtil.fs;
      if ((path.includes('/upload_queue/') || path.includes('/pending_uploads/')) && (await fs.exists(path))) {
        await fs.unlink(path);
      }
    } catch {
    }
  }

  private checkOnline(): boolean {
    return isOnline();
  }

  public async processQueue() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;
    this.isProcessing = true;

    console.log(`[UploadQueue] Processing started. Queue length: ${this.queue.length}`);

    if (!this.checkOnline()) {
      console.log('[UploadQueue] Device is offline. Pausing queue processing.');
      this.isProcessing = false;
      this.activeUploadId = null;
      this.notifyListeners();
      return;
    }

    for (;;) {
      const activeIndex = this.queue.findIndex((i) => this.canDrain(i));
      if (activeIndex === -1) break;
      const activeItem = this.queue[activeIndex];
      this.activeUploadId = activeItem.id;
      this.notifyListeners();
      try {
        console.log(`[UploadQueue] Uploading item: ${activeItem.id} for slot: ${activeItem.subcategory}`);
        await this.uploadItem(activeItem);

        this.removeItem(activeItem.id);
        this.saveQueue();
        this.cleanupPersistedFile(activeItem); // fire-and-forget: delete the durable copy
        console.log(`[UploadQueue] Upload success: ${activeItem.id}`);
      } catch (error) {
        if ((error as any)?.localFileMissing) {
          console.warn(`[UploadQueue] Local file missing for ${activeItem.id}; dropping (photo must be re-taken).`);
          this.removeItem(activeItem.id);
          this.saveQueue();
          this.cleanupPersistedFile(activeItem);
          continue;
        }
        if (!this.checkOnline()) {
          console.log('[UploadQueue] Connection lost during upload. Will resume on reconnect.');
          break;
        }
        if (isUnauthorizedError(error)) {
          // The session is gone, not the photo. Keep it, spend no attempt, and stop: the next
          // login (same rep) drains it.
          console.log('[UploadQueue] Session expired during upload. Pausing; the photo is kept.');
          break;
        }

        const retryCount = (activeItem.retryCount || 0) + 1;
        console.warn(`[UploadQueue] Upload failed for item: ${activeItem.id} (attempt ${retryCount}):`, error);

        if (retryCount >= MAX_PHOTO_ATTEMPTS) {
          console.warn(`[UploadQueue] Parking item ${activeItem.id} after ${retryCount} attempts. It is kept on the device.`);
          const at = this.queue.findIndex((i) => i.id === activeItem.id);
          if (at !== -1) {
            const reason = (error as any)?.message;
            this.queue[at] = {
              ...activeItem,
              retryCount,
              parkedAt: new Date().toISOString(),
              lastError: reason ? String(reason) : undefined,
            };
          }
          this.saveQueue();
        } else {
          const at = this.queue.findIndex((i) => i.id === activeItem.id);
          if (at !== -1) this.queue[at] = { ...activeItem, retryCount };
          this.saveQueue();
          const backoffMs = Math.min(3000 * retryCount, 15000);
          console.log(`[UploadQueue] Waiting ${backoffMs}ms before retry...`);
          await new Promise<void>(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    this.isProcessing = false;
    this.activeUploadId = null;
    this.notifyListeners();
    console.log('[UploadQueue] Processing finished.');
  }


  private async uploadItem(item: UploadQueueItem): Promise<void> {
    const coords = item.coordinates || { latitude: 0, longitude: 0 };

    const isLocalFile = !/^(https?|content):/i.test(item.uri);
    if (isLocalFile && !(await ReactNativeBlobUtil.fs.exists(this.toFsPath(item.uri)))) {
      const err: any = new Error('LOCAL_FILE_MISSING');
      err.localFileMissing = true;
      throw err;
    }

    const formData = new FormData();
    formData.append('files', {
      uri: isLocalFile ? this.toFileUri(item.uri) : item.uri,
      type: item.type,
      name: item.name,
    } as any);

    const imageInfo = [
      {
        category: item.categoryName,
        subcategory: item.subcategory,
        timestampTaken: item.timestamp,
        coordinates: coords,
      },
    ];
    formData.append('images', JSON.stringify(imageInfo));
    formData.append('category', 'salesPhotos');

    const existingUrls = new Set<string>();
    const userId = item.userId;
    if (userId) {
      try {
        const beforeLeadRes = await LeadService.workLead(item.leadId, userId);
        const beforeLead = beforeLeadRes.data?.data || beforeLeadRes.data;
        if (beforeLead?.salesPhotos && Array.isArray(beforeLead.salesPhotos)) {
          beforeLead.salesPhotos.forEach((p: any) => {
            if (p.s3url) existingUrls.add(p.s3url);
          });
        }
      } catch (err) {
        console.warn('[UploadQueue] Failed to fetch existing photos before upload:', err);
      }
    }

    const response = await LeadService.uploadImages(item.leadId, formData);

    this.logUploadSuccessAsync(item, response, coords, existingUrls);

    try {
      const uploaded = this.matchUploadedPhoto(response, item, existingUrls);
      const uploadedUrl = uploaded?.secureUrl || resolveS3Url(uploaded?.s3url);
      if (uploadedUrl) await adoptLocalFileAsCached(item.uri, uploadedUrl);
    } catch (adoptErr) {
      console.warn('[UploadQueue] Could not adopt local file into image cache:', adoptErr);
    }

    try {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      await queryClient.refetchQueries({ queryKey: ['lead', item.leadId] });
    } catch (qcErr) {
      console.warn('[UploadQueue] Failed to refresh queries:', qcErr);
    }

    try {
      const cleanPath = item.uri.replace('file://', '');
      const base = cleanPath.split('/').pop() || '';
      const isScratch = /\/(Caches?|tmp)\//i.test(cleanPath);
      const isOwnedByCache = isCacheFile(base);
      const isDurableQueueCopy =
        cleanPath.includes('/upload_queue/') || cleanPath.includes('/pending_uploads/');
      if (isScratch && !isOwnedByCache && !isDurableQueueCopy) {
        await ReactNativeBlobUtil.fs.unlink(cleanPath);
      }
    } catch (cleanupError) {
      console.warn('[UploadQueue] Failed to delete temporary cache file:', cleanupError);
    }
  }

  private matchUploadedPhoto(response: any, item: UploadQueueItem, existingUrls: Set<string>): any | null {
    const rows = response?.data?.salesPhotos || response?.data?.data?.salesPhotos || [];
    if (!Array.isArray(rows)) return null;
    return (
      [...rows].reverse().find(
        (p: any) =>
          p?.category?.toLowerCase() === item.categoryName?.toLowerCase() &&
          p?.subcategory?.toLowerCase() === item.subcategory?.toLowerCase() &&
          p?.s3url &&
          !existingUrls.has(p.s3url)
      ) || null
    );
  }

  private async logUploadSuccessAsync(
    item: UploadQueueItem,
    response: any,
    coords: { latitude: number; longitude: number },
    existingUrls: Set<string>
  ) {
    try {
      const userId = item.userId;
      if (!userId) return;

      const isAnnotated = item.subcategory?.includes('(Annotated)');
      let s3url = '';
      let bucketName = '';

      const immediateMatch = this.matchUploadedPhoto(response, item, existingUrls);

      if (immediateMatch && immediateMatch.s3url) {
        s3url = immediateMatch.s3url;
        bucketName = immediateMatch.bucketName || '';
      } else {
        let refreshAttempt = 0;
        const maxRefreshAttempts = 5;
        let waitTime = 1000;
        let foundPhoto = false;

        while (!foundPhoto && refreshAttempt < maxRefreshAttempts) {
          await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
          try {
            const leadRes = await LeadService.workLead(item.leadId, userId);
            const refreshedLead = leadRes.data?.data || leadRes.data;
            if (refreshedLead?.salesPhotos && Array.isArray(refreshedLead.salesPhotos)) {
              const matched = [...refreshedLead.salesPhotos].reverse().find(
                (p: any) =>
                  p.category?.toLowerCase() === item.categoryName?.toLowerCase() &&
                  p.subcategory?.toLowerCase() === item.subcategory?.toLowerCase() &&
                  p.s3url &&
                  !existingUrls.has(p.s3url)
              );
              if (matched && matched.s3url) {
                s3url = matched.s3url;
                bucketName = matched.bucketName || '';
                foundPhoto = true;
                break;
              }
            }
          } catch (err) {
            console.warn(`[UploadQueue] Refresh attempt ${refreshAttempt + 1} failed:`, err);
          }
          refreshAttempt++;
          waitTime = Math.min(waitTime + 1000, 5000);
        }
      }

      logEvent('add', {
        user_id: userId,
        module_type: isAnnotated ? 'annotated_photos' : 'inspection_photo',
        created_by: userId,
        meta: {
          leadId: item.leadId,
          category: item.categoryName,
          subcategory: item.subcategory,
          timestamp: item.timestamp,
          coordinates: coords,
          size: 0,
          action: isAnnotated ? 'annotated_photo_uploaded' : 'photo_uploaded',
          image_url: s3url,
          imageData: {
            s3url,
            bucketName,
            category: item.categoryName,
            subcategory: item.subcategory,
            timestampTaken: item.timestamp,
            coordinates: coords,
          },
        },
      });
    } catch (logErr) {
      console.warn('[UploadQueue] Analytics logging failed:', logErr);
    }
  }
}

export const uploadQueueManager = new UploadQueueManager();

registerSessionResetHook(() => uploadQueueManager.resetForNewSession());

let photoSyncStarted = false;

const PHOTO_RETRY_SWEEP_MS = 60_000;

export const startPhotoQueueSync = (): void => {
  if (photoSyncStarted) return;
  photoSyncStarted = true;

  onReconnect(() => uploadQueueManager.processQueue());

  AppState.addEventListener('change', (next) => {
    if (next === 'active') uploadQueueManager.processQueue();
  });

  setInterval(() => {
    if (!isOnline()) return;
    if (!uploadQueueManager.hasUploadableWork()) return;
    uploadQueueManager.processQueue();
  }, PHOTO_RETRY_SWEEP_MS);

  uploadQueueManager.processQueue();
};
