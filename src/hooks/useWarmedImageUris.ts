import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forgetWarmedUri,
  getWarmedLocalUri,
  isRemoteImageUrl,
  verifyIndexedUri,
  warmToLocalCache,
} from '../utils/imageFileCache';

export function useWarmedImageUris(uris: string[]): Record<string, string> {
  const key = uris.join('|');

  const seed = useMemo(() => {
    const out: Record<string, string> = {};
    uris.forEach((uri) => {
      if (!uri) return;
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
  // Seeds that turned out NOT to be on disk any more (the OS purged the cache): dropped so the photo falls back to its url.
  const [stale, setStale] = useState<Record<string, true>>({});

  const warmed = useMemo(() => {
    const out: Record<string, string> = { ...downloaded };
    Object.keys(seed).forEach((u) => {
      if (!stale[u]) out[u] = seed[u];
      else delete out[u];
    });
    return out;
  }, [downloaded, seed, stale]);

  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    let cancelled = false;
    const resolve = (uri: string, value: string) => {
      if (cancelled) return;
      setDownloaded((prev) => (prev[uri] === value ? prev : { ...prev, [uri]: value }));
    };
    uris.forEach((uri) => {
      if (!uri) return;
      if (seedRef.current[uri]) {
        // Painted from the persisted cache index straight away; confirm the file is really there (once per session).
        if (!isRemoteImageUrl(uri)) return;
        verifyIndexedUri(uri)
          .then(async (ok) => {
            if (ok || cancelled) return;
            setStale((prev) => ({ ...prev, [uri]: true }));
            await forgetWarmedUri(uri);
            const file = await warmToLocalCache(uri);
            resolve(uri, file || uri);
          })
          .catch(() => {});
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
