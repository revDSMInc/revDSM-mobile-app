// Local-FILE image cache for pre-signed S3 URLs.
//
// Why this exists instead of `Image.prefetch`: our photo/render URLs are
// pre-signed S3 links that carry NO cache headers, so the OS image cache treats
// them as non-storable. A thumbnail can be on screen and a full-size decode of
// the SAME url still misses and re-downloads — which is what made the
// hold-to-peek preview sit blank for 2–3 seconds. Downloading to a real file in
// CacheDir and rendering `file://…` sidesteps the HTTP cache entirely.
//
// Extracted from `widgets/modals/lead-center/RevRenderHistoryModal.tsx`, which
// still re-exports `getLocalCachePath` / `prefetchToLocalCache` for its existing
// callers. Lives here so a leaf widget (PhotoPeekPressable) can warm images
// without importing a heavy modal screen.

import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  DEFAULT_CACHE_BUDGET_BYTES,
  formatBytes,
  isCacheFile,
  selectEvictions,
  totalBytes,
  type CacheFileEntry,
} from './image-cache-policy';

// Tracks in-flight downloads so two callers asking for the same image share one
// request instead of racing to write the same file.
const activeDownloads = new Map<string, Promise<boolean>>();

/**
 * Stable short hash (djb2) of a string — makes the cache filename unique, and is exported
 * because the offline photo cache keys a whole photo SET the same way.
 */
export const hashString = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** Only http(s) URLs are worth caching — `file://`, `data:` and bundled assets are already local. */
export const isRemoteImageUrl = (url?: string | null): url is string =>
  typeof url === 'string' && /^https?:\/\//i.test(url);

/** Resolve the on-disk cache path for a pre-signed S3 URL. */
export const getLocalCachePath = (url: string) => {
  if (!url) return null;
  const cleanUrl = url.split('?')[0]; // drop the signature so re-signs still hit cache
  const filename = cleanUrl.split('/').pop();
  if (!filename) return null;
  // Key on the FULL object path, not just the basename: different renders routinely
  // share a filename (e.g. ".../<runIdA>/generated.png" vs ".../<runIdB>/generated.png"),
  // and keying on the basename alone made them collide in the cache — so a cached render
  // showed in place of another ("white overtook both", wrong image when navigating). The
  // hash disambiguates while the readable suffix keeps the file recognisable.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${ReactNativeBlobUtil.fs.dirs.CacheDir}/revrender_${hashString(cleanUrl)}_${safeName}`;
};

/** Download to `path`, ensuring only one download runs per cache path. */
export const downloadImage = (url: string, path: string): Promise<boolean> => {
  const existingTask = activeDownloads.get(path);
  if (existingTask) {
    return existingTask;
  }

  const promise = (async () => {
    // Write to a temp file and move it into place, so a download interrupted by a
    // backgrounded app can never leave a truncated image at the real cache path.
    const tempPath = `${path}.tmp`;
    try {
      const exists = await ReactNativeBlobUtil.fs.exists(path);
      if (exists) return true;

      const res = await ReactNativeBlobUtil.config({ path: tempPath }).fetch('GET', url);
      const status = res.info().status;
      if (status === 200) {
        await ReactNativeBlobUtil.fs.mv(tempPath, path);
        return true;
      }
      await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
      return false;
    } catch {
      await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
      return false;
    } finally {
      activeDownloads.delete(path);
    }
  })();

  activeDownloads.set(path, promise);
  return promise;
};

/** Fire-and-forget warm of a single URL into the file cache. */
export const prefetchToLocalCache = async (url: string) => {
  const path = getLocalCachePath(url);
  if (!path) return;
  await downloadImage(url, path);
};

// ── warm queue ──────────────────────────────────────────────────────────────
// A photo grid can mount 20+ thumbnails at once (Manage Photos ▸ Roofline is
// 0/22). Warming all of them in parallel would saturate the connection and make
// the VISIBLE thumbnails load slower — the opposite of the goal. A small
// semaphore keeps a few downloads moving while the rest wait their turn.
const MAX_CONCURRENT_WARMS = 3;
let activeWarms = 0;
const warmQueue: Array<() => void> = [];

const acquireWarmSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeWarms < MAX_CONCURRENT_WARMS) {
      activeWarms += 1;
      resolve();
    } else {
      warmQueue.push(() => {
        activeWarms += 1;
        resolve();
      });
    }
  });

const releaseWarmSlot = () => {
  activeWarms = Math.max(0, activeWarms - 1);
  warmQueue.shift()?.();
};

// ── warmed-uri memo ───────────────────────────────────────────────────────
// Which photos are already on disk. `warmToLocalCache` is the only writer.
//
// Without it every remount pays an async `fs.exists` hop before it can even name the
// file to render, so a grid that is FULLY cached still paints spinners on the way back
// to it — the "the images load again every time I come back" report on revRender. The
// memo lets a caller resolve the local copy SYNCHRONOUSLY, on the first render.
//
// ⚠️ Keyed by the CACHE PATH, never by the url. Photo links are pre-signed and re-signed
// on every read of the lead, so the same photo arrives under a different url each visit;
// it is `getLocalCachePath` dropping the query that makes the second visit a hit. Keying
// on the url itself would miss every time and look exactly like no cache at all.
const warmedPaths = new Map<string, string>();

/**
 * The local `file://` copy of `url` if it is already known to be on disk, else null —
 * with no await. Seed component state with this so a cached image renders on the FIRST
 * frame; when it returns null, fall back to `warmToLocalCache` as usual.
 */
export const getWarmedLocalUri = (url?: string | null): string | null => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  return (path && warmedPaths.get(path)) || null;
};

/** Forget a path once it is unlinked, so the next ask re-downloads rather than handing
 *  back a `file://` that no longer resolves. */
const forgetWarmedPath = (path: string) => {
  warmedPaths.delete(path);
};

/**
 * Drop `url`'s cached copy — the memo entry AND the file — so the next warm downloads it
 * again. Backs a "tap to retry" on an image that failed to render: without the unlink the
 * retry just re-renders the same broken file forever.
 */
export const forgetWarmedUri = async (url?: string | null): Promise<void> => {
  if (!isRemoteImageUrl(url)) return;
  const path = getLocalCachePath(url);
  if (!path) return;
  forgetWarmedPath(path);
  await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
};

/**
 * Ensure `url` exists as a local file and return its `file://` uri, or null if
 * it isn't cacheable / the download failed (callers then fall back to the
 * network url). Returns immediately when the file is already on disk.
 */
export const warmToLocalCache = async (url?: string | null): Promise<string | null> => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  if (!path) return null;

  // Already known to be on disk — answer without touching the filesystem at all.
  const memoed = warmedPaths.get(path);
  if (memoed) return memoed;

  const localUri = `file://${path}`;
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      warmedPaths.set(path, localUri);
      return localUri;
    }
  } catch {
    return null;
  }

  await acquireWarmSlot();
  try {
    const ok = await downloadImage(url, path);
    if (ok) {
      warmedPaths.set(path, localUri);
      // Self-managing: the cache trims itself as it grows rather than needing a caller to
      // remember. Internally throttled to once a minute, so a grid warming 22 thumbnails
      // sweeps the directory once, not 22 times. Deliberately NOT awaited — the photo is on
      // disk and the caller should paint it now.
      void enforceImageCacheBudget();
    }
    return ok ? localUri : null;
  } catch {
    return null;
  } finally {
    releaseWarmSlot();
  }
};

// ── budget ──────────────────────────────────────────────────────────────────
// This cache existed to make a preview instant, so it was allowed to grow without a
// ceiling — nothing was kept on purpose and the OS could reclaim CacheDir at will.
// Offline mode keeps a lead's photos DELIBERATELY, so the cache is now managed: it
// reports its size, evicts oldest-first past a budget, and can be cleared by the rep.
// The rules live in `image-cache-policy.ts`, testable without the native module.

const CACHE_DIR = ReactNativeBlobUtil.fs.dirs.CacheDir;

/** Paths currently being written. Never evicted mid-download. */
const inFlightPaths = (): Set<string> => new Set(activeDownloads.keys());

/** Every file THIS cache owns, with size and write time. Never throws. */
const listCacheFiles = async (): Promise<CacheFileEntry[]> => {
  try {
    const stats: any[] = await ReactNativeBlobUtil.fs.lstat(CACHE_DIR);
    if (!Array.isArray(stats)) return [];
    return stats
      .filter((f) => f && f.type === 'file' && isCacheFile(String(f.filename || f.path || '')))
      .map((f) => ({
        // `lstat` reports `filename` relative to the directory; rebuild the full path so
        // eviction can unlink it and `protectedPaths` can be compared like for like.
        path: String(f.path || `${CACHE_DIR}/${f.filename}`),
        size: Number(f.size) || 0,
        mtime: Number(f.lastModified) || 0,
      }));
  } catch {
    return [];
  }
};

export interface CacheUsage {
  bytes: number;
  files: number;
  budgetBytes: number;
  /** Ready to render, e.g. "412 MB / 500 MB". */
  label: string;
}

/** What the cache is currently holding. Drives the Profile row. */
export const getImageCacheUsage = async (
  budget: number = DEFAULT_CACHE_BUDGET_BYTES
): Promise<CacheUsage> => {
  const files = await listCacheFiles();
  const bytes = totalBytes(files);
  return {
    bytes,
    files: files.length,
    budgetBytes: budget,
    label: `${formatBytes(bytes)} / ${formatBytes(budget)}`,
  };
};

// Sweeping lists and stats the whole directory, so it must not run per download. A grid
// warming 22 thumbnails would otherwise sweep 22 times for one lead.
const BUDGET_CHECK_INTERVAL_MS = 60_000;
let lastBudgetCheck = 0;
let budgetCheckInFlight = false;

/**
 * Trim the cache back under budget, oldest download first.
 *
 * ⚠️ Only ever unlinks files carrying this cache's own prefix — see `CACHE_FILE_PREFIX`.
 * The directory is shared, and on Android it can hold camera output the upload queue has
 * not sent yet; a sweep by directory would silently destroy a rep's unsynced photo.
 */
export const enforceImageCacheBudget = async (
  budget: number = DEFAULT_CACHE_BUDGET_BYTES,
  { force = false }: { force?: boolean } = {}
): Promise<number> => {
  const now = Date.now();
  if (!force && (budgetCheckInFlight || now - lastBudgetCheck < BUDGET_CHECK_INTERVAL_MS)) return 0;
  budgetCheckInFlight = true;
  lastBudgetCheck = now;
  try {
    const victims = selectEvictions(await listCacheFiles(), budget, inFlightPaths());
    let removed = 0;
    for (const path of victims) {
      // Forget it FIRST, and whether or not the unlink lands: a memo entry pointing at
      // a file this sweep has decided to remove is the one thing that must not survive.
      forgetWarmedPath(path);
      try {
        await ReactNativeBlobUtil.fs.unlink(path);
        removed += 1;
      } catch {
        // A file already gone, or locked by a decode in progress. Skip it; the next
        // sweep will catch it. A failed unlink must never abort the rest of the trim.
      }
    }
    return removed;
  } catch {
    return 0;
  } finally {
    budgetCheckInFlight = false;
  }
};

/** Delete every cached photo. Backs the Profile "Clear" action. */
export const clearImageCache = async (): Promise<number> => {
  let removed = 0;
  for (const file of await listCacheFiles()) {
    forgetWarmedPath(file.path);
    try {
      await ReactNativeBlobUtil.fs.unlink(file.path);
      removed += 1;
    } catch {
      /* keep going — a partial clear beats aborting on one locked file */
    }
  }
  lastBudgetCheck = 0;
  return removed;
};
