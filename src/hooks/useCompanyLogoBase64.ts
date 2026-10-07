import { useEffect, useState } from 'react';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useAuth } from './useAuth';
import { LeadService } from '../services/api/leads';
import { OFFLINE_CACHE, cachedFetch, readOfflineCache } from '../utils/offline-query-cache';
import { isOnline } from '../services/connectivity';

const LOGO_REFRESH_MS = 24 * 60 * 60 * 1000;

export function useCompanyLogoBase64(enabled: boolean = true) {
  const { user } = useAuth();
  const source: any = user?.companyLogo || user?.profilePicture || null;
  const hasLogo = Boolean(source?.bucketName && source?.filePath);
  const userId = user?._id || user?.id;

  const [logo, setLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled && hasLogo);

  useEffect(() => {
    let active = true;

    if (!enabled || !hasLogo) {
      setLogo(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    (async () => {
      const key = `${OFFLINE_CACHE.COMPANY_LOGO}:${source.filePath}`;
      try {
        const recent = readOfflineCache<string | null>(key, { userId, maxAgeMs: LOGO_REFRESH_MS })?.data;
        if (recent) {
          if (active) setLogo(recent);
          return;
        }

        const base64 = await cachedFetch<string | null>(
          key,
          async () => {
            const res = await LeadService.getSecureUrls([
              { bucketName: source.bucketName, filePath: source.filePath },
            ]);
            const secureUrl =
              res?.data?.data?.[0]?.secureUrl || res?.data?.[0]?.secureUrl || null;
            return secureUrl ? await urlToBase64(secureUrl) : null;
          },
          { online: isOnline(), userId }
        );
        if (active) setLogo(base64);
      } catch (error) {
        console.warn('[useCompanyLogoBase64] Error getting company logo base64:', error);
        if (active) setLogo(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [source?.bucketName, source?.filePath, hasLogo, enabled, userId]);

  return { logo, loading, hasLogo };
}

async function urlToBase64(url: string): Promise<string | null> {
  try {
    const res = await ReactNativeBlobUtil.config({ fileCache: true }).fetch('GET', url, {
      'Accept-Encoding': 'identity',
    });
    const path = res.path();
    const data = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
    return `data:image/png;base64,${data}`;
  } catch (error) {
    console.warn('[useCompanyLogoBase64] url -> base64 failed:', error);
    return null;
  }
}
