export const CACHE_FILE_PREFIX = 'revrender_';

export const DEFAULT_CACHE_BUDGET_BYTES = 500 * 1024 * 1024;

export const EVICTION_TARGET_RATIO = 0.8;

export interface CacheFileEntry {
  path: string;
  size: number;
  mtime: number;
}

export const isCacheFile = (path: string): boolean => {
  if (typeof path !== 'string' || !path) return false;
  const name = path.split('/').pop() || '';
  return name.startsWith(CACHE_FILE_PREFIX);
};

export const totalBytes = (entries: CacheFileEntry[]): number =>
  (entries || []).reduce((n, e) => n + (Number(e?.size) > 0 ? Number(e.size) : 0), 0);

export const selectEvictions = (
  entries: CacheFileEntry[],
  budget: number = DEFAULT_CACHE_BUDGET_BYTES,
  protectedPaths: Iterable<string> = []
): string[] => {
  const owned = (entries || []).filter((e) => e && isCacheFile(e.path));
  const used = totalBytes(owned);
  if (!(budget > 0) || used <= budget) return [];

  const keep = new Set(protectedPaths);
  const target = Math.max(0, Math.floor(budget * EVICTION_TARGET_RATIO));

  const candidates = owned
    .filter((e) => !keep.has(e.path))
    .sort((a, b) => (a.mtime - b.mtime) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const out: string[] = [];
  let remaining = used;
  for (const entry of candidates) {
    if (remaining <= target) break;
    out.push(entry.path);
    remaining -= Number(entry.size) > 0 ? Number(entry.size) : 0;
  }
  return out;
};

export const formatBytes = (bytes: number): string => {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return '0 MB';
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (mb < 100) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
};
