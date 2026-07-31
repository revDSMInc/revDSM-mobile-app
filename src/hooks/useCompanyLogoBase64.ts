import { useEffect, useState } from 'react';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useAuth } from './useAuth';
import { LeadService } from '../services/api/leads';

// ----------------------------------------------------------------------

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
 */
export function useCompanyLogoBase64() {
  const { user } = useAuth();
  const source: any = user?.companyLogo || user?.profilePicture || null;
  const hasLogo = Boolean(source?.bucketName && source?.filePath);

  const [logo, setLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(hasLogo);

  useEffect(() => {
    let active = true;

    if (!hasLogo) {
      setLogo(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    (async () => {
      try {
        const res = await LeadService.getSecureUrls([
          { bucketName: source.bucketName, filePath: source.filePath },
        ]);
        const secureUrl =
          res?.data?.data?.[0]?.secureUrl || res?.data?.[0]?.secureUrl || null;
        const base64 = secureUrl ? await urlToBase64(secureUrl) : null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.bucketName, source?.filePath, hasLogo]);

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
