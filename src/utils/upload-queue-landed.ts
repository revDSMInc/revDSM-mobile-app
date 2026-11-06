/**
 * Detecting that an upload for ONE lead has left the queue.
 *
 * ⚠️ WHY. `useLeadCenterData` holds the lead in local state and only learns about new server
 * photos through its own `refetch`. That refetch ran on mount, on an id change and on reconnect -
 * all of which fire BEFORE a reconnect drain finishes uploading the photos taken at a door. So
 * the state kept the server's empty list while the queue emptied, and Manage Photos opened at
 * (0) until a pull-to-refresh. `JobDocsSection` did call `refetch()` from its queue listener,
 * but through a closure captured on mount, which for a lead created offline still held the
 * CLIENT id - and `refetch` returns early for a client id, so that call was a no-op forever.
 *
 * This rule answers one question from two queue snapshots: how many items addressed to this lead
 * are gone? Matched by the item's own `id`, NOT by `leadId`:
 *
 *   - a rekey (`uploadQueueManager.rekeyLead`) rewrites `leadId` but keeps `id`, so the items are
 *     still there and must not count as landed;
 *   - an item that was parked or failed keeps its `id`, so it does not count either.
 *
 * An item removed by the rep from the Pending Uploads screen DOES count; the extra refetch that
 * triggers is harmless.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

export interface QueueItemIds {
  id: string;
  leadId: string;
}

export const uploadsLeftQueueForLead = (
  prev: readonly QueueItemIds[] | null | undefined,
  next: readonly QueueItemIds[] | null | undefined,
  leadId: unknown
): number => {
  if (!leadId || typeof leadId !== 'string') return 0;
  const before = (Array.isArray(prev) ? prev : []).filter((i) => i && i.leadId === leadId);
  if (!before.length) return 0;
  const stillThere = new Set((Array.isArray(next) ? next : []).filter(Boolean).map((i) => i.id));
  return before.filter((i) => !stillThere.has(i.id)).length;
};
