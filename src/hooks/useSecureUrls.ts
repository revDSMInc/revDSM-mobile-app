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

/**
 * A stable, short cache key for a photo SET.
 *
 * The set is identified by its s3 keys, which run to hundreds of characters across a lead's
 * photos — too long to use as a storage key directly, and the identity is all that matters.
 */
const setKey = (photos: PhotoAsset[]): string =>
  `${hashString(photos.map((p) => p.s3url).join(','))}-${photos.length}`;

export function useSecureUrls(photos: PhotoAsset[] | null | undefined) {
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  return useQuery({
    queryKey: ['secureUrls', photos?.map((p) => p.s3url).join(',')],
    queryFn: async () => {
      if (!photos || photos.length === 0) return {};

      // Keyed by the SET, so the Investment Center's renders and a tab's inspection photos
      // never overwrite each other's snapshot.
      //
      // ⚠️ The stored urls are presigned and EXPIRE in an hour, so a recalled map is dead as a
      // network address — and is still exactly what is needed. `getLocalCachePath` strips the
      // query, so an expired url names the same on-disk file the live one downloaded, which is
      // how an offline device finds photos it already has. Do NOT "fix" this by dropping the
      // cache on expiry.
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
        // The secure-URL API needs a real bucket; fall back to the env bucket
        // exactly like the LeadCenter photo grid does (useLeadCenterData).
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
          // Fall back to a fully-qualified S3 URL (not the bare key) so the
          // <Image> can actually render when the secure lookup misses.
          uri: secured?.secureUrl || resolveS3Url(photo.s3url),
          s3url: photo.s3url,
          subcategory: photo.subcategory || '',
        });
      });
      
      // Pull the bytes down so the same photos render with no signal. Fire-and-forget and
      // capped inside `imageFileCache`, so it never delays the grid that asked for them.
      Object.values(map).forEach((rows) =>
        rows.forEach((row) => {
          warmToLocalCache(row.uri).catch(() => {});
        })
      );

      return map;
}
