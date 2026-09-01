import { useEffect, useState } from 'react';
import { isRemoteImageUrl, warmToLocalCache } from '../utils/imageFileCache';

/**
 * Resolve local `file://` copies for a list of image urls, returning
 * `{ [originalUrl]: fileUri }` as each download lands.
 *
 * Our photo urls are pre-signed S3 links with **no cache headers**, so the OS image
 * cache refuses to store them and `cache: 'force-cache'` on an `<Image>` buys
 * nothing — a full-size decode re-downloads and the viewer sits blank for 2–3s.
 * Rendering `warmed[url] || url` makes it open instantly once warm, and is never
 * worse than the network url before then.
 *
 * Downloads dedupe by cache path and are capped to a few at a time inside
 * `imageFileCache`, so overlapping with a grid's own thumbnail warming is free.
 *
 * Every url RESOLVES to something: a `file://` copy when the warm succeeds, and
 * the url itself when it fails or was never cacheable (`file://`, `data:`). So a
 * caller that renders `warmed[url] || url` is unaffected, and one that wants a
 * single source (no network `<Image>` racing the warm for the same bytes) can
 * render `warmed[url]` alone and treat `undefined` as still-loading - which can
 * never be a permanent spinner.
 */
export function useWarmedImageUris(uris: string[]): Record<string, string> {
  const [warmed, setWarmed] = useState<Record<string, string>>({});
  // Depend on the joined key, not the array identity — callers build the array
  // inline, and a fresh array each render would restart every download every render.
  const key = uris.join('|');

  useEffect(() => {
    let cancelled = false;
    const resolve = (uri: string, value: string) => {
      if (cancelled) return;
      setWarmed((prev) => (prev[uri] ? prev : { ...prev, [uri]: value }));
    };
    uris.forEach((uri) => {
      if (!uri) return;
      // Already local (a just-captured `file://` photo, a data: uri): it IS the
      // local copy, and leaving it unresolved would strand a single-source
      // caller on a spinner forever.
      if (!isRemoteImageUrl(uri)) {
        resolve(uri, uri);
        return;
      }
      warmToLocalCache(uri)
        .then((file) => resolve(uri, file || uri))
        .catch(() => resolve(uri, uri));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return warmed;
}
