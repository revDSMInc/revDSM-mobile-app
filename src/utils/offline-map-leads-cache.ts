import type { CacheEnvelope } from './offline-cache-envelope';
import {
  readOfflineCache,
  writeOfflineCache,
  OFFLINE_CACHE,
} from './offline-query-cache';

export interface OfflineMapLeadsSnapshot {
  leads: unknown[];
  filters?: Record<string, unknown>;
}

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

export const writeMapLeadsCache = (
  leads: unknown[],
  filters?: Record<string, unknown>,
  userId?: string | null,
): void => {
  if (!Array.isArray(leads) || leads.length === 0) return;
  writeOfflineCache(OFFLINE_CACHE.MAP_LEADS, { leads, filters }, userId);
};

export const clearMapLeadsCache = (userId?: string | null): void => {
  writeOfflineCache(OFFLINE_CACHE.MAP_LEADS, { leads: [] }, userId);
};
