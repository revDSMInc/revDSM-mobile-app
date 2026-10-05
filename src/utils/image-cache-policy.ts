/**
 * image-cache-policy.ts — the pure rules for keeping the offline photo cache bounded.
 *
 * `imageFileCache.ts` downloads a pre-signed S3 photo to a real file so it can be rendered as
 * `file://` (the OS image cache refuses to store our urls — see that file's header). That was
 * written to make a hold-to-peek preview instant, and it grew without a ceiling because nothing
 * kept photos on purpose. Offline mode changes the job: we now cache a lead's photos DELIBERATELY
 * so the rep can see them with no signal, which means the cache has to be managed rather than
 * merely allowed to accumulate.
 *
 * Everything that can be silently wrong — what gets evicted, in what order, and what must never be
 * touched — lives here so it can be tested without `react-native-blob-util`, which this repo has no
 * global mock for.
 */

/**
 * ⚠️ Every cached file carries this prefix, and eviction NEVER touches anything without it.
 *
 * The cache shares a directory with whatever else the OS and other libraries put there — including,
 * on Android, camera output that the upload queue still references. A sweep by directory rather
 * than by prefix would delete a photo the rep has taken but not yet uploaded: unrecoverable, and
 * invisible until they got back to signal. Matching on the prefix means everything eviction can
 * reach is by construction a re-downloadable copy of an object the server already has.
 */
export const CACHE_FILE_PREFIX = 'revrender_';

/** 500 MB. Roughly a few thousand photos — several days of leads — on a modern device. */
export const DEFAULT_CACHE_BUDGET_BYTES = 500 * 1024 * 1024;

/**
 * Evict down to this fraction of the budget rather than to the budget itself.
 *
 * Trimming to exactly the limit means the very next photo puts us back over it and every
 * subsequent download pays for another sweep. Leaving headroom makes eviction occasional.
 */
export const EVICTION_TARGET_RATIO = 0.8;

export interface CacheFileEntry {
  path: string;
  size: number;
  /** Last write time in ms. See `selectEvictions` for why this, and not last READ. */
  mtime: number;
}

/** Only files this cache owns. Anything else in the directory is somebody else's. */
export const isCacheFile = (path: string): boolean => {
  if (typeof path !== 'string' || !path) return false;
  const name = path.split('/').pop() || '';
  return name.startsWith(CACHE_FILE_PREFIX);
};

export const totalBytes = (entries: CacheFileEntry[]): number =>
  (entries || []).reduce((n, e) => n + (Number(e?.size) > 0 ? Number(e.size) : 0), 0);

/**
 * The files to delete to bring the cache under `budget * EVICTION_TARGET_RATIO`, oldest first.
 *
 * ⚠️ Ordered by last WRITE, not last read — an approximation, and a deliberate one. Tracking reads
 * would mean a write to a side index on every thumbnail that paints, which is real churn on a grid
 * that mounts 20+ at once, and an index that can drift out of step with the directory. Write time
 * is already on the file, costs nothing, and orders the cache by which LEAD was opened most
 * recently — which is what a rep actually cares about. The cost is that a photo viewed daily for a
 * month is evicted before one downloaded yesterday and never opened again.
 *
 * ⚠️ Returns `[]` when already under budget, so the caller can skip the delete pass entirely.
 * Files not owned by the cache are dropped before anything is considered.
 */
export const selectEvictions = (
  entries: CacheFileEntry[],
  budget: number = DEFAULT_CACHE_BUDGET_BYTES,
  protectedPaths: Iterable<string> = []
): string[] => {
  const owned = (entries || []).filter((e) => e && isCacheFile(e.path));
  const used = totalBytes(owned);
  if (!(budget > 0) || used <= budget) return [];

  // A second belt beside the prefix: anything a caller says is in use right now — a photo on
  // screen, one mid-download — stays regardless of age.
  const keep = new Set(protectedPaths);
  const target = Math.max(0, Math.floor(budget * EVICTION_TARGET_RATIO));

  const candidates = owned
    .filter((e) => !keep.has(e.path))
    // Oldest write first. Ties broken by path so the order is deterministic and testable.
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

/**
 * "412 MB" / "68.4 MB" / "912 KB". Hand-rolled rather than via `Intl.NumberFormat`, for the reason
 * `formatCaptureTime` in `utils/inspection-photos.ts` is: Intl is not guaranteed to be compiled
 * into the JS engine on every device this ships to.
 */
export const formatBytes = (bytes: number): string => {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return '0 MB';
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (mb < 100) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
};
