/**
 * offline-cache-envelope.ts — the pure rules for a snapshot kept on disk so a screen can
 * still render it after the app has been killed with no signal.
 *
 * ⚠️ This is deliberately NOT a general query persister. It is a narrow store for small,
 * slow-moving CONFIG documents (the inspection photo schema being the first), whose absence
 * does not merely blank a screen but changes which code path the app takes. The inspection
 * schema is the cautionary tale: with it missing, `JobDocsSection` silently fell back to the
 * legacy hardcoded photo flow, which stores a photo's category UNSCOPED (`"Home"` rather than
 * `"Gutters/Roofline — HOME"`). Those photos then matched no configured slot when the rep came
 * back online and landed in "+ UNSORTED", uncounted and — since orphan cards are display-only —
 * impossible to re-file.
 *
 * The MMKV binding lives in `offline-query-cache.ts`; everything that can be SILENTLY wrong is
 * here, where it can be tested without the native module.
 */

/** Bumped whenever the stored shape changes. A mismatch is discarded, never migrated. */
export const CACHE_ENVELOPE_VERSION = 1;

export interface CacheEnvelope<T = unknown> {
  v: number;
  /** Who this snapshot belongs to. See `decodeEnvelope` — this is a correctness gate. */
  userId: string;
  /** `Date.now()` at write. Feeds React Query's `initialDataUpdatedAt`. */
  savedAt: number;
  data: T;
}

/**
 * ⚠️ Every snapshot is USER-SCOPED, and that is not tidiness.
 *
 * These documents are company-scoped by the JWT. Two reps from different companies can share a
 * device, and serving rep B a schema fetched for company A would show them product tabs their
 * company does not have and file photos against products that do not exist on their leads —
 * silently, and only offline, which is the hardest place to notice it.
 *
 * A missing id reads as `anon` rather than being allowed to match anything.
 */
export const buildCacheKey = (name: string, userId?: string | null): string =>
  `offline-cache:${name}:${(typeof userId === 'string' && userId.trim()) || 'anon'}`;

export const encodeEnvelope = <T,>(data: T, userId: string | null | undefined, now: number = Date.now()): string =>
  JSON.stringify({
    v: CACHE_ENVELOPE_VERSION,
    userId: (typeof userId === 'string' && userId.trim()) || 'anon',
    savedAt: now,
    data,
  } as CacheEnvelope<T>);

export interface DecodeOptions {
  /** Reject a snapshot written for anyone else. */
  userId?: string | null;
  /** Optional ceiling. Omit for "any age beats nothing". */
  maxAgeMs?: number;
  now?: number;
}

/**
 * Parse a stored snapshot, or `null` if it must not be used.
 *
 * ⚠️ Returns `null` for ANY doubt — unparseable, wrong version, wrong owner, too old. A caller
 * that gets `null` behaves exactly as it did before this cache existed; a caller that gets a
 * WRONG snapshot behaves plausibly and incorrectly, which is far worse.
 */
export const decodeEnvelope = <T,>(
  raw: string | null | undefined,
  { userId, maxAgeMs, now = Date.now() }: DecodeOptions = {}
): { data: T; savedAt: number } | null => {
  if (typeof raw !== 'string' || !raw) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.v !== CACHE_ENVELOPE_VERSION) return null;
  if (parsed.data === undefined) return null;

  const savedAt = typeof parsed.savedAt === 'number' && isFinite(parsed.savedAt) ? parsed.savedAt : 0;
  if (!savedAt) return null;

  const owner = (typeof userId === 'string' && userId.trim()) || 'anon';
  if (parsed.userId !== owner) return null;

  // A clock that moved backwards (timezone change, manual set) must not make a snapshot look
  // like it came from the future and live forever — treat any negative age as age 0.
  if (typeof maxAgeMs === 'number' && maxAgeMs >= 0) {
    const age = Math.max(0, now - savedAt);
    if (age > maxAgeMs) return null;
  }

  return { data: parsed.data as T, savedAt };
};
