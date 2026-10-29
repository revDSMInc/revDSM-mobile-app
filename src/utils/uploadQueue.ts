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
import { adoptLocalFileAsCached, forgetWarmedUri } from './imageFileCache';
import { resolveS3Url } from './s3-utils';
import {
  PendingPhotoLog,
  buildPhotoLogDetails,
  photoLogReady,
  removePending,
  upsertPending,
} from './pending-photo-log';
import { isCacheFile } from './image-cache-policy';
import { trackLeadPhotoUrls } from '../services/leadPhotoIndex';
import {
  MAX_PHOTO_ATTEMPTS,
  isUnauthorizedError,
} from './upload-retry-policy';
import {
  afterFreeFailure,
  classifyTransferFailure,
  clearFreeFailure,
  isFreeFailure,
  makeDueNow,
} from './transfer-failure';
import {
  IDEMPOTENCY_FIELD,
  isDuplicateUploadResponse,
  isIdempotentReplay,
  photoIdempotencyKey,
} from './upload-idempotency';
import { pruneRecentlyCompleted } from './photo-upload-progress';
import { writeAnnotationDocsCache } from './annotation-docs-cache';

export interface RecentlyCompletedUpload {
  leadId: string;
  categoryName: string;
  subcategory: string;
  userId?: string;
  completedAt: number;
}

/**
 * An annotated photo riding the queue (services/annotationSaveService.ts). `new` = PUT a fresh "(Annotated)" photo and
 * link its marks to the original; `reedit` = PATCH the existing annotated copy in place (one annotated photo per base).
 */
export interface UploadQueueAnnotation {
  mode: 'new' | 'reedit';
  /** The mobile annotation JSON (utils/annotation-restore.ts) stored on the server beside the image. */
  annotationData: any;
  /** `_id` of the clean ORIGINAL photo. */
  salesPhotoId?: string | null;
  /** reedit: `_id` / s3url / bucket of the annotated copy being overwritten. */
  existingAnnotationId?: string | null;
  existingS3url?: string | null;
  existingBucket?: string | null;
  /** reedit: remote urls whose cached bytes are stale once the image is overwritten. */
  staleUris?: string[];
}

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
  annotation?: UploadQueueAnnotation;
  /**
   * Free-failure streak (see utils/transfer-failure.ts). A timeout / reset / gateway error on a
   * weak cellular link says nothing about the PHOTO, so it spends no `retryCount`: the item waits
   * until `nextAttemptAt` (exponential backoff + jitter) and is only parked after a full day of
   * failing. `canDrain` skips an item that is still waiting.
   */
  transientSince?: number;
  transientCount?: number;
  nextAttemptAt?: number;
}

const PENDING_PHOTO_LOGS_KEY = 'pending_photo_logs';

class UploadQueueManager {
  private queue: UploadQueueItem[] = [];
  private recentlyCompleted: RecentlyCompletedUpload[] = [];
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

  /**
   * ⚠️ Slots whose upload finished but whose server row has not appeared yet.
   *
   * `refetchQueries` is awaited before the item is dropped, but it can still resolve with a
   * list that does not include the new photo (read-after-write lag on a slow cell). For that
   * window the photo is in neither the queue nor `salesPhotos`, and any count built from
   * those two alone dips. Counting these keeps it monotonic. Bounded by
   * RECENTLY_COMPLETED_TTL_MS so a row that never arrives stops being claimed.
   */
  public getRecentlyCompleted(): RecentlyCompletedUpload[] {
    this.recentlyCompleted = pruneRecentlyCompleted(this.recentlyCompleted);
    return this.recentlyCompleted.filter((r) => isOwnedBy(r.userId, getSessionOwner()));
  }

  public getActiveUploadId(): string | null {
    return this.activeUploadId;
  }

  private canDrain(i: UploadQueueItem): boolean {
    return (
      !isClientId(i.leadId) &&
      !i.parkedAt &&
      (i.nextAttemptAt ?? 0) <= Date.now() &&
      this.ownedByCurrentSession(i)
    );
  }

  /**
   * A real reconnect / return to the foreground: every photo that was backing off is due now.
   * (The backoff protects a link that is still bad; a link that just came back is a new fact.)
   */
  public releaseWaiting(): void {
    let touched = false;
    this.queue = this.queue.map((item) => {
      const next = makeDueNow(item);
      if (next !== item) touched = true;
      return next;
    });
    if (touched) this.saveQueue();
  }

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Wake the drain when the earliest backing-off photo becomes due (the 60 s sweep is the net). */
  private scheduleNextRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const now = Date.now();
    const waits = this.queue
      .filter((i) => !i.parkedAt && this.ownedByCurrentSession(i) && (i.nextAttemptAt ?? 0) > now)
      .map((i) => (i.nextAttemptAt as number) - now);
    if (!waits.length) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processQueue();
    }, Math.max(1000, Math.min(...waits)));
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
      return {
        ...clearFreeFailure(item),
        retryCount: 0,
        parkedAt: undefined,
        lastError: undefined,
      };
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

        // ⚠️ Recorded BEFORE the item leaves the queue: `removeItem` notifies listeners, and a
        // listener that ran between the removal and this record would see the dip we are
        // fixing.
        this.recentlyCompleted = [
          ...pruneRecentlyCompleted(this.recentlyCompleted),
          {
            leadId: activeItem.leadId,
            categoryName: activeItem.categoryName,
            subcategory: activeItem.subcategory,
            userId: activeItem.userId,
            completedAt: Date.now(),
          },
        ];

        this.removeItem(activeItem.id);
        this.saveQueue();
        this.cleanupPersistedFile(activeItem); // fire-and-forget: delete the durable copy
        console.log(`[UploadQueue] Upload success: ${activeItem.id}`);
      } catch (error) {
        if ((error as any)?.localFileMissing) {
          // ⚠️ PARK, never drop. This used to delete the item with only a console line, so a photo
          // taken at a door vanished without the rep ever being told. A parked item stays on the
          // Pending Uploads screen with its reason, where the rep can re-take or remove it.
          console.warn(`[UploadQueue] Local file missing for ${activeItem.id}; parking (photo must be re-taken).`);
          const at = this.queue.findIndex((i) => i.id === activeItem.id);
          if (at !== -1) {
            this.queue[at] = {
              ...activeItem,
              parkedAt: new Date().toISOString(),
              lastError: 'The photo file is no longer on this device. Re-take it, or remove this entry.',
            };
          }
          this.saveQueue();
          continue;
        }
        if (!this.checkOnline()) {
          console.log('[UploadQueue] Connection lost during upload. Will resume on reconnect.');
          break;
        }
        /**
         * ⚠️ A duplicate-key rejection means the photo IS stored. Treat it as a success and
         * drop the item - parking it would tell the rep a safely-stored photo had failed, and
         * leave them retaking a door they already shot.
         */
        if (isDuplicateUploadResponse(error)) {
          console.log(`[UploadQueue] ${activeItem.id} already stored server-side; completing.`);
          this.removeItem(activeItem.id);
          this.saveQueue();
          this.cleanupPersistedFile(activeItem);
          try {
            queryClient.invalidateQueries({ queryKey: ['leads'] });
            await queryClient.refetchQueries({ queryKey: ['lead', activeItem.leadId] });
          } catch {}
          continue;
        }
        if (isUnauthorizedError(error)) {
          // The session is gone, not the photo. Keep it, spend no attempt, and stop: the next
          // login (same rep) drains it.
          console.log('[UploadQueue] Session expired during upload. Pausing; the photo is kept.');
          break;
        }

        /**
         * ⚠️ A failure that says nothing about the PHOTO (timeout, reset, DNS/TLS, 408/429, 5xx,
         * a carrier's 403) is NOT an attempt. Spending one per failure parked a good photo after
         * ~30 s of a weak cellular link. Keep it, back off with jitter, and stop this pass: the
         * rest of the queue would hit the same dead link. It is parked only after a day of this.
         */
        const failure = classifyTransferFailure(error);
        if (isFreeFailure(failure)) {
          const reason = (error as any)?.message;
          const at = this.queue.findIndex((i) => i.id === activeItem.id);
          if (at !== -1) {
            this.queue[at] = afterFreeFailure(activeItem, {
              error: reason ? String(reason) : undefined,
            });
          }
          this.saveQueue();
          console.log(
            `[UploadQueue] ${failure} failure for ${activeItem.id}; keeping it and backing off (no attempt spent).`
          );
          this.scheduleNextRetry();
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

    if (item.annotation?.mode === 'reedit' && item.annotation.existingAnnotationId) {
      await this.uploadAnnotationEdit(item, isLocalFile);
      return;
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
    if (item.annotation) {
      // Links the marks to the clean original so the copy can be re-edited later (the field web sends too).
      formData.append(
        'annotations',
        JSON.stringify([
          item.annotation.salesPhotoId
            ? { salesPhotoId: item.annotation.salesPhotoId, annotationData: item.annotation.annotationData }
            : null,
        ]),
      );
    }
    formData.append('category', 'salesPhotos');

    /**
     * ⚠️ Derived from `item.id`, which is minted once at enqueue and persisted to MMKV - so
     * every retry of this photo, including one after an app restart days later, sends the SAME
     * key. A key regenerated per attempt would not deduplicate anything.
     */
    const idempotencyKey = photoIdempotencyKey(item);
    if (idempotencyKey) formData.append(IDEMPOTENCY_FIELD, idempotencyKey);

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

    const response = await LeadService.uploadImages(item.leadId, formData, idempotencyKey);

    if (isIdempotentReplay(response)) {
      // The server recognised an earlier delivery of this exact photo. The timeout that made us
      // retry was a lie; nothing new was stored. Treated as success - that is the whole point.
      console.log(`[UploadQueue] ${item.id} was already stored (idempotent replay).`);
    }

    this.recordPhotoLog(item, response, coords, existingUrls);

    try {
      const uploaded = this.matchUploadedPhoto(response, item, existingUrls);
      const uploadedUrl = uploaded?.secureUrl || resolveS3Url(uploaded?.s3url);
      if (uploadedUrl && (await adoptLocalFileAsCached(item.uri, uploadedUrl))) {
        trackLeadPhotoUrls(item.leadId, [uploadedUrl]);
      }
      if (item.annotation && uploaded?.s3url) await this.adoptUnderEveryUrlForm(item.uri, uploaded.s3url, uploaded.bucketName);
      if (item.annotation && uploaded?.s3url) trackLeadPhotoUrls(item.leadId, [resolveS3Url(uploaded.s3url)]);
    } catch (adoptErr) {
      console.warn('[UploadQueue] Could not adopt local file into image cache:', adoptErr);
    }

    /**
     * ⚠️ The refetch is AWAITED before `processQueue` removes the item, so the photo is never
     * in neither set. Reported as "I uploaded 4 images, during uploading it becomes 3, then a
     * second later 4 again": the count is `server photos + queued items`, and the moment the
     * queue item is dropped while the server list is still stale, the photo belongs to
     * neither and the number falls.
     *
     * ⚠️ Do not make this fire-and-forget to "speed up the drain". The await IS the fix, and
     * on a slow cell the window it closes is seconds long, not milliseconds.
     *
     * ⚠️ `refetchQueries` can still resolve with a server list that does not yet include this
     * photo (read-after-write lag). That residual flicker is covered on the UI side by
     * `utils/photo-upload-progress.ts`, which counts a just-drained slot until the server row
     * appears - the two fixes are complementary, not alternatives.
     */
    try {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      if (item.annotation) await this.refreshAnnotationDocs(item.leadId);
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

  /**
   * REVUIUX-571: the saved annotation docs (marks + undo/redo steps) are what a re-edit restores from. They are re-read and re-stored
   * the moment an annotation lands, so reopening the photo (even offline, or after a restart) finds the marks and steps just saved
   * instead of a stale list that has none. Best effort - the photo is already saved.
   */
  private async refreshAnnotationDocs(leadId: string): Promise<void> {
    try {
      const data = (await LeadService.getAnnotations(leadId)).data;
      writeAnnotationDocsCache(leadId, data);
      queryClient.setQueryData(['leadAnnotations', leadId], data);
    } catch (e) {
      console.warn('[UploadQueue] Could not refresh the annotation docs:', e);
      queryClient.invalidateQueries({ queryKey: ['leadAnnotations', leadId] });
    }
  }

  /**
   * Re-edit of an annotated photo: PATCH overwrites the existing annotated image in place - no new row, so no
   * idempotency key is needed (a replay writes the same bytes again).
   *
   * ⚠️ Same s3url + same file name = same local cache path, so the old bytes would keep showing: the stale urls are
   * forgotten and the signed-url / lead queries refreshed.
   */
  private async uploadAnnotationEdit(item: UploadQueueItem, isLocalFile: boolean): Promise<void> {
    const ann = item.annotation!;
    const formData = new FormData();
    formData.append('file', {
      uri: isLocalFile ? this.toFileUri(item.uri) : item.uri,
      type: item.type,
      name: item.name,
    } as any);
    formData.append('annotationData', JSON.stringify(ann.annotationData));

    await LeadService.upsertAnnotation(item.leadId, ann.existingAnnotationId as string, formData);

    try {
      await Promise.all((ann.staleUris || []).map((u) => forgetWarmedUri(u)));
      // The cache path ignores the signature, so the NEW bytes go straight in under the same key: the card then paints
      // the edited photo from disk the instant the lead refreshes, with no download and no loader.
      const sameKeyUrl = (ann.staleUris || [])[0];
      if (sameKeyUrl) await adoptLocalFileAsCached(item.uri, sameKeyUrl);
      if (ann.existingS3url) {
        await this.adoptUnderEveryUrlForm(item.uri, ann.existingS3url, ann.existingBucket || undefined);
      }
    } catch {}
    try {
      queryClient.invalidateQueries({ queryKey: ['secureUrls'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      await this.refreshAnnotationDocs(item.leadId);
      await queryClient.refetchQueries({ queryKey: ['lead', item.leadId] });
    } catch (qcErr) {
      console.warn('[UploadQueue] Failed to refresh queries after an annotation edit:', qcErr);
    }

    if (item.userId) {
      logEvent('update', {
        user_id: item.userId,
        module_type: 'annotated_photos',
        created_by: item.userId,
        meta: {
          leadId: item.leadId,
          category: item.categoryName,
          subcategory: item.subcategory,
          occurredAt: item.timestamp,
          action: 'annotated_photo_updated',
          image_url: ann.existingS3url || '',
          imageData: {
            s3url: ann.existingS3url || '',
            bucketName: ann.existingBucket || '',
            category: item.categoryName,
            subcategory: item.subcategory,
            timestampTaken: item.timestamp,
          },
        },
      });
    }
  }

  /**
   * ⚠️ The card that takes over from a just-uploaded annotation first paints from the RAW s3 url
   * (`useDynamicInspectionCapture` uses `resolveS3Url` "so the tile never sits empty") and then from the SIGNED one. The
   * image cache is keyed by url (query dropped), and those two forms can differ, so the local JPEG is stored under BOTH
   * before the queue item - and with it the local file - is dropped. Any form left out is a download, i.e. a flicker.
   */
  private async adoptUnderEveryUrlForm(localUri: string, s3url: string, bucketName?: string): Promise<void> {
    try {
      await adoptLocalFileAsCached(localUri, resolveS3Url(s3url));
      const res = await LeadService.getSecureUrls([{ bucketName: bucketName || '', filePath: s3url }]);
      const data = res?.data?.data || res?.data || [];
      const entry = Array.isArray(data) ? data.find((d: any) => d?.filePath === s3url) || data[0] : null;
      const signed = entry?.secureUrl || entry?.url;
      if (signed) await adoptLocalFileAsCached(localUri, signed);
    } catch (e) {
      console.warn('[UploadQueue] Could not warm the cache under every url form:', e);
    }
  }

  private matchUploadedPhoto(response: any, item: UploadQueueItem, existingUrls: Set<string>): any | null {
    const rows = response?.data?.salesPhotos || response?.data?.data?.salesPhotos || [];
    return Array.isArray(rows) ? this.pickUploadedPhoto(rows, item, existingUrls) : null;
  }

  /**
   * ⚠️ Matched on the `timestampTaken` the upload SENT first. A photo that was queued offline keeps
   * its own capture time, and the server stores it verbatim, so it names this exact photo whatever
   * else is on the lead. The category/subcategory + "not there before" rule alone picked the wrong
   * row (or none) when the pre-upload fetch failed - `existingUrls` was then empty - or when several
   * photos share a slot, and the log went out with an empty image.
   */
  private pickUploadedPhoto(rows: any[], item: UploadQueueItem, existingUrls: Set<string>): any | null {
    const sameSlot = (p: any) =>
      p?.category?.toLowerCase() === item.categoryName?.toLowerCase() &&
      p?.subcategory?.toLowerCase() === item.subcategory?.toLowerCase();
    const sentAt = Date.parse(String(item.timestamp || ''));
    const sameMoment = (p: any) => {
      const at = Date.parse(String(p?.timestampTaken || ''));
      return !Number.isNaN(sentAt) && !Number.isNaN(at) && at === sentAt;
    };
    const withUrl = [...rows].reverse().filter((p: any) => p?.s3url);
    return (
      withUrl.find((p: any) => sameSlot(p) && sameMoment(p)) ||
      withUrl.find((p: any) => sameSlot(p) && !existingUrls.has(p.s3url)) ||
      null
    );
  }

  /**
   * ⚠️ Recorded DURABLY before the queue item is removed (see utils/pending-photo-log.ts). The log used to
   * be built in a fire-and-forget call that waited in memory for the server row, so closing or losing the
   * app right after an offline sync lost it while the photo arrived.
   */
  private recordPhotoLog(
    item: UploadQueueItem,
    response: any,
    coords: { latitude: number; longitude: number },
    existingUrls: Set<string>
  ) {
    if (!item.userId) return;
    const immediate = this.matchUploadedPhoto(response, item, existingUrls);
    const entry: PendingPhotoLog = {
      id: item.id,
      userId: item.userId,
      leadId: item.leadId,
      categoryName: item.categoryName,
      subcategory: item.subcategory,
      timestamp: item.timestamp,
      coordinates: coords,
      existingUrls: Array.from(existingUrls),
      s3url: immediate?.s3url || '',
      bucketName: immediate?.bucketName || '',
      lookups: 0,
    };
    this.savePendingPhotoLogs(upsertPending(this.readPendingPhotoLogs(), entry));
    void this.settlePhotoLogs();
  }

  private readPendingPhotoLogs(): PendingPhotoLog[] {
    try {
      const saved = storage.getString(PENDING_PHOTO_LOGS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private savePendingPhotoLogs(list: PendingPhotoLog[]) {
    try {
      storage.set(PENDING_PHOTO_LOGS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[UploadQueue] Failed to save pending photo logs:', e);
    }
  }

  public hasPendingPhotoLogsFor(leadId: string): boolean {
    return this.readPendingPhotoLogs().some((p) => p.leadId === leadId);
  }

  public hasPendingPhotoLogs(): boolean {
    return this.readPendingPhotoLogs().some((p) => isOwnedBy(p.userId, getSessionOwner()));
  }

  private settling = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * One lookup per pending log per pass. A log whose image url is known (or whose passes ran out) is
   * handed to `logEvent`, which holds it durably when offline; only then is the record removed.
   */
  public async settlePhotoLogs(): Promise<void> {
    if (this.settling) return;
    this.settling = true;
    let waiting = false;
    try {
      const mine = this.readPendingPhotoLogs().filter((p) => isOwnedBy(p.userId, getSessionOwner()));
      for (const record of mine) {
        let current = record;
        if (!photoLogReady(current)) {
          if (!isOnline()) {
            waiting = true;
            continue;
          }
          try {
            const leadRes = await LeadService.workLead(current.leadId, current.userId);
            const lead = leadRes.data?.data || leadRes.data;
            const rows = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
            const matched = this.pickUploadedPhoto(
              rows,
              {
                categoryName: current.categoryName,
                subcategory: current.subcategory,
                timestamp: current.timestamp,
              } as UploadQueueItem,
              new Set(current.existingUrls)
            );
            current = {
              ...current,
              lookups: current.lookups + 1,
              s3url: matched?.s3url || '',
              bucketName: matched?.bucketName || '',
            };
          } catch (err) {
            // Not a spent pass: the lookup itself failed (no signal), the photo is still unlogged.
            console.warn('[UploadQueue] Photo lookup for the activity log failed:', err);
            waiting = true;
            continue;
          }
          if (!photoLogReady(current)) {
            this.savePendingPhotoLogs(upsertPending(this.readPendingPhotoLogs(), current));
            waiting = true;
            continue;
          }
          if (!current.s3url) {
            console.warn(`[UploadQueue] Could not find the uploaded photo for ${current.id}; logging it without an image url`);
          }
        }
        try {
          await logEvent('add', buildPhotoLogDetails(current));
          this.savePendingPhotoLogs(removePending(this.readPendingPhotoLogs(), current.id));
        } catch (logErr) {
          console.warn('[UploadQueue] Analytics logging failed; will retry:', logErr);
          waiting = true;
        }
      }
    } finally {
      this.settling = false;
    }
    if (waiting) this.scheduleSettle();
  }

  private scheduleSettle() {
    if (this.settleTimer) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.settlePhotoLogs();
    }, 5000);
  }
}

export const uploadQueueManager = new UploadQueueManager();

registerSessionResetHook(() => uploadQueueManager.resetForNewSession());

let photoSyncStarted = false;

const PHOTO_RETRY_SWEEP_MS = 60_000;

export const startPhotoQueueSync = (): void => {
  if (photoSyncStarted) return;
  photoSyncStarted = true;

  onReconnect(() => {
    uploadQueueManager.releaseWaiting();
    void uploadQueueManager.processQueue();
    void uploadQueueManager.settlePhotoLogs();
  });

  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    uploadQueueManager.releaseWaiting();
    void uploadQueueManager.processQueue();
    void uploadQueueManager.settlePhotoLogs();
  });

  setInterval(() => {
    if (!isOnline()) return;
    if (uploadQueueManager.hasPendingPhotoLogs()) void uploadQueueManager.settlePhotoLogs();
    if (!uploadQueueManager.hasUploadableWork()) return;
    uploadQueueManager.processQueue();
  }, PHOTO_RETRY_SWEEP_MS);

  uploadQueueManager.processQueue();
  // A log recorded before the app was closed is finished on the next launch.
  void uploadQueueManager.settlePhotoLogs();
};
