/**
 * Merging a lead's SERVER photo list with the one already on screen.
 *
 * ⚠️ WHY. `useLeadCenterData.refetch` did `setLead({ ...prev, ...full })`, so `full.salesPhotos`
 * REPLACED what we already held. That is wrong on reconnect, and it is the second half of the
 * "I took a photo, it disappears" report:
 *
 *   - offline, 3 photos sit in the upload queue; the count reads 3 from the queue;
 *   - the rep turns the internet on WITHOUT leaving the screen;
 *   - the uploads succeed, so the queue DRAINS - pending drops to 0;
 *   - the lead read that follows is served a list that does not include them yet
 *     (read-after-write lag, or a response that simply predates the uploads);
 *   - `{...prev, ...full}` overwrites 3 photos with 0, and with the queue now empty nothing
 *     holds the number up. `recentlyCompleted` covers 60 s and only `JobDocsSection` reads it,
 *     so after a minute every surface reads 0 until a manual refresh.
 *
 * The rule: **a server read may ADD photos and may confirm them, but a shorter list is not
 * evidence that a photo we already hold is gone.** A photo only leaves this list when the rep
 * deletes it, which travels separately through `offlinePhotoDeleteQueue` / `deletedUrls` and is
 * applied downstream - so keeping an unlisted photo here can never resurrect a deleted one.
 *
 * ⚠️ This is NOT a cache that grows forever. The retained set is only ever photos the DEVICE
 * knows about from this session; the next read that does include them collapses the two lists
 * back into one by identity.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

export interface SalesPhotoLike {
  s3url?: string | null;
  uri?: string | null;
  _id?: string | null;
  [key: string]: unknown;
}

/** The id a photo is recognised by, in the order the API and the queue actually populate. */
export const salesPhotoKey = (photo: SalesPhotoLike | null | undefined): string =>
  String(photo?.s3url || photo?.uri || photo?._id || '');

/**
 * Merge an incoming server list over the list already held.
 *
 * Incoming rows win (they are fresher and carry server fields); rows we hold that the server did
 * not mention are KEPT, appended in their existing order.
 *
 * ⚠️ Returns `incoming` itself when nothing had to be retained, so a caller's memo identity does
 * not churn on every refetch.
 */
export const mergeSalesPhotos = <T extends SalesPhotoLike>(
  previous: readonly T[] | null | undefined,
  incoming: readonly T[] | null | undefined
): T[] => {
  // ⚠️ An ABSENT list is "the server said nothing", not "the server said none". A detail
  // response that omits the field entirely must never clear what we hold.
  if (!Array.isArray(incoming)) {
    return (Array.isArray(previous) ? previous.filter(Boolean) : []) as T[];
  }

  const held = Array.isArray(previous) ? previous.filter(Boolean) : [];

  /**
   * ⚠️ IDENTITY FIRST. Returning `incoming` UNTOUCHED whenever nothing has to be retained is what
   * keeps a refetch from re-rendering every photo grid - rebuilding the array with `.filter`
   * would hand every consumer a new reference on each read. Only build a new array when the merge
   * actually changes something.
   */
  if (!held.length) return incoming as T[];

  const seen = new Set(incoming.map((p) => salesPhotoKey(p)).filter(Boolean));

  /**
   * ⚠️ A DEVICE-ONLY PHOTO IS RETAINED BY SLOT, NOT BY URL - and this is the half that was
   * wrong.
   *
   * `salesPhotoKey` prefers `s3url` and falls back to `uri`. A photo queued at the door is held
   * under its LOCAL `uri`; the server row for THAT SAME SHOT arrives carrying an `s3url` and no
   * `uri`, so the two keys never collide. The held copy was therefore retained ALONGSIDE its own
   * uploaded twin - which is both the "4 photos showed as 5" report and, once
   * `uploadQueue` unlinked the scratch file after a successful upload, the "Manage Photos (0) /
   * nothing to download" one: the retained record still counted, but pointed at a file that no
   * longer existed, so the grid resolved it to nothing.
   *
   * So a held photo that has never been to the server (no `s3url`) is kept only while the
   * incoming list does not already cover its slot. Once the server reports as many rows for that
   * slot as the device holds, the local copy has landed and must go: a slot holds
   * `max(server, device)` photos, never their sum - the same rule as `utils/slot-photo-dedupe.ts`.
   */
  const slotKey = (p: SalesPhotoLike): string =>
    `${norm(p?.category)}||${norm(p?.subcategory)}`;

  const incomingPerSlot = new Map<string, number>();
  incoming.filter(Boolean).forEach((p) => {
    const k = slotKey(p);
    incomingPerSlot.set(k, (incomingPerSlot.get(k) || 0) + 1);
  });

  const usedPerSlot = new Map<string, number>();
  const retained = held.filter((p) => {
    const key = salesPhotoKey(p);
    if (!key || seen.has(key)) return false;

    // A held row that HAS an `s3url` the server did not mention is a genuine read-after-write
    // gap: keep it, exactly as before.
    if (p?.s3url) return true;

    const k = slotKey(p);
    const covered = incomingPerSlot.get(k) || 0;
    const used = usedPerSlot.get(k) || 0;
    if (used < covered) {
      // This device copy is accounted for by a server row for the same slot: it has landed.
      usedPerSlot.set(k, used + 1);
      return false;
    }
    usedPerSlot.set(k, used + 1);
    return true;
  });

  if (!retained.length) return incoming as T[];

  // Only here do we pay for a new array - and the incoming side is cleaned at the same time.
  return [...incoming.filter(Boolean), ...retained] as T[];
};
