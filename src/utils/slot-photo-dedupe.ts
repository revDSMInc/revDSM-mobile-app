/**
 * Reconciling one photo slot's SERVER rows with the device copies still in the upload queue.
 *
 * ⚠️ WHY. A photo taken offline is shown from its local file (no `s3url`). When its upload lands
 * the server returns the SAME photo with an `s3url` - two records, one shot. The dedupe in
 * `useDynamicInspectionCapture` matched only on `s3url`, so a device-only copy never matched
 * anything and was pushed on every pass. Because `knownPhotosRef` is sticky across renders, the
 * stale copy then sat beside its own uploaded twin: four photos taken offline rendered as **five**,
 * and one slot showed the same shot three times. Leaving the screen and returning "fixed" it only
 * because the ref was rebuilt from scratch.
 *
 * The rule: **the server is authoritative for what it lists; device-only copies fill only the gap
 * between what the server shows and what this device holds.**
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

export interface SlotPhoto {
  s3url?: string;
  uri?: string;
  [key: string]: unknown;
}

/**
 * How many device-only copies a slot should still display.
 *
 * ⚠️ The slot holds `max(serverRows, deviceFiles)` photos, NOT their sum: a photo that has
 * uploaded appears in BOTH sets, as the same shot. So only the device files the server has not
 * caught up with are still worth drawing.
 *
 * `deviceFiles` is the number of DISTINCT local files; `onServer` is the number of distinct server
 * rows. This is the same surplus rule `salesPhotosWithPending` applies per slot - stated here too
 * because this layer reconciles a different pair of lists.
 */
export const deviceOnlyAllowance = (deviceFiles: number, onServer: number): number =>
  Math.max(0, (Number(deviceFiles) || 0) - (Number(onServer) || 0));

/**
 * Collapse one slot's records to the set that should render.
 *
 * Server rows always survive, deduped by `s3url`. Device-only rows are deduped by `uri` and kept
 * only up to `deviceOnlyAllowance`.
 *
 * ⚠️ Order matters to the caller: server rows keep their incoming order, and surviving
 * device-only rows follow, so a just-taken photo appears after the confirmed ones rather than
 * jumping position when its upload lands.
 */
export const dedupeSlotPhotos = <T extends SlotPhoto>(
  records: readonly T[] | null | undefined
): T[] => {
  const all = (Array.isArray(records) ? records : []).filter(Boolean);
  const server: T[] = [];
  const seenS3 = new Set<string>();

  all.forEach((p) => {
    const key = typeof p.s3url === 'string' ? p.s3url : '';
    if (!key) return;
    if (seenS3.has(key)) return;
    seenS3.add(key);
    server.push(p);
  });

  /**
   * ⚠️ Count DISTINCT device copies, not raw records.
   *
   * A first pass used `all.length` as "what the device holds", but that counts the queued copy AND
   * its uploaded twin as two - so the gap never shrank and the duplicate survived. The device
   * holds as many photos as it has distinct local files.
   */
  const distinctDevice: T[] = [];
  const seenUri = new Set<string>();
  all.forEach((p) => {
    if (p.s3url) return;
    const uri = typeof p.uri === 'string' ? p.uri : '';
    // ⚠️ A record with no uri AND no s3url cannot be identified; keep one rather than drop the
    // rep's photo, but never let it match another.
    if (uri) {
      if (seenUri.has(uri)) return;
      seenUri.add(uri);
    }
    distinctDevice.push(p);
  });

  const allowance = deviceOnlyAllowance(distinctDevice.length, server.length);
  if (allowance <= 0) return server;

  return [...server, ...distinctDevice.slice(0, allowance)];
};
