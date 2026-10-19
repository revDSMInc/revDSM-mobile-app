/**
 * What the inspection-photo UI shows while an upload is in flight.
 *
 * Two symptoms, one shape of bug: **the count and the spinner are each derived from two
 * sources that briefly disagree** - the server's `salesPhotos` and the device upload queue.
 *
 * ⚠️ 1. "I uploaded 4 images, during uploading it becomes 3, then a second later 4 again."
 *    The count is `server photos + queued items`. A queue item is removed the instant its PUT
 *    resolves, but the server list only changes once a refetch lands. In that window the photo
 *    is in NEITHER set and the count drops. On Wi-Fi the gap is invisible; on 4G it is a
 *    second or more. ⚠️ The fix is NOT to count the item twice once the server has it - that
 *    would flicker upward instead. It is to treat a just-finished upload as still occupying
 *    its slot until the server confirms (`recentlyCompleted`).
 *
 * ⚠️ 2. "Back was uploaded before and the loader is still showing."
 *    `uploadingKeys[key]` was cleared in exactly ONE place: an effect keyed on
 *    `salesPhotosSignature`. If that refetch returned stale data, failed, or the photo came
 *    back under a slightly different subcategory, the signature never changed and **nothing
 *    else ever cleared the flag** - the spinner span the rest of the session. A spinner must
 *    never depend on a single success path.
 *
 * Pure on purpose: the capture hook imports react-native (CLAUDE.md §6).
 */

/** A slot is identified by its category + subcategory pair, however the caller spells it. */
export interface UploadSlotRef {
  categoryName?: string | null;
  subcategory?: string | null;
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

export const slotKeyOf = (ref: UploadSlotRef | null | undefined): string =>
  `${norm(ref?.categoryName)}||${norm(ref?.subcategory)}`;

/**
 * ⚠️ The spinner's authority is the QUEUE, not a flag we set once and hope to clear.
 *
 * `uploadingKeys` is an optimistic marker set at capture time. It is right for the instant
 * between the tap and the item reaching the queue, and wrong forever after if the clearing
 * effect does not fire. So: the marker only counts while the queue has not yet taken over,
 * and once the queue is the source of truth the queue alone decides.
 */
export const isSlotUploading = (input: {
  /** Queue items for THIS lead only. */
  queuedSlots?: UploadSlotRef[] | null;
  /** The optimistic flag set when the photo was captured. */
  optimistic?: boolean;
  /** Has the server confirmed a photo in this slot? */
  hasServerPhoto?: boolean;
  /** How long the optimistic flag has been set, in ms. */
  optimisticAgeMs?: number;
  slot: UploadSlotRef;
}): boolean => {
  const key = slotKeyOf(input.slot);
  const queued = (input.queuedSlots || []).some((q) => slotKeyOf(q) === key);
  if (queued) return true;

  // Not in the queue any more. If the server has it, the upload is unambiguously done.
  if (input.hasServerPhoto) return false;

  /**
   * ⚠️ Neither queued nor confirmed. This is the window the count bug lives in, so we keep
   * spinning - but only briefly. Past the grace period something has gone wrong (a refetch
   * that never landed, a photo filed under another subcategory) and a spinner that never
   * stops is worse than one that stops early: the rep can retake a photo, but cannot tell a
   * stuck spinner from a slow one.
   */
  if (!input.optimistic) return false;
  return (input.optimisticAgeMs ?? 0) < OPTIMISTIC_SPINNER_MAX_MS;
};

/** Past this, an unconfirmed optimistic flag is assumed stuck and stops spinning. */
export const OPTIMISTIC_SPINNER_MAX_MS = 90_000;

/**
 * The photo count, counting each photo exactly once.
 *
 * ⚠️ A queued item and a server photo for the SAME slot are one photo, not two - the drain
 * removes the queue item and the refetch adds the server row, and double-counting during the
 * overlap is what makes the number jump up. Deduplicating by slot makes the count monotonic
 * through the whole handover.
 */
export const countInFlightPhotos = (input: {
  serverSlots?: UploadSlotRef[] | null;
  queuedSlots?: UploadSlotRef[] | null;
  /** Slots whose upload resolved but whose server row has not appeared yet. */
  recentlyCompletedSlots?: UploadSlotRef[] | null;
}): number => {
  const seen = new Set<string>();
  let n = 0;
  const add = (refs: UploadSlotRef[] | null | undefined) => {
    (refs || []).forEach((r) => {
      const k = slotKeyOf(r);
      if (k === '||' || seen.has(k)) return;
      seen.add(k);
      n += 1;
    });
  };
  // Server first: it is the truth. Then the queue, then the handover window.
  add(input.serverSlots);
  add(input.queuedSlots);
  add(input.recentlyCompletedSlots);
  return n;
};

/**
 * Should a just-finished upload still be counted?
 *
 * ⚠️ Bounded on purpose. If the server row never appears we must eventually stop claiming a
 * photo that is not there, or the count silently overstates what the office will receive.
 */
export const RECENTLY_COMPLETED_TTL_MS = 60_000;

export const pruneRecentlyCompleted = <T extends { completedAt: number }>(
  entries: T[] | null | undefined,
  now: number = Date.now(),
  ttlMs: number = RECENTLY_COMPLETED_TTL_MS
): T[] => (entries || []).filter((e) => now - (e?.completedAt ?? 0) < ttlMs);
