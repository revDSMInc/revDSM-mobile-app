import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { resolveS3Url } from '../utils/s3-utils';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { hashString, warmToLocalCache } from '../utils/imageFileCache';
import { useAuth } from './useAuth';

interface PhotoAsset {
  s3url: string;
  bucketName?: string;
  category?: string;
  subcategory?: string;
}

const setKey = (photos: PhotoAsset[]): string =>
  `${hashString(photos.map((p) => p.s3url).join(','))}-${photos.length}`;

export function useSecureUrls(photos: PhotoAsset[] | null | undefined) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  return useQuery({
    queryKey: ['secureUrls', photos?.map((p) => p.s3url).join(',')],
    queryFn: async () => {
      if (!photos || photos.length === 0) return {};

      return cachedFetch<Record<string, Array<{ uri: string; s3url: string; subcategory: string }>>>(
        `${OFFLINE_CACHE.SECURE_URLS}:${setKey(photos)}`,
        () => resolvePhotoUrls(photos),
        { online: isOnline(), userId }
      );
    },
    enabled: !!photos && photos.length > 0,
    staleTime: 1000 * 60 * 50, // Cache pre-signed URLs for 50 minutes (to avoid expiry at 1 hour)
    gcTime: 1000 * 60 * 60,    // Keep garbage collection at 60 minutes
  });
}

async function resolvePhotoUrls(photos: PhotoAsset[]) {
      
      const filePaths = photos.map((p) => ({
        bucketName: p.bucketName || ENV.S3_BUCKET,
        filePath: p.s3url,
      }));

      const response = await LeadService.getSecureUrls(filePaths);
      const secureData = response.data?.data || response.data || [];

      const map: Record<string, Array<{ uri: string; s3url: string; subcategory: string }>> = {};
      
      photos.forEach((photo) => {
        const catName = photo.category || 'default';
        if (!map[catName]) {
          map[catName] = [];
        }
        const secured = secureData.find(
          (s: any) => s.s3url === photo.s3url || s.filePath === photo.s3url
        );
        map[catName].push({
          uri: secured?.secureUrl || resolveS3Url(photo.s3url),
          s3url: photo.s3url,
          subcategory: photo.subcategory || '',
        });
      });
      
      Object.values(map).forEach((rows) =>
        rows.forEach((row) => {
          warmToLocalCache(row.uri).catch(() => {});
        })
      );

      return map;
}
