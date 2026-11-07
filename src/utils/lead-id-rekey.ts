/**
 * Following a lead's id when its offline create lands.
 *
 * ⚠️ THE BUG THIS FIXES, and it is NOT the read-after-write lag that `sales-photos-merge` covers:
 *
 * A lead created at a door is keyed by a CLIENT id (`lead-1793...`) until its create drains - the
 * Lead Center header shows "Lead ID: N/A" in exactly that state. Photos taken offline are queued
 * against that client id, and the count reads them from the queue, so it correctly shows 3.
 *
 * When the link returns, `offlineLeadStore` creates the lead, gets the REAL id, and rekeys every
 * queue onto it (`uploadQueueManager.rekeyLead`, `offlinePhotoDeleteQueue.rekeyLead`, the activity
 * logs, the workflow). What nothing did was tell the ALREADY-OPEN Lead Center, which carried on
 * holding the old client id. `JobDocsSection` then filtered the queue with
 * `it.leadId === lead?._id` - new id on the items, old id on the screen - so `pending` became `[]`
 * and the count fell from 3 to 0. A remount re-read the lead and picked up the real id, which is
 * exactly why navigating away and back appeared to "fix" it.
 *
 * `refreshAfterLeadLanded` refreshes the lead LISTS and the map, never the open screen's own id.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

/** The shape `getOfflineWork()` returns, narrowed to what this rule reads. */
export interface LeadWorkIds {
  clientId?: string;
  serverIds?: { leadId?: string };
  /** The lead payload held on the device; may carry the client id it was created under. */
  lead?: Record<string, unknown> | null;
}

/**
 * A lead id minted on the device, before the server has ever seen the lead.
 *
 * ⚠️ Mirrors `isClientId` in `utils/lead-sync-state.ts` - kept local so this rule stays pure and
 * does not pull the sync module into a test.
 */
export const isDeviceLeadId = (id: unknown): boolean =>
  typeof id === 'string' && /^(lead|appt|calc|work)-/.test(id);

/**
 * The real server id this screen should now be using, or `null` to keep the current one.
 *
 * Returns an id only when ALL of these hold:
 *  - the screen is currently showing a device-minted id (a real id is never replaced);
 *  - some offline work names that id as its own (by `clientId`, or by the `_id` of the lead
 *    payload it holds);
 *  - that work has a real server id recorded, and it differs from what the screen holds.
 */
export const resolvedLeadIdFor = (
  currentId: unknown,
  work: readonly LeadWorkIds[] | LeadWorkIds | null | undefined
): string | null => {
  if (!isDeviceLeadId(currentId)) return null;
  const current = String(currentId);

  const list = Array.isArray(work) ? work : work ? [work] : [];
  for (const w of list) {
    if (!w) continue;
    const serverId = w.serverIds?.leadId;
    if (!serverId || typeof serverId !== 'string') continue;
    if (isDeviceLeadId(serverId) || serverId === current) continue;

    // ⚠️ Matched on EITHER key: the work's own `clientId`, or the id the device lead payload was
    // created under. A screen opened from the lead list carries the lead's `_id`, which is not
    // always the work's `clientId`.
    const leadPayloadId = (w.lead as any)?._id;
    if (w.clientId === current || String(leadPayloadId ?? '') === current) {
      return serverId;
    }
  }
  return null;
};
