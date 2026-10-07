import { useEffect, useMemo, useRef, useState } from 'react';
import { getWarmedLocalUri, isRemoteImageUrl, warmToLocalCache } from '../utils/imageFileCache';

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

  const warmed = useMemo(() => ({ ...downloaded, ...seed }), [downloaded, seed]);

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
