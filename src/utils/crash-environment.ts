/**
 * Which backend a crash report came from, so Crashlytics can be filtered by custom key `environment`
 * (production vs non-production) and `api_host` (the exact backend). Derived from the build's API_URL, so a new .env
 * needs no code change. Pure - no React Native imports - so it is unit-testable.
 */
export type CrashEnvironment = 'production' | 'non-production';

// A host containing one of these labels is a non-production backend (demo-api.revdsm.com, api-dev..., staging-api...).
const NON_PROD_LABEL = /(^|[.\-_])(demo|dev|develop|development|stg|stage|staging|qa|uat|test|testing|sandbox|preprod|np|nonprod|local|localhost)([.\-_]|$)/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export const hostOf = (apiUrl: string | undefined | null): string => {
  const m = String(apiUrl ?? '').trim().match(/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i);
  return (m ? m[1] : '').toLowerCase();
};

export const resolveCrashEnvironment = (apiUrl: string | undefined | null): { environment: CrashEnvironment; host: string } => {
  const host = hostOf(apiUrl);
  const nonProd = !host || IPV4.test(host) || NON_PROD_LABEL.test(host);
  return { environment: nonProd ? 'non-production' : 'production', host: host || 'unknown' };
};
