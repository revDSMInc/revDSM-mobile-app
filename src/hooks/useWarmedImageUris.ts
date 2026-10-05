import { useEffect, useMemo, useRef, useState } from 'react';
import { getWarmedLocalUri, isRemoteImageUrl, warmToLocalCache } from '../utils/imageFileCache';

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
 *
 * ⚠️ **The map is seeded SYNCHRONOUSLY, on the first render.** Everything already
 * resolvable without I/O — a `file://` / `data:` uri, which IS its own local copy,
 * and any remote url `imageFileCache` already knows is on disk — is in the returned
 * map before the first paint, so a caller that renders a spinner for `undefined`
 * never flashes one for a photo it could already draw.
 *
 * That flash was the bug: an OFFLINE photo is a local `file://` from the upload
 * queue, so there was nothing to download and nothing to wait for, yet resolving it
 * through `setState` in an effect left it `undefined` for the first frame and every
 * tile in Manage Photos painted a spinner over a photo that was sitting on the disk.
 * On reconnect the list identity changes, the effect re-runs, and the spinners came
 * back a second time — the "keeps loading after the network restores" report.
 */
export function useWarmedImageUris(uris: string[]): Record<string, string> {
  // Depend on the joined key, not the array identity — callers build the array
  // inline, and a fresh array each render would restart every download every render.
  const key = uris.join('|');

  // What is resolvable with NO I/O, recomputed whenever the list changes. This is the
  // floor the state can never fall below, so a re-render or a list change can never
  // un-resolve a photo that is already on disk.
  const seed = useMemo(() => {
    const out: Record<string, string> = {};
    uris.forEach((uri) => {
      if (!uri) return;
      // Already local (a just-captured or queued `file://` photo, a data: uri): it IS
      // the local copy. Nothing to download, so it must never read as "loading".
      if (!isRemoteImageUrl(uri)) out[uri] = uri;
      else {
        const known = getWarmedLocalUri(uri);
        if (known) out[uri] = known;
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [downloaded, setDownloaded] = useState<Record<string, string>>({});

  // Accumulated across list changes on purpose: scrolling or a refetch rebuilds the
  // array, and dropping what we already resolved would repaint spinners over photos
  // that never left the disk.
  const warmed = useMemo(() => ({ ...downloaded, ...seed }), [downloaded, seed]);

  // The effect reads the seed without depending on it, so a seed change alone does
  // not restart downloads.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    let cancelled = false;
    const resolve = (uri: string, value: string) => {
      if (cancelled) return;
      setDownloaded((prev) => (prev[uri] ? prev : { ...prev, [uri]: value }));
    };
    uris.forEach((uri) => {
      if (!uri) return;
      // Already answered synchronously — no request, no state write, no re-render.
      if (seedRef.current[uri]) return;
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
