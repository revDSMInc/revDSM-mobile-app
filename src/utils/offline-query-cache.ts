/**
 * offline-query-cache.ts — the MMKV binding for `offline-cache-envelope`.
 *
 * A deliberately NARROW store for small, slow-moving CONFIG documents whose absence does not
 * merely blank a screen but changes which code path the app takes. It is not a general React
 * Query persister (that is a separate, larger piece of work) — every consumer opts in by name.
 *
 * ⚠️ The inspection photo schema is the reason this exists. Without it `JobDocsSection` fell
 * through to the LEGACY hardcoded photo flow, which stores a photo's category unscoped
 * (`"Home"` instead of `"Gutters/Roofline — HOME"`). Offline, that happened silently, and the
 * photos surfaced later as un-refilable "+ UNSORTED" orphans on a lead the rep had actually
 * documented in full.
 *
 * All rules live in `offline-cache-envelope.ts`, which is testable without MMKV; this file is
 * only storage.
 */

import { Storage } from './storage';
import {
  buildCacheKey,
  decodeEnvelope,
  encodeEnvelope,
  type DecodeOptions,
} from './offline-cache-envelope';

/** Named snapshots. Adding one is a deliberate act — keep this list short. */
export const OFFLINE_CACHE = {
  /** `GET /inspection-photo-schemas/sales-rep` — drives which photo flow the app runs. */
  INSPECTION_SCHEMA: 'inspection-schema',
} as const;

/** Read a snapshot, or `null` when there is any reason not to trust it. */
export const readOfflineCache = <T,>(
  name: string,
  options: DecodeOptions = {}
): { data: T; savedAt: number } | null => {
  try {
    return decodeEnvelope<T>(Storage.getItem(buildCacheKey(name, options.userId)), options);
  } catch (e) {
    console.warn(`[offlineCache] read failed for ${name}:`, e);
    return null;
  }
};

/**
 * Write a snapshot. Never throws — a device with no space left must not break the request
 * whose result we were merely trying to keep.
 */
export const writeOfflineCache = <T,>(name: string, data: T, userId?: string | null): void => {
  try {
    Storage.setItem(buildCacheKey(name, userId), encodeEnvelope(data, userId));
  } catch (e) {
    console.warn(`[offlineCache] write failed for ${name}:`, e);
  }
};

export const clearOfflineCache = (name: string, userId?: string | null): void => {
  try {
    Storage.removeItem(buildCacheKey(name, userId));
  } catch (e) {
    console.warn(`[offlineCache] clear failed for ${name}:`, e);
  }
};
