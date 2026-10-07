export const CACHE_ENVELOPE_VERSION = 1;

export interface CacheEnvelope<T = unknown> {
  v: number;
  userId: string;
  savedAt: number;
  data: T;
}

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
  userId?: string | null;
  maxAgeMs?: number;
  now?: number;
}

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

  if (typeof maxAgeMs === 'number' && maxAgeMs >= 0) {
    const age = Math.max(0, now - savedAt);
    if (age > maxAgeMs) return null;
  }

  return { data: parsed.data as T, savedAt };
};
