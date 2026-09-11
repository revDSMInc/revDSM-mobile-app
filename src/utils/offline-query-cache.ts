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
  /** Map leads + filter state snapshot so the map can render offline. */
  MAP_LEADS: 'map-leads',

  // ── The Deal Center's four configs ──────────────────────────────────────────
  // None of these is the rep's DATA; they are the company's setup, they change rarely, and without
  // them the Deal Center renders an empty shell offline: no products, no fields, no prices, no
  // payment plans. They are cached for the same reason as the inspection schema above — their
  // absence does not blank a screen, it silently changes what the app does.
  /** `GET /calculator-form-schemas/deal-center` — System A: the priced calculator fields. */
  DEAL_CENTER_SCHEMA: 'deal-center-schema',
  /** The sales pricing config the schema's per-field prices are baked against. */
  DEAL_CENTER_PRICING: 'deal-center-pricing',
  /** `GET /company/v1/job-builder-products` — System B: the job builder's verticals and tabs. */
  JOB_BUILDER_CONFIG: 'job-builder-config',
  /** `GET /payment-plans/v1/sales/provider-plans` — the rollout's plans and their minimums. */
  PAYMENT_PLANS: 'payment-plans',
  /** `GET /company/v1/discount-config/sales` — pre-order tiers and the Sr+Vet percentage. */
  DISCOUNT_CONFIG: 'discount-config',

  // ── The agreement ───────────────────────────────────────────────────────────
  // These two are what make an agreement generatable at a door with no signal. The layout, the
  // company's header and terms, and the Description-of-Work rules are all company setup — so the
  // device can render the SAME document the server would, from data it already holds, instead of
  // asking for a PDF it cannot be given.
  //
  // ⚠️ Without them there is no offline agreement AT ALL, and the failure is quiet: the rep taps
  // Generate and gets an error. That is why the Job Builder warms them on mount while there is
  // still signal, rather than waiting for the moment they are needed.
  /** `GET /sales-rep/v1/agreement-config` — header, styles and the ordered content blocks. */
  AGREEMENT_CONFIG: 'agreement-config',
  /** `GET /sales-rep/v1/description-schema/:id` — per product; the Description of Work rules. */
  DESCRIPTION_SCHEMA: 'description-schema',
  /**
   * The company logo, already base64.
   *
   * ⚠️ Cached as BYTES, unlike everything else here, and deliberately: resolving it costs a
   * presigned-url call plus a download, and the presigned url expires — so caching the url would
   * cache something that stops working. Without it an agreement signed at a door is missing the
   * company's mark, which is a visibly different contract from the one signed with signal.
   */
  COMPANY_LOGO: 'company-logo',
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


// ─── Read-through caching for a config query ──────────────────────────────────

/**
 * Fetch, and keep a copy so the same call works with no signal.
 *
 * Wraps a `queryFn` so the three cases are handled in one place rather than in each hook:
 *
 *   online, fetch works    -> return it, and save it
 *   online, fetch fails    -> serve the saved copy if there is one, else rethrow
 *   offline                -> serve the saved copy, never attempt the request
 *
 * ⚠️ Offline it does NOT call the fetcher at all. Letting it run means every Deal Center open
 * waits out an axios timeout per config before rendering anything — four of them, in series.
 *
 * ⚠️ An EMPTY result is never written over a good copy, and this is the trap worth knowing. A
 * company config endpoint answering `[]` once — a deploy, a permissions blip, a 200 with an empty
 * body — would otherwise poison the cache permanently: the rep goes offline and the Deal Center is
 * empty, with no way to tell that from a company that genuinely has nothing configured.
 */
export const cachedFetch = async <T,>(
  name: string,
  fetcher: () => Promise<T>,
  options: {
    /**
     * ⚠️ INJECTED, not read from `services/connectivity`. That module binds NetInfo, and importing
     * it here would drag a native dependency into a storage util — the same separation
     * `utils/connectivity-state.ts` already keeps, which is what makes both testable.
     */
    online: boolean;
    userId?: string | null;
    /** Override when "empty" is not simply null/[]/{} — e.g. a wrapper object with a rows array. */
    isEmpty?: (data: T) => boolean;
  }
): Promise<T> => {
  const { online, userId, isEmpty = defaultIsEmpty } = options;

  const cached = (): T | undefined => readOfflineCache<T>(name, { userId })?.data;

  if (!online) {
    const saved = cached();
    if (saved !== undefined) return saved;
    // Honest failure: the caller's own fallback (a bundled template, a static plan list) is a
    // better answer than a made-up empty one, and only the caller knows what its fallback is.
    throw new Error(`[offlineCache] ${name} is not cached and there is no connection`);
  }

  try {
    const fresh = await fetcher();
    if (!isEmpty(fresh)) writeOfflineCache(name, fresh, userId);
    return fresh;
  } catch (e) {
    const saved = cached();
    if (saved !== undefined) return saved;
    throw e;
  }
};

/** null / undefined / an empty array / an object with no keys. */
const defaultIsEmpty = (data: unknown): boolean => {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data as object).length === 0;
  return false;
};
