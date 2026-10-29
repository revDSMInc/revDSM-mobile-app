import ReactNativeBlobUtil from 'react-native-blob-util';
import { isOnline } from '../services/connectivity';
import { storage } from './storage';
import {
  DEFAULT_CACHE_BUDGET_BYTES,
  formatBytes,
  isCacheFile,
  selectEvictions,
  totalBytes,
  type CacheFileEntry,
} from './image-cache-policy';

const activeDownloads = new Map<string, Promise<boolean>>();

export const hashString = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

export const isRemoteImageUrl = (url?: string | null): url is string =>
  typeof url === 'string' && /^https?:\/\//i.test(url);

// ⚠️ Google Maps image urls (street view / static map) carry EVERYTHING that identifies the picture - location, size,
// heading - in the QUERY. Dropping it, as for a signed S3 url, made every lead's street view share one cache file.
const isQueryKeyedUrl = (url: string): boolean => /^https?:\/\/maps\.(googleapis|google)\.com\//i.test(url);

export const getLocalCachePath = (url: string) => {
  if (!url) return null;
  // drop the signature so re-signs still hit cache - except where the query IS the identity (see above)
  const cleanUrl = isQueryKeyedUrl(url) ? url : url.split('?')[0];
  const filename = url.split('?')[0].split('/').pop();
  if (!filename) return null;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${ReactNativeBlobUtil.fs.dirs.CacheDir}/revrender_${hashString(cleanUrl)}_${safeName}`;
};

export const downloadImage = (url: string, path: string): Promise<boolean> => {
  const existingTask = activeDownloads.get(path);
  if (existingTask) {
    return existingTask;
  }

  const promise = (async () => {
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

export const prefetchToLocalCache = async (url: string) => {
  const path = getLocalCachePath(url);
  if (!path) return;
  await downloadImage(url, path);
};

const MAX_CONCURRENT_WARMS = 3;
let activeWarms = 0;
const warmQueue: Array<() => void> = [];

/**
 * ⚠️ THE QUEUE IS FIFO, AND THAT IS A USER-VISIBLE DECISION (REVUIUX-586).
 *
 * Only three warms run at once, so everything else waits its turn. A screen that queues
 * several pictures at mount therefore decides, by ORDER ALONE, which ones are ready when the
 * rep taps. The RevRender list queued every run's before+after and the viewer needs BOTH, so
 * the picture the rep opened was often still queued behind pictures they had not asked for -
 * "it says they're loaded already and I can see on the thumbnails it's loaded".
 *
 * `priority` jumps the waiting line for the image the rep is looking at RIGHT NOW. It does not
 * cancel or pause an in-flight download; it only reorders what has not started.
 */
const acquireWarmSlot = (priority = false): Promise<void> =>
  new Promise((resolve) => {
    if (activeWarms < MAX_CONCURRENT_WARMS) {
      activeWarms += 1;
      resolve();
    } else {
      const grant = () => {
        activeWarms += 1;
        resolve();
      };
      if (priority) warmQueue.unshift(grant);
      else warmQueue.push(grant);
    }
  });

const releaseWarmSlot = () => {
  activeWarms = Math.max(0, activeWarms - 1);
  warmQueue.shift()?.();
};

const warmedPaths = new Map<string, string>();

export const getWarmedLocalUri = (url?: string | null): string | null => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  if (!path) return null;
  const known = warmedPaths.get(path);
  if (known) return known;
  try {
    if (storage.getString(INDEX_PREFIX + path)) {
      const localUri = `file://${path}`;
      warmedPaths.set(path, localUri);
      return localUri;
    }
  } catch {
  }
  return null;
};

// ⚠️ Which cache files exist is also kept in MMKV so the FIRST render after an app launch can already point at the file
// on disk. `warmedPaths` alone is empty on a cold start, so every already-saved photo drew from its remote url (a
// spinner and a re-download) until an async `exists` check came back. The index is a hint, verified once per session
// by `verifyIndexedUri`; it is session-scoped (cleared on logout), which only costs that cold seed.
const INDEX_PREFIX = 'imgcache:';
const verifiedPaths = new Set<string>();

const rememberWarmed = (path: string, localUri: string) => {
  warmedPaths.set(path, localUri);
  try {
    storage.set(INDEX_PREFIX + path, '1');
  } catch {
  }
};

const forgetWarmedPath = (path: string) => {
  warmedPaths.delete(path);
  verifiedPaths.delete(path);
  try {
    storage.remove(INDEX_PREFIX + path);
  } catch {
  }
};

/** Confirms (once per session) that an INDEXED cache file is really on disk; forgets it when it is not. */
export const verifyIndexedUri = async (url?: string | null): Promise<boolean> => {
  if (!isRemoteImageUrl(url)) return true;
  const path = getLocalCachePath(url);
  if (!path) return false;
  if (verifiedPaths.has(path)) return true;
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      verifiedPaths.add(path);
      return true;
    }
  } catch {
  }
  forgetWarmedPath(path);
  return false;
};

export const forgetWarmedUri = async (url?: string | null): Promise<void> => {
  if (!isRemoteImageUrl(url)) return;
  const path = getLocalCachePath(url);
  if (!path) return;
  forgetWarmedPath(path);
  await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
};

/**
 * Download `url` into the on-disk cache and return its `file://` path.
 *
 * `priority` puts it at the FRONT of the warm queue - use it for the picture the rep is
 * opening now, so it is not stuck behind a screenful of pictures they have not asked for.
 */
export const warmToLocalCache = async (
  url?: string | null,
  priority = false
): Promise<string | null> => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  if (!path) return null;

  const memoed = warmedPaths.get(path);
  if (memoed) return memoed;

  const localUri = `file://${path}`;
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      rememberWarmed(path, localUri);
      verifiedPaths.add(path);
      return localUri;
    }
  } catch {
    return null;
  }

  if (!isOnline()) return null;
  await acquireWarmSlot(priority);
  try {
    const ok = await downloadImage(url, path);
    if (ok) {
      rememberWarmed(path, localUri);
      verifiedPaths.add(path);
      void enforceImageCacheBudget();
    }
    return ok ? localUri : null;
  } catch {
    return null;
  } finally {
    releaseWarmSlot();
  }
};

const CACHE_DIR = ReactNativeBlobUtil.fs.dirs.CacheDir;

const inFlightPaths = (): Set<string> => new Set(activeDownloads.keys());

const listCacheFiles = async (): Promise<CacheFileEntry[]> => {
  try {
    const stats: any[] = await ReactNativeBlobUtil.fs.lstat(CACHE_DIR);
    if (!Array.isArray(stats)) return [];
    return stats
      .filter((f) => f && f.type === 'file' && isCacheFile(String(f.filename || f.path || '')))
      .map((f) => ({
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
  label: string;
}

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

const BUDGET_CHECK_INTERVAL_MS = 60_000;
let lastBudgetCheck = 0;
let budgetCheckInFlight = false;

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
      forgetWarmedPath(path);
      try {
        await ReactNativeBlobUtil.fs.unlink(path);
        removed += 1;
      } catch {
      }
    }
    return removed;
  } catch {
    return 0;
  } finally {
    budgetCheckInFlight = false;
  }
};

export const adoptLocalFileAsCached = async (
  localUri?: string | null,
  url?: string | null
): Promise<boolean> => {
  if (!localUri || !isRemoteImageUrl(url)) return false;
  const path = getLocalCachePath(url);
  if (!path) return false;
  if (warmedPaths.has(path) || activeDownloads.has(path)) return true;
  const src = localUri.replace(/^file:\/\//, '');
  try {
    if (!(await ReactNativeBlobUtil.fs.exists(src))) return false;
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      rememberWarmed(path, `file://${path}`);
      verifiedPaths.add(path);
      return true;
    }
    const tempPath = `${path}.adopt`;
    await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
    await ReactNativeBlobUtil.fs.cp(src, tempPath);
    await ReactNativeBlobUtil.fs.mv(tempPath, path);
    rememberWarmed(path, `file://${path}`);
    verifiedPaths.add(path);
    void enforceImageCacheBudget();
    return true;
  } catch {
    return false;
  }
};

export const clearImageCache = async (): Promise<number> => {
  let removed = 0;
  for (const file of await listCacheFiles()) {
    forgetWarmedPath(file.path);
    try {
      await ReactNativeBlobUtil.fs.unlink(file.path);
      removed += 1;
    } catch {
    }
  }
  lastBudgetCheck = 0;
  return removed;
};

/** Delete one cache file (and its index entry). Resolves true when a file was removed. */
export const removeCachedPath = async (path: string): Promise<boolean> => {
  if (!isCacheFile(path)) return false;
  forgetWarmedPath(path);
  try {
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return false;
    await ReactNativeBlobUtil.fs.unlink(path);
    return true;
  } catch {
    return false;
  }
};
