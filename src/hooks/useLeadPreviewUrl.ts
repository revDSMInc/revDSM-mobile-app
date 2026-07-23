import { useEffect, useMemo, useState } from 'react';
import { LeadService } from '../services/api/leads';

/**
 * Resolve a lead's preview thumbnail exactly like the web list / quick-chat header
 * (`chat-thread-item.js`, `quick-chat-dialog.js`): the thumbnail is backed ONLY by
 * `previewImage` / the `previewImages` set — never `salesPhotos` or chat attachments.
 * Shared by the Recent-Leads rows (`ThreadItems`) and the open-chat header
 * (`ChatHeader`) so both resolve identically.
 */

// Secure-URL cache, shared across every consumer so the same file is not re-requested
// on each re-render / scroll / screen mount.
const previewUrlCache = new Map<string, string>();

export interface LeadPreviewSource {
  bucketName?: string;
  filePath?: string;
  googleUrl?: string;
}

/**
 * Which lead field backs the thumbnail, in web's resolve order plus the street-view
 * fallback:
 *   1. top-level `previewImage` — backend sets this to the active preview (usually
 *      the street-view); the only field the web list reads.
 *   2. the `previewImages` set — its `active` entry, else `streetView`, `aerial`,
 *      or `frontPhoto` — for leads that carry the set but no top-level preview.
 * Each entry is `{ bucketName, filePath, googleUrl }`; a `bucketName`+`filePath` pair
 * is resolved to a signed URL, otherwise the direct `googleUrl` is used.
 */
export function pickLeadPreviewSource(leadDetails: any): LeadPreviewSource | null {
  const top = leadDetails?.previewImage;
  if (top?.bucketName && top?.filePath) return top;

  const set = leadDetails?.previewImages;
  const candidate =
    (set?.active && set[set.active]) || set?.streetView || set?.aerial || set?.frontPhoto || null;
  if (candidate?.bucketName && candidate?.filePath) return candidate;

  // A source that only carries a direct Google URL (street-view / aerial) is usable as-is.
  if (candidate?.googleUrl) return { googleUrl: candidate.googleUrl };
  if (top?.googleUrl) return { googleUrl: top.googleUrl };
  return null;
}

/**
 * Resolve the lead's preview source into a displayable URL. A source with a signed-link
 * pair is resolved via `getSecureUrls`, while a source carrying only a `googleUrl`
 * (street-view) is shown directly. Returns null when the lead has no preview yet — the
 * caller renders the home-outline placeholder.
 */
export function useLeadPreviewUrl(leadDetails: any): string | null {
  const source = useMemo(() => pickLeadPreviewSource(leadDetails), [leadDetails]);

  // A street-view / aerial source with only a Google URL needs no secure-link round-trip.
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
