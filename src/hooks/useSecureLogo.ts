import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { warmToLocalCache } from '../utils/imageFileCache';

// Resolved logo per file path, kept for the session. Screens that remount their logo on a tab
// switch (Investment Center keys its panel by calculator) would otherwise start from null and
// flash the company-name fallback until the secure URL resolves again.
const resolvedLogos = new Map<string, string>();

export function useSecureLogo(): string | null {
  const { user } = useAuth();
  const source: any = user?.companyLogo || user?.profilePicture || null;
  const userId = user?._id || user?.id;

  const filePath = typeof source === 'string' ? source : source?.filePath || '';
  const [secureLogo, setSecureLogo] = useState<string | null>(
    () => (typeof source === 'string' && source.startsWith('http') ? source : resolvedLogos.get(filePath)) ?? null,
  );
  const bucketName = typeof source === 'object' ? source?.bucketName : undefined;

  useEffect(() => {
    let active = true;

    if (!source) {
      setSecureLogo(null);
      return undefined;
    }

    if (typeof source === 'string' && source.startsWith('http')) {
      setSecureLogo(source);
      return undefined;
    }

    if (!filePath) {
      setSecureLogo(null);
      return undefined;
    }

    (async () => {
      try {
        const url = await cachedFetch<string | null>(
          `${OFFLINE_CACHE.COMPANY_LOGO}:url:${filePath}`,
          async () => {
            const res: any = await LeadService.getSecureUrls([
              { bucketName: bucketName || ENV.S3_BUCKET, filePath },
            ]);
            return res?.data?.data?.[0]?.secureUrl || res?.data?.[0]?.secureUrl || null;
          },
          { online: isOnline(), userId }
        );
        if (!active) return;

        const local = await warmToLocalCache(url).catch(() => null);
        if (url) resolvedLogos.set(filePath, local || url);
        if (active) setSecureLogo(local || url);
      } catch (error) {
        console.warn('[useSecureLogo] resolve failed:', error);
        if (active) setSecureLogo(null);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, bucketName, userId]);

  return secureLogo;
}
