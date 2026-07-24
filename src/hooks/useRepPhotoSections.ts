import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
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
export function useRepPhotoSections(photos?: PreInstallPhotos): PhotoSection[] {
  const baseSections = useMemo(() => buildRepPhotoSections(photos), [photos]);

  const assets = useMemo(() => {
    const list: { bucketName: string; filePath: string }[] = [];
    baseSections.forEach((s) =>
      s.tags.forEach((t) => {
        if (t.repPhotoS3Url) {
          list.push({ bucketName: t.repPhotoBucket || '', filePath: t.repPhotoS3Url });
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
      const map: Record<string, string> = {};
      secureData.forEach((d: any) => {
        const key = d?.filePath || d?.s3url;
        if (key && d?.secureUrl) map[key] = d.secureUrl;
      });
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
      tags: s.tags.map((t) =>
        t.repPhotoS3Url && secureMap[t.repPhotoS3Url]
          ? { ...t, repPhotoUrl: secureMap[t.repPhotoS3Url] }
          : t
      ),
    }));
  }, [baseSections, secureMap]);
}
