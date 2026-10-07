export interface QueuedPhotoDelete {
  id: string;
  leadId: string;
  s3url: string;
  category: string;
  categoryName?: string;
  subcategory?: string;
  queuedAt: number;
  userId?: string;
  retryCount?: number;
}

export type DeleteTarget =
  | { kind: 'queued-upload'; pendingId: string }
  | { kind: 'server-photo'; s3url: string }
  | { kind: 'nothing' };

export const resolveDeleteTarget = (photo: {
  pendingId?: string;
  isPending?: boolean;
  s3url?: string;
}): DeleteTarget => {
  if (photo?.pendingId) return { kind: 'queued-upload', pendingId: photo.pendingId };
  if (photo?.isPending) return { kind: 'nothing' };
  if (photo?.s3url) return { kind: 'server-photo', s3url: photo.s3url };
  return { kind: 'nothing' };
};

export const addDelete = (
  queue: QueuedPhotoDelete[],
  entry: QueuedPhotoDelete
): QueuedPhotoDelete[] => {
  if (!entry?.s3url || !entry?.leadId) return queue;
  if (queue.some((q) => q.s3url === entry.s3url)) return queue;
  return [...queue, entry];
};

export const removeDelete = (queue: QueuedPhotoDelete[], id: string): QueuedPhotoDelete[] =>
  queue.filter((q) => q.id !== id);

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

export const deletesForLead = (
  queue: QueuedPhotoDelete[],
  leadId: string | null | undefined
): QueuedPhotoDelete[] =>
  !leadId ? [] : (queue || []).filter((q) => q?.leadId === leadId).sort((a, b) => a.queuedAt - b.queuedAt);

export const rekeyDeletes = (
  queue: QueuedPhotoDelete[],
  fromLeadId: string,
  toLeadId: string
): QueuedPhotoDelete[] => {
  if (!fromLeadId || !toLeadId || fromLeadId === toLeadId) return queue;
  return (queue || []).map((q) => (q.leadId === fromLeadId ? { ...q, leadId: toLeadId } : q));
};

export const MAX_DELETE_RETRIES = 5;

export const shouldRetryDelete = (status: number | undefined, retryCount: number): boolean => {
  if (status === 404 || status === 410) return false; // already gone — done
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return retryCount < MAX_DELETE_RETRIES;
};
