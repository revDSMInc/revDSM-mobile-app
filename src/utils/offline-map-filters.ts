/**
 * offline-map-filters.ts — the rules for a map filter changed with no signal.
 *
 * `PATCH lead/v1/{leadId}/save-filters` with `{ savedFilters }` records the filter set a rep
 * applied on the Zone Canvasser map. Both call sites in `MapFiltersModal` — Apply and Reset —
 * fired it and swallowed the failure (`.catch(() => {})`), so offline the request died silently
 * and the SERVER kept the previous set.
 *
 * Reported: apply a filter online, go offline, press Reset, come back online — and the filter
 * badge still reads "1". The device had reset, the server had not, and the next read put the old
 * filter back. The rep cannot tell, because the modal closed as though it had worked.
 *
 * ⚠️ A reset is NOT "no work to do". `{ savedFilters: {} }` is a write like any other, and
 * treating an empty object as nothing to send is exactly how the reset got lost.
 *
 * Pure and RN-free (no MMKV, no axios) so the rules are testable; `services/offlineMapFilters`
 * is the storage and the drain.
 */

/** One lead's pending filter write. The body is the WHOLE set, never a delta. */
export interface QueuedFilterWrite {
  leadId: string;
  /** Exactly the `savedFilters` body the PATCH would have sent. `{}` means reset. */
  savedFilters: Record<string, unknown>;
  /** ISO, for a trace — the request itself carries no time. */
  at: string;
  /** Whose session queued it; a shared handset must not replay another rep's filters. */
  ownerId: string;
}

/**
 * Add or replace a lead's queued write.
 *
 * ⚠️ ONE row per lead, replaced wholesale. The request is a full-state PATCH, so only the LAST
 * value matters — a rep who filters, resets and filters again offline must end up with the third
 * state, not three requests landing in arrival order. This is the same rule `funding` and
 * `archive` follow in the lead-work queue.
 */
export const queueFilterWrite = (
  queue: readonly QueuedFilterWrite[],
  entry: QueuedFilterWrite
): QueuedFilterWrite[] => {
  if (!entry.leadId || !entry.ownerId) return queue as QueuedFilterWrite[];
  const rest = queue.filter((q) => q.leadId !== entry.leadId);
  return [...rest, entry];
};

/** Drop a row once its PATCH has landed. */
export const settleFilterWrite = (
  queue: readonly QueuedFilterWrite[],
  leadId: string
): QueuedFilterWrite[] => queue.filter((q) => q.leadId !== leadId);

/**
 * The rows this rep may replay.
 *
 * ⚠️ Scoped to the session owner, like every other offline queue here: the handset is shared, and
 * replaying one rep's filters under the next rep's token writes them onto the wrong account.
 */
export const replayableFilterWrites = (
  queue: readonly QueuedFilterWrite[],
  ownerId: string | null | undefined
): QueuedFilterWrite[] =>
  ownerId ? queue.filter((q) => q.ownerId === ownerId) : [];

/**
 * The filter set a screen should SHOW for this lead — the queued one when there is one.
 *
 * ⚠️ The device is authoritative while a write is pending, for the same reason the Deal Center is:
 * the queue is by definition what the server has not got yet, so the server's copy can only be
 * older. Showing the server's would put the filter the rep just cleared straight back on screen.
 */
export const effectiveFilters = <T,>(
  queue: readonly QueuedFilterWrite[],
  leadId: string | null | undefined,
  serverFilters: T
): T | Record<string, unknown> => {
  if (!leadId) return serverFilters;
  const pending = queue.find((q) => q.leadId === leadId);
  return pending ? pending.savedFilters : serverFilters;
};
