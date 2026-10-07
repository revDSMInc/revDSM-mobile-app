export const MAX_CACHED_STRING = 4096;

export const MAX_CACHED_LEAD_BYTES = 512 * 1024;

const MAX_DEPTH = 12;

export const pruneLeadDetailForCache = <T,>(lead: T, depth = 0): T => {
  if (lead === null || lead === undefined) return lead;
  if (typeof lead === 'string') {
    return (lead.length > MAX_CACHED_STRING ? '' : lead) as unknown as T;
  }
  if (typeof lead !== 'object') return lead;
  if (depth >= MAX_DEPTH) return undefined as unknown as T;

  if (Array.isArray(lead)) {
    return lead.map((v) => pruneLeadDetailForCache(v, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  Object.entries(lead as Record<string, unknown>).forEach(([k, v]) => {
    const pruned = pruneLeadDetailForCache(v, depth + 1);
    if (pruned !== undefined) out[k] = pruned;
  });
  return out as unknown as T;
};

export const leadDetailForCache = <T,>(lead: T): T | null => {
  if (!lead || typeof lead !== 'object') return null;
  const pruned = pruneLeadDetailForCache(lead);
  try {
    if (JSON.stringify(pruned).length > MAX_CACHED_LEAD_BYTES) return null;
  } catch {
    return null;
  }
  return pruned;
};

export const mergeLeadRow = <T extends Record<string, any>>(
  prev: T | null | undefined,
  incoming: T
): T => {
  if (!prev?._id || prev._id !== incoming?._id) return incoming;
  const merged: any = { ...prev, ...incoming };
  const keepIfEmpty = (key: string) => {
    const next = (incoming as any)[key];
    const held = (prev as any)[key];
    const nextEmpty = next === undefined || next === null || (Array.isArray(next) && !next.length);
    if (nextEmpty && held !== undefined && held !== null) merged[key] = held;
  };
  ['salesPhotos', 'jobBuilder', 'generatedReports', 'documents', 'calculators'].forEach(keepIfEmpty);
  return merged as T;
};
