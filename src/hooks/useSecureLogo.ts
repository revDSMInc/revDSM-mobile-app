import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';
import { isOnline } from '../services/connectivity';
import { OFFLINE_CACHE, cachedFetch } from '../utils/offline-query-cache';
import { warmToLocalCache } from '../utils/imageFileCache';

// ----------------------------------------------------------------------

/**
 * RN port of web `src/hooks/use-secure-logo.js` (`useSecureLogo`).
 *
 * Resolves the tenant's company logo to a PRESIGNED S3 URL for lightweight UI
 * display (the header brand avatar, etc.) — the multi-tenant "dynamic branding"
 * source. Distinct from {@link useCompanyLogoBase64}, which returns base64 for
 * rasterized documents (agreement capture); here a plain presigned URL is enough
 * for an `<Image source={{ uri }}>`.
 *
 * Source mirrors web exactly: the auth user's `companyLogo`, falling back to
 * `profilePicture`, each shaped `{ bucketName, filePath }`. As an RN data
 * tolerance (mobile stores some pictures as plain string URLs) a string source is
 * passed through / resolved directly, and a missing bucket falls back to the
 * configured S3 bucket — matching the previous inline MainHeader resolver so no
 * existing avatar regresses.
 */
export function useSecureLogo(): string | null {
  const { user } = useAuth();
  const source: any = user?.companyLogo || user?.profilePicture || null;
  const userId = user?._id || user?.id;

  const [secureLogo, setSecureLogo] = useState<string | null>(null);

  const filePath = typeof source === 'string' ? source : source?.filePath || '';
  const bucketName = typeof source === 'object' ? source?.bucketName : undefined;

  useEffect(() => {
    let active = true;

    if (!source) {
      setSecureLogo(null);
      return undefined;
    }

    // Already a full URL — use it directly (web only ever stores S3 refs, but
    // mobile occasionally carries a plain http(s) URL).
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
        // Kept per logo PATH so a company that changes its logo is not stuck showing the old
        // one, and so the presign round trip is skipped entirely when there is no connection.
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

        // ⚠️ A recalled url is EXPIRED and cannot be fetched — but it still names the same
        // cached file, so the logo renders offline from disk. Resolving the local copy here
        // rather than at each call site is what covers the header avatar as well as the
        // Investment Center's brand mark: both consumers just render what this returns.
        const local = await warmToLocalCache(url).catch(() => null);
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
