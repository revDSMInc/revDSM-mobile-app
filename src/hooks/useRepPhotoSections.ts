import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { buildRepPhotoSections } from '../utils/installer-photo-sections';
import type { PreInstallPhotos, PhotoSection } from '../config/types/installer';

const normalizeKey = (key?: string): string => {
  if (!key) return '';
  let value = key.trim().replace(/^\/+/, '');
  try {
    value = decodeURIComponent(value);
  } catch {
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
