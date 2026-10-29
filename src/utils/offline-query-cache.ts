import { Storage } from './storage';
import { DEAL_CENTER_CALC_CACHE } from './offline-deal-center';
import {
  buildCacheKey,
  decodeEnvelope,
  encodeEnvelope,
  type DecodeOptions,
} from './offline-cache-envelope';

export const OFFLINE_CACHE = {
  INSPECTION_SCHEMA: 'inspection-schema',
  MAP_LEADS: 'map-leads',

  DEAL_CENTER_SCHEMA: 'deal-center-schema',
  DEAL_CENTER_PRICING: 'deal-center-pricing',
  JOB_BUILDER_CONFIG: 'job-builder-config',
  PAYMENT_PLANS: 'payment-plans',
  DISCOUNT_CONFIG: 'discount-config',

  AGREEMENT_CONFIG: 'agreement-config',
  DESCRIPTION_SCHEMA: 'description-schema',
  DESCRIPTION_SCHEMA_LIST: 'description-schema-list',
  DEAL_CENTER_DESCRIPTION_SCHEMA: 'deal-center-description-schema',
  COMPANY_LOGO: 'company-logo',

  PITCH_BOOK_LIST: 'pitch-book-list',
  PITCH_BOOK_DECK: 'pitch-book-deck',
  SECURE_URLS: 'secure-urls',
  REVRENDER_RUNS: 'revrender-runs',

  LEADS_LIST: 'leads-list',
  LEAD_DETAIL: 'lead-detail',
  DEAL_CENTER_CALCULATORS: DEAL_CENTER_CALC_CACHE,
} as const;

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

export const writeOfflineCache = <T,>(name: string, data: T, userId?: string | null): void => {
  try {
    Storage.setItem(buildCacheKey(name, userId), encodeEnvelope(data, userId));
  } catch (e) {
    console.warn(`[offlineCache] write failed for ${name}:`, e);
  }
};

export const clearOfflineCacheByPrefix = (prefix: string, userId?: string | null): number => {
  let removed = 0;
  try {
    const owner = (typeof userId === 'string' && userId.trim()) || 'anon';
    const match = `offline-cache:${prefix}`;
    Storage.getAllKeys().forEach((key) => {
      if (!key.startsWith(match)) return;
      if (!key.endsWith(`:${owner}`)) return;
      Storage.removeItem(key);
      removed += 1;
    });
  } catch (e) {
    console.warn(`[offlineCache] prefix clear failed for ${prefix}:`, e);
  }
  return removed;
};

export const clearOfflineCache = (name: string, userId?: string | null): void => {
  try {
    Storage.removeItem(buildCacheKey(name, userId));
  } catch (e) {
    console.warn(`[offlineCache] clear failed for ${name}:`, e);
  }
};


export const cachedFetch = async <T,>(
  name: string,
  fetcher: () => Promise<T>,
  options: {
    online: boolean;
    userId?: string | null;
    isEmpty?: (data: T) => boolean;
    /**
     * Called when an ONLINE fetch failed and the saved copy is returned instead. The caller's
     * query sees a success either way, so this is the only way it can know the data is a stale
     * snapshot and should be re-read soon rather than trusted for its whole staleTime.
     */
    onStaleFallback?: () => void;
  }
): Promise<T> => {
  const { online, userId, isEmpty = defaultIsEmpty, onStaleFallback } = options;

  const cached = (): T | undefined => readOfflineCache<T>(name, { userId })?.data;

  if (!online) {
    const saved = cached();
    if (saved !== undefined) return saved;
    throw new Error(`[offlineCache] ${name} is not cached and there is no connection`);
  }

  try {
    const fresh = await fetcher();
    if (!isEmpty(fresh)) writeOfflineCache(name, fresh, userId);
    return fresh;
  } catch (e) {
    const saved = cached();
    if (saved !== undefined) {
      onStaleFallback?.();
      return saved;
    }
    throw e;
  }
};

const defaultIsEmpty = (data: unknown): boolean => {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data as object).length === 0;
  return false;
};
