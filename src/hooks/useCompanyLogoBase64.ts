import { useEffect, useState } from 'react';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useAuth } from './useAuth';
import { LeadService } from '../services/api/leads';
import { OFFLINE_CACHE, cachedFetch, readOfflineCache } from '../utils/offline-query-cache';
import { isOnline } from '../services/connectivity';

// ----------------------------------------------------------------------

/**
 * How long a stored logo is treated as current while ONLINE. Past it the logo is re-downloaded
 * and the copy refreshed; offline, age is never a reason to drop it.
 */
const LOGO_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * RN port of web `src/hooks/use-secure-logo.js` (useCompanyLogoBase64).
 *
 * Returns the company logo as a base64 data-URI (+ loading state). The company
 * logo lives on the auth user as `{ bucketName, filePath }` (companyLogo, or
 * profilePicture as fallback). We resolve it to a presigned S3 URL and then
 * download+encode it as base64 so the rasterized agreement (captureRef) reliably
 * embeds the logo — a bare remote <Image> may not be fully loaded at capture time
 * and would come back blank (the RN analog of web's html2canvas CORS tainting).
 *
 * `loading` lets callers show a spinner instead of flashing the "no logo"
 * fallback while the fetch is in flight.
 *
 * `enabled` exists so a screen can WARM the logo while there is still signal. The generator that
 * renders it only ever mounts offline (online the dialog uses the server preview), so without a
 * warm this cache could never be written on any device and every offline agreement went out
 * unbranded. See the call in `VerticalSummaryTab`.
 */
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
      // Keyed by the logo's own path, so a company that changes its logo does not keep showing
      // the old one on offline agreements.
      const key = `${OFFLINE_CACHE.COMPANY_LOGO}:${source.filePath}`;
      try {
        // A RECENT copy is served without touching the network, which is what makes warming this
        // on every Summary tab affordable.
        //
        // Bounded rather than trusted forever, because the path is `profile/{companyId}.jpeg` and
        // does NOT change when the logo is replaced — so the key alone cannot tell a new logo from
        // the old one. Offline the read below has no ceiling: any logo beats no logo.
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

// Download a remote (presigned) URL and encode it as a base64 data-URI. Mirrors
// the getBase64FromUri pattern used in ImageAnnotation (react-native-blob-util).
async function urlToBase64(url: string): Promise<string | null> {
  try {
    const res = await ReactNativeBlobUtil.config({ fileCache: true }).fetch('GET', url, {
      'Accept-Encoding': 'identity',
    });
    const path = res.path();
    const data = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
    // Data-URI mime doesn't have to match the file exactly for <Image>; png is safe
    // for logos (usually transparent). captureRef embeds it regardless of the label.
    return `data:image/png;base64,${data}`;
  } catch (error) {
    console.warn('[useCompanyLogoBase64] url -> base64 failed:', error);
    return null;
  }
}
