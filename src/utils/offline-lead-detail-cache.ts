/**
 * offline-lead-detail-cache.ts — making a lead record small enough to keep.
 *
 * The Lead Center caches each hydrated lead so the screen still has its photos, contract and
 * documents after the app has been killed with no signal. That is safe only because of this file.
 *
 * ⚠️ A sales-portal lead is not a small document. It embeds its own documents as base64 — the
 * `jobBuilder.dynamicJobState.agreements[].files[].blob` / `url` / `displayUrl` chain that made a
 * 12-lead LIST page 31 MB, of which 30.9 MB was `data:` URIs (CLAUDE.md, "My Deals showed 'No leads
 * found' for ~10 s"). Writing that verbatim into MMKV would be the worst possible place for it:
 * MMKV rewrites its whole store on every `set`, so one document-heavy lead would tax every
 * unrelated write in the app for the rest of the session.
 *
 * ⚠️ And the blobs are worth nothing offline anyway. A cached `data:` URI is a document the rep
 * cannot open on this screen (the viewer resolves documents through a network read), so the only
 * thing keeping it buys is the cost of keeping it.
 *
 * Pure and RN-free — no MMKV, no axios — so the rules are testable.
 */

/**
 * Longer than any real lead FIELD and shorter than any base64 document.
 *
 * A customer note, an address, a job-scope sentence: all comfortably under this. A one-page
 * scanned PDF is ~100× it. So the length alone separates them, with no need to guess at which
 * key names carry documents — which is the same discipline `readDocumentGroup` sets, and it is
 * what keeps this working when the payload grows a field nobody here has heard of.
 */
export const MAX_CACHED_STRING = 4096;

/**
 * Refuse to cache a lead bigger than this.
 *
 * ⚠️ A ceiling, not a target. With the blobs gone a lead is tens of KB, so reaching this means the
 * record holds something this pruner does not understand — and in that case NOT caching is the
 * right answer: the screen falls back to hydrating over the network, which is exactly what it did
 * before any of this existed.
 */
export const MAX_CACHED_LEAD_BYTES = 512 * 1024;

/** Depth bound, so a cyclic or pathological record cannot hang the walk. */
const MAX_DEPTH = 12;

/**
 * The lead with its embedded document bodies removed.
 *
 * Dropped, never truncated: half a base64 string is not a smaller document, it is a corrupt one,
 * and a consumer that finds a `data:` prefix will try to render it.
 */
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

/**
 * The record to store, or `null` when it should not be stored at all.
 *
 * ⚠️ Returning `null` is a real outcome and callers must honour it by writing NOTHING — not by
 * writing an empty object, which would read back as a lead whose every field had been cleared.
 */
export const leadDetailForCache = <T,>(lead: T): T | null => {
  if (!lead || typeof lead !== 'object') return null;
  const pruned = pruneLeadDetailForCache(lead);
  try {
    if (JSON.stringify(pruned).length > MAX_CACHED_LEAD_BYTES) return null;
  } catch {
    // Not serializable (a cycle, or something exotic). It could not be stored anyway.
    return null;
  }
  return pruned;
};

/**
 * Fold an incoming lead row onto the one already on screen.
 *
 * ⚠️ The Lead Center is opened from a list that returns SLIM rows (`view=summary`) carrying
 * `salesPhotos: []` and no `jobBuilder`, and that row's object identity changes on every list
 * refetch. Replacing state with it discards a lead the screen has already hydrated — from the
 * network or from the offline cache — and the header falls back to `0/46 slots • 0 photos` for a
 * lead whose photos are on the device. The same loss is what made the count look right only
 * after navigating away and back.
 *
 * ⚠️ A DIFFERENT `_id` replaces outright. That is a real navigation to another record, and
 * merging there would leak one lead's photos onto another.
 *
 * Only ever fills a GAP: a populated incoming field always wins, so a genuine server update — a
 * photo deleted on the portal, a rebuilt job — still lands.
 */
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
