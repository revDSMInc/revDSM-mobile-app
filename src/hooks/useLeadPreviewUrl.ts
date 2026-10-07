import { useEffect, useMemo, useState } from 'react';
import { LeadService } from '../services/api/leads';

const previewUrlCache = new Map<string, string>();

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

export function useLeadPreviewUrl(leadDetails: any): string | null {
  const source = useMemo(() => pickLeadPreviewSource(leadDetails), [leadDetails]);

  const directGoogle = !source?.bucketName && source?.googleUrl ? source.googleUrl : null;
  const cacheKey =
    source?.bucketName && source?.filePath ? `${source.bucketName}/${source.filePath}` : '';

  const [secureUrl, setSecureUrl] = useState<string | null>(
    cacheKey ? previewUrlCache.get(cacheKey) || null : null
  );

  useEffect(() => {
    if (directGoogle || !cacheKey || !source?.bucketName || !source?.filePath) return;

    const cached = previewUrlCache.get(cacheKey);
    if (cached) {
      setSecureUrl(cached);
      return;
    }

    let cancelled = false;
    LeadService.getSecureUrls([{ bucketName: source.bucketName, filePath: source.filePath }])
      .then((res) => {
        const item = res?.data?.data?.[0] || res?.data?.[0];
        const url = item?.secureUrl || item?.url || null;
        if (!url) return;
        previewUrlCache.set(cacheKey, url);
        if (!cancelled) setSecureUrl(url);
      })
      .catch((err) => {
        console.warn('[ChatThreads] Failed to resolve lead preview image:', err?.message || err);
      });

    return () => {
      cancelled = true;
    };
  }, [directGoogle, cacheKey, source?.bucketName, source?.filePath]);

  return directGoogle || secureUrl;
}
