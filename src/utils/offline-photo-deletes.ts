/**
 * offline-photo-deletes.ts — the rules for deleting a photo with no connection.
 *
 * A rep who shoots a wrong photo at a door must be able to remove it there and then. Before this,
 * `deletePhoto` called `POST /job/v1/remove/images` directly and returned early on anything with no
 * `s3url` — so offline the trash button either failed or silently did nothing, and the rep carried
 * a photo they had already decided against into the job record.
 *
 * Two different deletes hide behind one button, and conflating them is the trap:
 *
 *   1. The photo is STILL IN THE UPLOAD QUEUE (shot offline, never sent). There is nothing on the
 *      server to delete. The correct action is to drop the queue item so it is never uploaded —
 *      filing a delete for it would be a request to remove an s3url that does not exist.
 *   2. The photo is ON THE SERVER (synced earlier, now being removed offline). The row must be
 *      hidden locally AND a delete filed for replay on reconnect.
 *
 * Pure and RN-free: the queue below is plain data so the ordering and dedupe rules can be tested
 * without MMKV. `services/offlinePhotoDeleteQueue.ts` binds it to storage and the API.
 */

/** One deferred `POST /job/v1/remove/images`. */
export interface QueuedPhotoDelete {
  /** Stable id so a replay can retire exactly this entry. */
  id: string;
  leadId: string;
  /** The server object to remove. The ONLY thing the endpoint addresses. */
  s3url: string;
  /** Always `salesPhotos` today; carried so the payload is rebuilt, not assumed. */
  category: string;
  /** For the activity log, which is filed on replay rather than lost. */
  categoryName?: string;
  subcategory?: string;
  queuedAt: number;
  /** Who filed it — handsets are shared, see `utils/session-scope.ts`. */
  userId?: string;
  retryCount?: number;
}

export type DeleteTarget =
  | { kind: 'queued-upload'; pendingId: string }
  | { kind: 'server-photo'; s3url: string }
  | { kind: 'nothing' };

/**
 * What deleting this photo actually means.
 *
 * ⚠️ `pendingId` is checked FIRST and the two are mutually exclusive. A photo shot offline has a
 * `pendingId` and no `s3url`; one that has synced has an `s3url` and no `pendingId`. Checking
 * `s3url` first would, for the brief window where a refetch has landed but the queue item has not
 * yet been retired, file a server delete AND leave the upload queued — which re-uploads the photo
 * the rep just deleted.
 */
export const resolveDeleteTarget = (photo: {
  pendingId?: string;
  isPending?: boolean;
  s3url?: string;
}): DeleteTarget => {
  if (photo?.pendingId) return { kind: 'queued-upload', pendingId: photo.pendingId };
  // A pending photo with no id cannot be addressed at all; treat it as a no-op rather than
  // falling through to a server delete it has no url for.
  if (photo?.isPending) return { kind: 'nothing' };
  if (photo?.s3url) return { kind: 'server-photo', s3url: photo.s3url };
  return { kind: 'nothing' };
};

/**
 * Add a delete, ignoring one already filed for the same object.
 *
 * ⚠️ Deduped by `s3url`, not by id. The same photo can be deleted twice (the rep taps, the row
 * lingers because nothing has refetched, they tap again); replaying both would send a second
 * delete for an object the first already removed, which the backend answers with an error that
 * would then burn the retry budget of an otherwise healthy queue.
 */
export const addDelete = (
  queue: QueuedPhotoDelete[],
  entry: QueuedPhotoDelete
): QueuedPhotoDelete[] => {
  if (!entry?.s3url || !entry?.leadId) return queue;
  if (queue.some((q) => q.s3url === entry.s3url)) return queue;
  return [...queue, entry];
};

/** Drop one entry by id — what a successful replay does. */
export const removeDelete = (queue: QueuedPhotoDelete[], id: string): QueuedPhotoDelete[] =>
  queue.filter((q) => q.id !== id);

/**
 * The s3urls this device has deleted but not yet told the server about.
 *
 * Every read of the lead must subtract these. The server still returns the photo until the replay
 * lands, so without this the row the rep deleted reappears on the next refetch — which looks
 * exactly like the delete failed, and is the offline equivalent of the bug
 * `pendingDeletesRef` already guards against online.
 */
export const deletedUrlsFor = (
  queue: QueuedPhotoDelete[],
  leadId: string | null | undefined
): Set<string> => {
  const out = new Set<string>();
  if (!leadId) return out;
  (queue || []).forEach((q) => {
    if (q && q.leadId === leadId && q.s3url) out.add(q.s3url);
  });
  return out;
};

/** Entries belonging to one lead, oldest first — the replay order. */
export const deletesForLead = (
  queue: QueuedPhotoDelete[],
  leadId: string | null | undefined
): QueuedPhotoDelete[] =>
  !leadId ? [] : (queue || []).filter((q) => q?.leadId === leadId).sort((a, b) => a.queuedAt - b.queuedAt);

/**
 * Re-address queued deletes when a lead created at the door gets its real id.
 *
 * ⚠️ Same reason `uploadQueue.rekeyLead` exists: a photo deleted on an offline-created lead is
 * filed against the CLIENT id, and `POST /job/v1/remove/images` can never succeed with it.
 * Idempotent, and a no-op when either id is missing or they already match.
 */
export const rekeyDeletes = (
  queue: QueuedPhotoDelete[],
  fromLeadId: string,
  toLeadId: string
): QueuedPhotoDelete[] => {
  if (!fromLeadId || !toLeadId || fromLeadId === toLeadId) return queue;
  return (queue || []).map((q) => (q.leadId === fromLeadId ? { ...q, leadId: toLeadId } : q));
};

/** Give up after this many failed replays, so one bad entry cannot wedge the queue. */
export const MAX_DELETE_RETRIES = 5;

/**
 * Whether a failed replay should be retried or dropped.
 *
 * ⚠️ A 404 is SUCCESS, not a failure: the object is already gone, which is the state we wanted.
 * Retrying it four more times and then logging a permanent failure would be noise about a photo
 * that is correctly deleted.
 */
export const shouldRetryDelete = (status: number | undefined, retryCount: number): boolean => {
  if (status === 404 || status === 410) return false; // already gone — done
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return retryCount < MAX_DELETE_RETRIES;
};
