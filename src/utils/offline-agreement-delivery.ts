/**
 * Queued "how the homeowner wants the signed copy" writes (REVUIUX-391), for a rep with no signal.
 *
 * ⚠️ Offline this prompt BLOCKED THE SALE. It sits in front of Generate Agreement, and `onConfirmed`
 * only fired after the PUT resolved — so with no signal the rep could not reach the agreement at
 * all. The preference is a one-field choice the device can hold; the sale cannot wait for it.
 *
 * ⚠️ Full-state PUT ⇒ one row per lead, replaced wholesale. No attempt counter: the last choice is
 * the only one that matters, and replaying an older one would overwrite it.
 */

export interface QueuedDeliveryWrite {
  leadId: string;
  payload: { channel: 'email' | 'text'; phone?: string; email?: string };
  at: string;
  ownerId: string;
}

export const queueDeliveryWrite = (
  queue: QueuedDeliveryWrite[],
  row: QueuedDeliveryWrite
): QueuedDeliveryWrite[] => [
  ...(Array.isArray(queue) ? queue : []).filter((q) => q.leadId !== row.leadId),
  row,
];

export const settleDeliveryWrite = (
  queue: QueuedDeliveryWrite[],
  leadId: string
): QueuedDeliveryWrite[] =>
  (Array.isArray(queue) ? queue : []).filter((q) => q.leadId !== leadId);

/** Rows this session's owner may replay. A row from another login is never sent. */
export const replayableDeliveryWrites = (
  queue: QueuedDeliveryWrite[],
  ownerId: string | null | undefined
): QueuedDeliveryWrite[] =>
  !ownerId ? [] : (Array.isArray(queue) ? queue : []).filter((q) => q.ownerId === ownerId && !!q.leadId);

/** The pending choice for a lead, or null — so the prompt reopens on what the rep picked. */
export const pendingDeliveryFor = (
  queue: QueuedDeliveryWrite[],
  leadId: string | null | undefined
): QueuedDeliveryWrite['payload'] | null =>
  (!leadId ? null : (Array.isArray(queue) ? queue : []).find((q) => q.leadId === leadId)?.payload) ?? null;
