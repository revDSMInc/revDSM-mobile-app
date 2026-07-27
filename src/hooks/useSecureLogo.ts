import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { LeadService } from '../services/api/leads';
import { ENV } from '../config/env';

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
        const res: any = await LeadService.getSecureUrls([
          { bucketName: bucketName || ENV.S3_BUCKET, filePath },
        ]);
        const url =
          res?.data?.data?.[0]?.secureUrl || res?.data?.[0]?.secureUrl || null;
        if (active) setSecureLogo(url);
      } catch (error) {
        console.warn('[useSecureLogo] resolve failed:', error);
        if (active) setSecureLogo(null);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, bucketName]);

  return secureLogo;
}
