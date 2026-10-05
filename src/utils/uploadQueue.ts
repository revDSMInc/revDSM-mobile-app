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

export interface UploadQueueItem {
  id: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  uri: string;
  type: string;
  name: string;
  timestamp: string;
  /**
   * Where the rep STOOD when the shutter fired.
   *
   * ⚠️ Captured at capture time and carried, never re-read at upload. A photo shot at a house
   * and uploaded hours later from the office would otherwise be stamped with the office's
   * coordinates — see `utils/capture-location.ts`. Optional because a photo must still be
   * takeable with location denied or no fix.
   */
  coordinates?: { latitude: number; longitude: number };
  retryCount?: number;
  /**
   * The rep who took the photo — and, since this change, who OWNS it.
   *
   * It was already carried (the upload's `workLead` call and the activity log both read it); what
   * is new is that the queue now FILTERS on it. Field crews share handsets, so without that a
   * photo taken by one rep uploaded under the next rep's session and was logged as theirs.
   */
  userId?: string;
}

class UploadQueueManager {
  private queue: UploadQueueItem[] = [];
  private isProcessing = false;
  /** Id of the item currently being uploaded; drives the per-tile status text. */
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

  /**
   * ⚠️ Only the signed-in rep's photos. See `utils/session-scope.ts` — an item belonging to
   * someone else, or to nobody (queued before ownership existed), is neither shown nor uploaded.
   */
  private ownedByCurrentSession(item: UploadQueueItem): boolean {
    return isOwnedBy(item.userId, getSessionOwner());
  }

  public getQueue() {
    return this.queue.filter((i) => this.ownedByCurrentSession(i));
  }

  /**
   * The id of the item being uploaded right now, or null.
   *
   * Exposed so a photo tile can say "Uploading…" for the one in flight and "Saved on
   * device" for the ones behind it, instead of every queued photo claiming to be
   * uploading. A rep who can see which photo is moving does not assume the app is stuck.
   */
  public getActiveUploadId(): string | null {
    return this.activeUploadId;
  }

  /**
   * Whether anything is actually SENDABLE right now — ours, and not still waiting on a real lead
   * id. Same predicate the drain loop picks its next item with, so the two cannot disagree.
   *
   * Exists so the retry sweep can skip in two in-memory reads on the overwhelming majority of
   * ticks, where the rep has no photos waiting at all.
   */
  public hasUploadableWork(): boolean {
    return this.queue.some((i) => !isClientId(i.leadId) && this.ownedByCurrentSession(i));
  }

  /** How many photos are sendable right now — the background drain's progress measure. */
  public uploadableCount(): number {
    return this.queue.filter((i) => !isClientId(i.leadId) && this.ownedByCurrentSession(i)).length;
  }

  /**
   * Re-read the queue from MMKV when the session changes.
   *
   * ⚠️ Reloads, never just empties. `upload_photo_queue` is in `SESSION_KEEP_KEYS`, so the saved
   * copy SURVIVES a sign-out on purpose — a photo belongs to the rep who took it, not to the
   * session. This used to set `queue = []` and never read it back, so the very next `saveQueue()`
   * (any new photo, a rekey) overwrote MMKV with only the new items and silently erased every
   * earlier rep's unsent photos, leaving their files orphaned in `upload_queue/`. The ownership
   * filter already keeps another rep's items from being shown or sent.
   */
  public resetForNewSession() {
    this.queue = [];
    this.loadQueue();
    this.isProcessing = false;
    this.activeUploadId = null;
    this.notifyListeners();
  }

  /**
   * Cancel a QUEUED photo the rep deleted before it ever uploaded.
   *
   * This is the offline delete for a photo shot with no signal: nothing exists on the server, so
   * removing the queue item IS the delete. The durable copy under `upload_queue` is unlinked too,
   * or a cancelled photo would keep occupying storage for the life of the install.
   *
   * ⚠️ Refuses to cancel the item currently UPLOADING. Its bytes are already on their way and the
   * server may have accepted them; dropping the record here would lose the s3url that the
   * deferred-delete queue needs to clean it up afterwards. The caller falls back to a normal
   * delete once the upload lands.
   */
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

  /** Drop one item by id, wherever it currently sits. */
  private removeItem(id: string) {
    this.queue = this.queue.filter((i) => i.id !== id);
  }

  /**
   * Re-address every held photo from the client id it was queued under to the `_id` the server
   * issued for that lead.
   *
   * ⚠️ This is the piece that makes Manage Photos work on a lead created at the door. The photo
   * queue and the offline lead store are two separate queues by design — photos are large binaries
   * that must not sit in MMKV, and they upload one at a time against a different endpoint — but
   * that means the photo queue holds an id only the OTHER queue can resolve. `offlineLeadStore`
   * calls this the moment the lead create lands, before it walks any further step.
   *
   * Idempotent, and a no-op when the two ids are the same or either is missing.
   */
  public rekeyLead(fromLeadId: string, toLeadId: string) {
    if (!fromLeadId || !toLeadId || fromLeadId === toLeadId) return;
    let touched = 0;
    this.queue = this.queue.map((item) => {
      if (item.leadId !== fromLeadId) return item;
      touched += 1;
      // The retry count is reset with the id: every failure it accumulated was against an address
      // that could not work, so counting them towards the give-up limit would drop a photo for
      // failures it was never given a fair chance at.
      return { ...item, leadId: toLeadId, retryCount: 0 };
    });
    if (!touched) return;
    console.log(`[UploadQueue] Re-addressed ${touched} queued photo(s) ${fromLeadId} -> ${toLeadId}`);
    this.saveQueue();
    this.processQueue();
  }

  /**
   * Discard every queued photo for a lead the rep has DELETED.
   *
   * ⚠️ Called by `offlineLeadStore` when a delete is queued, and it has to be: the two queues
   * are separate by design, so nothing else would ever tell this one the door is gone. Left in
   * place the photos keep retrying against a lead id that no longer resolves, burn their five
   * attempts and are dropped anyway — having spent the rep's data on a house they removed.
   *
   * Returns how many were dropped, so a caller can log it.
   */
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
    // Camera / image-picker photos live in the volatile `tmp/` dir, which iOS purges
    // aggressively (and an app restart clears too). A queued upload that runs after
    // that purge fails with NSCocoa 260 / POSIX 2 "No such file". Copy the file into a
    // DURABLE queue dir up front so it survives until the (possibly offline) upload.
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
      // Both call sites pass the rep's id; the fallback is what GUARANTEES the stamp, since an
      // unowned photo can never be uploaded and would sit here invisibly forever.
      userId: item.userId || getSessionOwner() || undefined,
      timestamp: new Date().toISOString(),
    };
    this.queue.push(newItem);
    this.saveQueue();

    // Process queue in the background (fire and forget)
    this.processQueue();
    return newItem.id;
  }

  /** Local filesystem path for a uri (strips the `file://` scheme, collapses the
   *  leading slash run that produced the malformed `file://////…` uris). */
  private toFsPath(uri: string): string {
    return decodeURIComponent(String(uri || '').replace(/^file:\/\//i, '')).replace(/^\/+/, '/');
  }

  /** A well-formed `file://` uri RCTNetworking can open on both platforms. */
  private toFileUri(uri: string): string {
    return `file://${this.toFsPath(uri)}`;
  }

  /** Copy a captured local photo into a durable per-item queue dir so it can't be
   *  purged before upload. Returns the new `file://` uri, or null when the source is
   *  remote/content/already-missing (caller keeps the original uri). */
  private async persistLocalFile(uri: string, id: string): Promise<string | null> {
    if (!uri) return null;
    // Only local file paths are copyable — leave remote/content uris untouched.
    if (/^(https?|content):/i.test(uri)) return null;
    const fs = ReactNativeBlobUtil.fs;
    const src = this.toFsPath(uri);
    // Already in durable app storage (e.g. the camera pre-persisted it to
    // `pending_uploads`) — use it as-is instead of making a redundant copy.
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

  /** Delete the durable copy once an item leaves the queue (success or drop). */
  private async cleanupPersistedFile(item: UploadQueueItem) {
    try {
      const path = this.toFsPath(item.uri);
      const fs = ReactNativeBlobUtil.fs;
      if ((path.includes('/upload_queue/') || path.includes('/pending_uploads/')) && (await fs.exists(path))) {
        await fs.unlink(path);
      }
    } catch {
      // best-effort cleanup; a leftover temp copy is harmless
    }
  }

  /**
   * ⚠️ Reads `services/connectivity`, which is the app's single source of truth — it does NOT
   * probe the network. This used to `fetch('https://www.google.com')` with a 3 s timeout before
   * every drain, which `connectivity.ts`'s own header already records as the thing it replaced:
   * it asks a third party whether OUR api is reachable, it costs a round trip on every pass, and
   * on a weak connection it is 3 s of nothing before the first byte of a photo moves.
   *
   * Kept as a method rather than inlined so the drain has one place to ask, and so a future
   * reachability refinement lands here instead of at each call site.
   */
  private checkOnline(): boolean {
    return isOnline();
  }

  public async processQueue() {
    if (this.isProcessing) return;
    // ⚠️ Nothing queued → do not even probe the network. The offline branch below re-schedules
    // itself every 5 s, so without this the launch-time kick would leave a permanent timer running
    // on the overwhelming majority of sessions, where the rep has no photos waiting at all.
    if (this.queue.length === 0) return;
    this.isProcessing = true;

    console.log(`[UploadQueue] Processing started. Queue length: ${this.queue.length}`);

    // Connectivity is checked ONCE here, not before every item. The old code ran a
    // `fetch('https://www.google.com')` HEAD round-trip (up to 3s) BEFORE every
    // single upload, so a burst of N photos paid N extra round-trips and felt slow.
    // Now: one pre-flight check, then all queued items upload back-to-back; any
    // connectivity loss mid-burst is caught by the per-item catch below (which
    // re-checks and pauses without burning a retry).
    if (!this.checkOnline()) {
      console.log('[UploadQueue] Device is offline. Pausing queue processing.');
      this.isProcessing = false;
      this.activeUploadId = null;
      this.notifyListeners();
      // ⚠️ No self-rescheduling timer. `startPhotoQueueSync` owns every retrigger now — the
      // reconnect edge, the foreground hook and the 60 s sweep. The old `setTimeout(…, 5000)`
      // here predates all three: each offline pass armed another timer, and a kick from a
      // screen mount while one was already pending left two loops polling in parallel.
      return;
    }

    for (;;) {
      // ⚠️ NOT `queue[0]`. A photo taken on a lead the rep created at the door is queued
      // against the CLIENT id this device minted, and `PUT lead/v1/lead-1773…/images` can never
      // succeed — it would 404 five times and then be DROPPED, which is how a rep who documented
      // a whole house came back with no photos on it. Such an item is held until
      // `rekeyLead` rewrites it with the id the create came back with, and the queue works
      // around it in the meantime rather than stalling behind it.
      // ⚠️ …and it must be OURS. A photo belonging to the rep who used this handset earlier would
      // otherwise be PUT under the current rep's token, onto a lead of a company they may not even
      // be in — silently, because the endpoint would accept it.
      const activeIndex = this.queue.findIndex(
        (i) => !isClientId(i.leadId) && this.ownedByCurrentSession(i)
      );
      if (activeIndex === -1) break;
      const activeItem = this.queue[activeIndex];
      this.activeUploadId = activeItem.id;
      this.notifyListeners();
      try {
        console.log(`[UploadQueue] Uploading item: ${activeItem.id} for slot: ${activeItem.subcategory}`);
        await this.uploadItem(activeItem);

        // Remove completed item from queue
        this.removeItem(activeItem.id);
        this.saveQueue();
        this.cleanupPersistedFile(activeItem); // fire-and-forget: delete the durable copy
        console.log(`[UploadQueue] Upload success: ${activeItem.id}`);
      } catch (error) {
        // The local file is permanently gone (tmp purged before upload). Retrying can
        // never succeed, so drop it immediately — no 5× retry, no red error screen.
        if ((error as any)?.localFileMissing) {
          console.warn(`[UploadQueue] Local file missing for ${activeItem.id}; dropping (photo must be re-taken).`);
          this.removeItem(activeItem.id);
          this.saveQueue();
          this.cleanupPersistedFile(activeItem);
          continue;
        }
        // Lost the connection mid-upload: stop the drain WITHOUT burning a retry, and leave the
        // item exactly where it is. The reconnect hook picks it up the moment signal returns.
        if (!this.checkOnline()) {
          console.log('[UploadQueue] Connection lost during upload. Will resume on reconnect.');
          break;
        }

        const retryCount = (activeItem.retryCount || 0) + 1;
        // A transient failure that will be retried is NOT a hard error — logging it
        // via console.error made React Native's LogBox pop a full-screen red
        // "Console Error" overlay on every attempt, alarming the rep even though the
        // photo uploads fine on the next retry. Use console.warn so it stays a quiet
        // diagnostic; the permanent give-up below is what actually matters.
        console.warn(`[UploadQueue] Upload failed for item: ${activeItem.id} (attempt ${retryCount}):`, error);

        if (retryCount >= 5) {
          // Permanent failure after 5 attempts while online (e.g. invalid file, server rejection) — drop this item
          console.warn(`[UploadQueue] Giving up on item ${activeItem.id} after ${retryCount} attempts. Dropping.`);
          this.removeItem(activeItem.id);
          this.saveQueue();
          this.cleanupPersistedFile(activeItem);
        } else {
          // Update retry count in place and persist
          const at = this.queue.findIndex((i) => i.id === activeItem.id);
          if (at !== -1) this.queue[at] = { ...activeItem, retryCount };
          this.saveQueue();
          // Wait before retrying (exponential backoff 3s, 6s, 12s...)
          const backoffMs = Math.min(3000 * retryCount, 15000);
          console.log(`[UploadQueue] Waiting ${backoffMs}ms before retry...`);
          await new Promise<void>(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    this.isProcessing = false;
    // Nothing is in flight any more — clear it so no tile is left reading "Uploading…".
    this.activeUploadId = null;
    this.notifyListeners();
    console.log('[UploadQueue] Processing finished.');
  }


  private async uploadItem(item: UploadQueueItem): Promise<void> {
    // 1. Location — the one recorded WHEN THE PHOTO WAS TAKEN.
    //
    // ⚠️ Deliberately not a fresh fix. This used to call `getCurrentPosition` here, which is
    // correct only when the upload happens where the photo did. Offline it does not: a house
    // shot at 9am and synced from the office at 6pm was filed at the office, on a record that
    // can end up in a claim. An item queued before this field existed has no coordinates, and
    // 0,0 is the same honest "unknown" the old catch-block already fell back to.
    //
    // A fresh fix here would also be a background-upload hazard — `getCurrentPosition` in a
    // woken-but-not-open app is unreliable and can hang.
    const coords = item.coordinates || { latitude: 0, longitude: 0 };

    // 2. Prepare Form Data
    // Guard: a local file that no longer exists (tmp purged before this upload ran,
    // or already cleaned up) must NOT be attached — RCTNetworking throws
    // NSCocoaErrorDomain 260 "no such file" and, in a dev build, pops a full-screen
    // red error. Detect it and signal a HARD skip so the while-loop drops the item
    // instead of retrying 5× against a file that will never come back.
    const isLocalFile = !/^(https?|content):/i.test(item.uri);
    if (isLocalFile && !(await ReactNativeBlobUtil.fs.exists(this.toFsPath(item.uri)))) {
      const err: any = new Error('LOCAL_FILE_MISSING');
      err.localFileMissing = true;
      throw err;
    }

    const formData = new FormData();
    formData.append('files', {
      // Normalize to a well-formed `file://` uri (fixes the malformed `file://////…`
      // paths that also fail to open); leave remote/content uris as-is.
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

    // Fetch existing photo URLs before upload to prevent matching them in the success handler
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

    // 3. Upload S3 image
    const response = await LeadService.uploadImages(item.leadId, formData);

    // 3b. Log analytical event on upload success in the background (fire-and-forget)
    this.logUploadSuccessAsync(item, response, coords, existingUrls);

    // 3b-i. HAND THE LOCAL FILE OVER TO THE IMAGE CACHE, under the url the server just
    // minted for the same bytes. Until the refetch lands the grid is painting this photo
    // from the queue's `file://` copy; a moment later the lead comes back carrying a
    // pre-signed S3 url, the card swaps to it, and without this the tile would re-download
    // a full-size photo it already had on disk — every tile at once, on the connection that
    // just came back. That is the "after the network restores the pictures keep loading"
    // report. Adopting first makes the swap free and invisible.
    //
    // ⚠️ Must run BEFORE step 4 unlinks the local file, and before the refetch in 3c.
    // Awaited (a local copy, milliseconds) so the race cannot be lost; failure is
    // non-fatal — the tile just falls back to downloading, which is today's behaviour.
    try {
      const uploaded = this.matchUploadedPhoto(response, item, existingUrls);
      // The grid renders `secureUrl` when the lead carries one and otherwise a direct
      // S3 url, and `getLocalCachePath` drops the query string — so a signed and an
      // unsigned url for the same object share one cache path. Adopting under whichever
      // the response gives therefore satisfies the warm either way.
      const uploadedUrl = uploaded?.secureUrl || resolveS3Url(uploaded?.s3url);
      if (uploadedUrl) await adoptLocalFileAsCached(item.uri, uploadedUrl);
    } catch (adoptErr) {
      console.warn('[UploadQueue] Could not adopt local file into image cache:', adoptErr);
    }

    // 3c. Refresh React Query and WAIT for the lead to actually come back before
    // this item is retired from the queue (the caller shifts it as soon as we
    // return). Awaiting the refetch closes that gap so the optimistic item hands
    // over to real data with no flicker.
    try {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      await queryClient.refetchQueries({ queryKey: ['lead', item.leadId] });
    } catch (qcErr) {
      console.warn('[UploadQueue] Failed to refresh queries:', qcErr);
    }

    // 4. Cleanup the ORIGINAL camera scratch file, if that is what we uploaded.
    //
    // ⚠️ Never the image cache's own copy. Step 3b-i adopts these bytes into the image
    // cache, whose files also live under CacheDir, and the previous `includes('Cache')`
    // substring test would happily unlink one of them — deleting the very file the grid
    // was about to render and sending the tile back to the network. `isCacheFile` keys
    // on this cache's filename prefix, so an adopted copy is always skipped.
    //
    // The durable queue copy under `upload_queue` / `pending_uploads` is NOT touched here
    // either; `cleanupPersistedFile` owns that one and runs after the item is retired.
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
   * The row in the upload response that IS the photo `item` just sent, or null.
   *
   * Shared by the image-cache handover and the analytics logger so the two can never
   * disagree about which photo was uploaded. Matched on (category, subcategory) among
   * rows that were NOT already on the lead before the upload — a queue item has no
   * s3url of its own, so there is nothing to join on directly. Scanned newest-first
   * because the server appends.
   */
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

      // Try to match the photo from the upload response first
      const immediateMatch = this.matchUploadedPhoto(response, item, existingUrls);

      if (immediateMatch && immediateMatch.s3url) {
        s3url = immediateMatch.s3url;
        bucketName = immediateMatch.bucketName || '';
      } else {
        // Fallback to polling
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

// Signing out drops the parsed queue as well as the MMKV key — see `resetForNewSession`.
registerSessionResetHook(() => uploadQueueManager.resetForNewSession());

let photoSyncStarted = false;

/**
 * The slow retry sweep. See the identical constant in `services/offlineLeadStore.ts` — these two
 * queues now have the same four triggers on purpose.
 */
const PHOTO_RETRY_SWEEP_MS = 60_000;

/**
 * Drain queued photos on every reconnect, on every return to the foreground, once on a cold start,
 * and on a slow sweep while anything is still outstanding.
 *
 * ⚠️ Without this the queue only ever ran because a screen happened to kick it — the
 * constructor loads the saved items and starts nothing, and `JobDocsSection` is what called
 * `processQueue` on mount. So photos taken offline, followed by the app being killed, sat on the
 * device until the rep opened a Lead Center again. They were never lost, but they were invisible
 * and unsent, which is the failure mode `utils/pending-inspection-photos.ts` already records as
 * the worse one: a rep who cannot see them re-shoots the house.
 *
 * ⚠️ The reconnect hook alone is NOT enough, and this is the gap that produced "rep rendered at
 * 8am, manager still cannot see it at 7pm". `onReconnect` fires on the offline→online EDGE — but
 * if signal returns while the app is BACKGROUNDED OR KILLED there is no running listener to
 * observe that edge, and when the rep reopens the app it is already online so no edge fires then
 * either. Nothing was scheduled to try again. The foreground hook catches the reopen; the sweep
 * catches a pass that simply failed (weak signal on the first attempt) while online throughout.
 *
 * Deliberately mirrors `startOfflineWorkSync`. The lead store had all four from the start and the
 * photo queue had two, which is why lead data synced and its photos did not — the two halves of
 * one offline session, on different schedules.
 *
 * Idempotent, so a remount cannot double-subscribe it.
 */
export const startPhotoQueueSync = (): void => {
  if (photoSyncStarted) return;
  photoSyncStarted = true;

  onReconnect(() => uploadQueueManager.processQueue());

  // Coming back to the app is the moment the rep expects to see progress, and it is also when a
  // connection that recovered while backgrounded first becomes usable.
  AppState.addEventListener('change', (next) => {
    if (next === 'active') uploadQueueManager.processQueue();
  });

  setInterval(() => {
    // Cheap to skip: both guards are in-memory reads, so a session with nothing queued — which is
    // most of them — does no work at all and makes no request.
    if (!isOnline()) return;
    if (!uploadQueueManager.hasUploadableWork()) return;
    uploadQueueManager.processQueue();
  }, PHOTO_RETRY_SWEEP_MS);

  uploadQueueManager.processQueue();
};
