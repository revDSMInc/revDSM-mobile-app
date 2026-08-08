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

// Tracks in-flight downloads so two callers asking for the same image share one
// request instead of racing to write the same file.
const activeDownloads = new Map<string, Promise<boolean>>();

/** Stable short hash (djb2) of a string — used to make the cache filename unique. */
const hashString = (s: string): string => {
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

/**
 * Ensure `url` exists as a local file and return its `file://` uri, or null if
 * it isn't cacheable / the download failed (callers then fall back to the
 * network url). Returns immediately when the file is already on disk.
 */
export const warmToLocalCache = async (url?: string | null): Promise<string | null> => {
  if (!isRemoteImageUrl(url)) return null;
  const path = getLocalCachePath(url);
  if (!path) return null;

  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) return `file://${path}`;
  } catch {
    return null;
  }

  await acquireWarmSlot();
  try {
    const ok = await downloadImage(url, path);
    return ok ? `file://${path}` : null;
  } catch {
    return null;
  } finally {
    releaseWarmSlot();
  }
};
