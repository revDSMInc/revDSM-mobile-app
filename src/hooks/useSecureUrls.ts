import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { resolveS3Url } from '../utils/s3-utils';

interface PhotoAsset {
  s3url: string;
  bucketName?: string;
  category?: string;
  subcategory?: string;
}

export function useSecureUrls(photos: PhotoAsset[] | null | undefined) {
  return useQuery({
    queryKey: ['secureUrls', photos?.map((p) => p.s3url).join(',')],
    queryFn: async () => {
      if (!photos || photos.length === 0) return {};
      
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
      
      return map;
    },
    enabled: !!photos && photos.length > 0,
    staleTime: 1000 * 60 * 50, // Cache pre-signed URLs for 50 minutes (to avoid expiry at 1 hour)
    gcTime: 1000 * 60 * 60,    // Keep garbage collection at 60 minutes
  });
}
