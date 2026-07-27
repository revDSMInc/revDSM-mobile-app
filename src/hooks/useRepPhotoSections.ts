import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { buildRepPhotoSections } from '../utils/installer-photo-sections';
import type { PreInstallPhotos, PhotoSection } from '../config/types/installer';

/**
 * Pre-install tagger sections with the rep's reference photos resolved to signed URLs.
 *
 * The rep shots live as private S3 objects, so the raw `bucket/key` on each tag can't
 * be shown directly. This collects every rep key across the sections, batch-requests
 * signed URLs (`POST url/v1/secure/multiple`), and swaps them onto the tags. URLs are
 * cached 50 min — comfortably inside S3's 1-hour signature TTL. Until they resolve the
 * tags keep `hasRep` (so matching still works) but no `repPhotoUrl`, so the ghost
 * placeholder shows for the brief fetch.
 */
/**
 * Canonical form of an S3 key, for matching a response row back to the tag that
 * asked for it.
 *
 * The two sides don't always agree byte for byte — a leading slash, surrounding
 * whitespace or percent-encoding on one side is enough to miss, and a miss looks
 * exactly like "the photo never loaded".
 */
const normalizeKey = (key?: string): string => {
  if (!key) return '';
  let value = key.trim().replace(/^\/+/, '');
  try {
    value = decodeURIComponent(value);
  } catch {
    // Already decoded, or malformed — the raw value is the best we have.
  }
  return value;
};

export function useRepPhotoSections(photos?: PreInstallPhotos): PhotoSection[] {
  const baseSections = useMemo(() => buildRepPhotoSections(photos), [photos]);

  const assets = useMemo(() => {
    const list: { bucketName: string; filePath: string }[] = [];
    baseSections.forEach((s) =>
      s.tags.forEach((t) => {
        if (t.repPhotoS3Url) {
          // An empty bucket makes the request fail for that row; the app's default
          // bucket is the right fallback, as `useLeadCenterData` also does.
          list.push({
            bucketName: t.repPhotoBucket || ENV.S3_BUCKET,
            filePath: t.repPhotoS3Url,
          });
        }
      })
    );
    return list;
  }, [baseSections]);

  const { data: secureMap } = useQuery({
    queryKey: ['repPhotoSecureUrls', assets.map((a) => a.filePath).join(',')],
    queryFn: async () => {
      if (assets.length === 0) return {};
      const res = await LeadService.getSecureUrls(assets);
      const secureData = res.data?.data || res.data || [];
      const rows: any[] = Array.isArray(secureData) ? secureData : [];

      // Keys are indexed BOTH ways: by whatever the row echoes back and by the key
      // we asked for at that position. `useProductImage` reads this endpoint purely
      // positionally, so order is dependable; the echoed `filePath` is the more
      // precise match when present. Indexing both means a mismatch in either one
      // still resolves.
      const map: Record<string, string> = {};
      rows.forEach((row, i) => {
        const secureUrl = row?.secureUrl;
        if (!secureUrl) return;
        [row?.filePath, row?.s3url, assets[i]?.filePath].forEach((candidate) => {
          const key = normalizeKey(candidate);
          if (key) map[key] = secureUrl;
        });
      });

      if (__DEV__) {
        const unresolved = assets
          .map((a) => a.filePath)
          .filter((filePath) => !map[normalizeKey(filePath)]);
        console.log(
          `[RepPhotos] requested ${assets.length}, resolved ${rows.length}` +
            (unresolved.length ? `, UNMATCHED: ${unresolved.join(', ')}` : '')
        );
      }

      return map;
    },
    enabled: assets.length > 0,
    staleTime: 1000 * 60 * 50, // signed URLs expire at 1h; refresh before then
    gcTime: 1000 * 60 * 60,
  });

  return useMemo(() => {
    if (!secureMap || Object.keys(secureMap).length === 0) return baseSections;
    return baseSections.map((s) => ({
      ...s,
      tags: s.tags.map((t) => {
        const url = t.repPhotoS3Url ? secureMap[normalizeKey(t.repPhotoS3Url)] : undefined;
        return url ? { ...t, repPhotoUrl: url } : t;
      }),
    }));
  }, [baseSections, secureMap]);
}
