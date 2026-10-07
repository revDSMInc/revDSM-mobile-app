export interface QueuedFilterWrite {
  leadId: string;
  savedFilters: Record<string, unknown>;
  at: string;
  ownerId: string;
}

export const queueFilterWrite = (
  queue: readonly QueuedFilterWrite[],
  entry: QueuedFilterWrite
): QueuedFilterWrite[] => {
  if (!entry.leadId || !entry.ownerId) return queue as QueuedFilterWrite[];
  const rest = queue.filter((q) => q.leadId !== entry.leadId);
  return [...rest, entry];
};

export const settleFilterWrite = (
  queue: readonly QueuedFilterWrite[],
  leadId: string
): QueuedFilterWrite[] => queue.filter((q) => q.leadId !== leadId);

export const replayableFilterWrites = (
  queue: readonly QueuedFilterWrite[],
  ownerId: string | null | undefined
): QueuedFilterWrite[] =>
  ownerId ? queue.filter((q) => q.ownerId === ownerId) : [];

export const effectiveFilters = <T,>(
  queue: readonly QueuedFilterWrite[],
  leadId: string | null | undefined,
  serverFilters: T
): T | Record<string, unknown> => {
  if (!leadId) return serverFilters;
  const pending = queue.find((q) => q.leadId === leadId);
  return pending ? pending.savedFilters : serverFilters;
};
