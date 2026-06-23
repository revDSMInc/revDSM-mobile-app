import { useQuery } from '@tanstack/react-query';
import { LeadService } from '../services/api/leads';

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
        bucketName: p.bucketName || '',
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
          uri: secured?.secureUrl || photo.s3url,
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
