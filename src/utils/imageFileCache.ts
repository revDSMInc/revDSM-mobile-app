import ReactNativeBlobUtil from 'react-native-blob-util';
import { isOnline } from '../services/connectivity';
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

export const getLocalCachePath = (url: string) => {
  if (!url) return null;
  const cleanUrl = url.split('?')[0]; // drop the signature so re-signs still hit cache
  const filename = cleanUrl.split('/').pop();
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

const warmedPaths = new Map<string, string>();

export const getWarmedLocalUri = (url?: string | null): string | null => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  return (path && warmedPaths.get(path)) || null;
};

const forgetWarmedPath = (path: string) => {
  warmedPaths.delete(path);
};

export const forgetWarmedUri = async (url?: string | null): Promise<void> => {
  if (!isRemoteImageUrl(url)) return;
  const path = getLocalCachePath(url);
  if (!path) return;
  forgetWarmedPath(path);
  await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
};

export const warmToLocalCache = async (url?: string | null): Promise<string | null> => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  if (!path) return null;

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

  if (!isOnline()) return null;
  await acquireWarmSlot();
  try {
    const ok = await downloadImage(url, path);
    if (ok) {
      warmedPaths.set(path, localUri);
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
      warmedPaths.set(path, `file://${path}`);
      return true;
    }
    const tempPath = `${path}.adopt`;
    await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
    await ReactNativeBlobUtil.fs.cp(src, tempPath);
    await ReactNativeBlobUtil.fs.mv(tempPath, path);
    warmedPaths.set(path, `file://${path}`);
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
