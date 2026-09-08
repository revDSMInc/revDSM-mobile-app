/**
 * offline-map-leads-cache.ts — snapshot the map's leads array + filter state so the
 * map screen can render pins when the device is offline.
 *
 * The map fetches from `LeadService.findJobs(payload)` (query key `['mapJobs', ...]`),
 * which is a **separate endpoint** from the leads list. This cache stores the most
 * recent successful response alongside the filter state that produced it.
 *
 * ⚠️ These are the **summary** rows returned by `findJobs`, which carry location
 * coordinates, job number, status, price and address — exactly what the map pin layer
 * needs. They are NOT full lead records; the same `view=summary` caveat from
 * `useLeadsData` applies here.
 *
 * The MMKV binding lives in `offline-query-cache.ts` (key: `OFFLINE_CACHE.MAP_LEADS`);
 * everything testable is here.
 */

import type { CacheEnvelope } from './offline-cache-envelope';
import {
  readOfflineCache,
  writeOfflineCache,
  OFFLINE_CACHE,
} from './offline-query-cache';

/** The shape we snapshot — keep this narrow so MMKV stays under 500 KB. */
export interface OfflineMapLeadsSnapshot {
  /** The raw leads array from `findJobs` (summary rows). */
  leads: unknown[];
  /** The `FilterState` that produced these results (for the offline indicator). */
  filters?: Record<string, unknown>;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the last snapshot, or `null` when:
 * - nothing was saved yet
 * - the snapshot belongs to a different user
 * - the snapshot is older than `maxAgeMs`
 */
export const readMapLeadsCache = (
  userId?: string | null,
  maxAgeMs?: number,
): OfflineMapLeadsSnapshot | null => {
  const result = readOfflineCache<OfflineMapLeadsSnapshot>(OFFLINE_CACHE.MAP_LEADS, {
    userId,
    maxAgeMs,
  });
  return result?.data ?? null;
};

// ─── Write ─────────────────────────────────────────────────────────────────────

/**
 * Snapshot the current leads + filters into MMKV. Called after every successful
 * `findJobs` response so the map always has fresh data for the next offline open.
 *
 * Never throws — storage failures are non-fatal.
 */
export const writeMapLeadsCache = (
  leads: unknown[],
  filters?: Record<string, unknown>,
  userId?: string | null,
): void => {
  if (!Array.isArray(leads) || leads.length === 0) return;
  writeOfflineCache(OFFLINE_CACHE.MAP_LEADS, { leads, filters }, userId);
};

// ─── Clear ─────────────────────────────────────────────────────────────────────

export const clearMapLeadsCache = (userId?: string | null): void => {
  writeOfflineCache(OFFLINE_CACHE.MAP_LEADS, { leads: [] }, userId);
};
