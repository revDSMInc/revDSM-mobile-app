import { useEffect, useMemo, useState } from 'react';
import { LeadService } from '../services/api/leads';
import { getWarmedLocalUri, warmToLocalCache } from '../utils/imageFileCache';
import { Storage } from '../utils/storage';

const previewUrlCache = new Map<string, string>();

// The last pre-signed URL we resolved for a stored photo. `getLocalCachePath` drops the signature, so even an EXPIRED
// url still maps to the file we downloaded - this lets a reopened chat paint the photo from disk with no API round
// trip and no network (the old flow showed the placeholder until `getSecureUrls` answered, every cold start).
const lastUrlKey = (cacheKey: string) => `leadPreviewUrl:${cacheKey}`;

export interface LeadPreviewSource {
  bucketName?: string;
  filePath?: string;
  googleUrl?: string;
}

export function pickLeadPreviewSource(leadDetails: any): LeadPreviewSource | null {
  const top = leadDetails?.previewImage;
  if (top?.bucketName && top?.filePath) return top;

  const set = leadDetails?.previewImages;
  const candidate =
    (set?.active && set[set.active]) || set?.streetView || set?.aerial || set?.frontPhoto || null;
  if (candidate?.bucketName && candidate?.filePath) return candidate;

  if (candidate?.googleUrl) return { googleUrl: candidate.googleUrl };
  if (top?.googleUrl) return { googleUrl: top.googleUrl };
  return null;
}

export function useLeadPreviewUrl(leadDetails: any, options?: { warmGoogle?: boolean }): string | null {
  const source = useMemo(() => pickLeadPreviewSource(leadDetails), [leadDetails]);

  const directGoogle = !source?.bucketName && source?.googleUrl ? source.googleUrl : null;
  const cacheKey =
    source?.bucketName && source?.filePath ? `${source.bucketName}/${source.filePath}` : '';

  const [secureUrl, setSecureUrl] = useState<string | null>(
    cacheKey ? previewUrlCache.get(cacheKey) || null : null
  );
  // Local file copy of the stored photo (never of a Google URL: its path has no per-lead part, so the signature-less
  // cache key would collide across leads). Seeded synchronously when this session already warmed it.
  const [local, setLocal] = useState<{ key: string; uri: string } | null>(() => {
    if (!cacheKey) return null;
    const known = getWarmedLocalUri(previewUrlCache.get(cacheKey) || Storage.getItem(lastUrlKey(cacheKey)));
    return known ? { key: cacheKey, uri: known } : null;
  });
  const localUri = local && local.key === cacheKey ? local.uri : null;

  // A street-view / static-map thumbnail can be kept on disk too, but ONLY where one lead's picture is wanted at once
  // (the chat header - the list would download one per row). Its cache key includes the query (imageFileCache), so
  // leads cannot collide. Opening the gallery then paints from disk instead of fetching the same picture a second time.
  const [googleLocal, setGoogleLocal] = useState<{ url: string; uri: string } | null>(() => {
    const known = options?.warmGoogle && directGoogle ? getWarmedLocalUri(directGoogle) : null;
    return known && directGoogle ? { url: directGoogle, uri: known } : null;
  });
  useEffect(() => {
    if (!options?.warmGoogle || !directGoogle) return;
    let cancelled = false;
    warmToLocalCache(directGoogle)
      .then((file) => {
        if (file && !cancelled) setGoogleLocal({ url: directGoogle, uri: file });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [directGoogle, options?.warmGoogle]);
  const googleUri = directGoogle && googleLocal?.url === directGoogle ? googleLocal.uri : directGoogle;

  useEffect(() => {
    if (directGoogle || !cacheKey || !source?.bucketName || !source?.filePath) return;
    const { bucketName, filePath } = source;
    let cancelled = false;

    const run = async () => {
      // 1. Already on disk from an earlier open: show it at once, skip the round trip.
      const stored = Storage.getItem(lastUrlKey(cacheKey));
      if (stored) {
        const file = await warmToLocalCache(stored).catch(() => null);
        if (file) {
          if (!cancelled) setLocal({ key: cacheKey, uri: file });
          return;
        }
      }

      // 2. Resolve a fresh pre-signed URL, show it, and warm it to disk for next time.
      let url = previewUrlCache.get(cacheKey) || null;
      if (!url) {
        try {
          const res = await LeadService.getSecureUrls([{ bucketName, filePath }]);
          const item = res?.data?.data?.[0] || res?.data?.[0];
          url = item?.secureUrl || item?.url || null;
        } catch (err: any) {
          console.warn('[ChatThreads] Failed to resolve lead preview image:', err?.message || err);
          return;
        }
        if (!url) return;
        previewUrlCache.set(cacheKey, url);
      }
      if (!cancelled) setSecureUrl(url);
      Storage.setItem(lastUrlKey(cacheKey), url);
      const file = await warmToLocalCache(url).catch(() => null);
      if (file && !cancelled) setLocal({ key: cacheKey, uri: file });
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [directGoogle, cacheKey, source?.bucketName, source?.filePath]);

  return googleUri || localUri || secureUrl;
}
