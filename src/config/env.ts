// Centralised config — update API_URL to match your environment.
// This must be the *API* host. `app.<env>.revdsm.com` is the web front-end: it is
// static nginx, so every request answers 405/HTML and login fails as "Incorrect
// email or password" (the axios rejection carries an HTML body with no `message`).
//
//   np / staging : https://api.np.revdsm.com/   (also reachable as dev-api.revdsm.com)
  // production   : https://api.revdsm.com/
// const API_URL = 'https://api.np.revdsm.com/';
// const API_URL = 'https://api.np.revdsm.com/';
// const API_URL = 'https://dev-api.revdsm.com/';

const API_URL = 'http://192.168.30.160:4009/'; // local dev server
// 
/** Only the bare production host is production; every other host is np/staging. */
const isProductionApi = (url: string): boolean =>
  /^https?:\/\/api\.revdsm\.com\/?$/i.test(url.trim());

// dev-api / api.np both resolve to the staging bucket; only bare api.revdsm.com is prod.
const getS3Bucket = (url: string): string =>
  isProductionApi(url) ? 'mhalt-revdsm' : 'np-revdsm-staging';

const getMapboxToken = (url: string): string =>
  isProductionApi(url)
    ? 'pk.eyJ1IjoicmV2ZHNtaW5jIiwiYSI6ImNtcmFrNmtxeDA2cDcyeHF3aGx5eWt6Mm4ifQ.N4J6zGby06pAoAEuQGIYRQ'
    : 'pk.eyJ1IjoicmV2ZHNtaW5jIiwiYSI6ImNtcmFrNmVoZzA0MjYyeXNpMXBsa3Q0djMifQ.KZZG3r-btQQvb9MC3To7qA';

/**
 * LMS portal base URL for the "My Learning" redirect (web parity: config-global's
 * `LMS_REDIRECT_URL` = `VITE_LMS_REDIRECT_URL`). The web account-popover treats
 * `lms.revdsm.com` (prod) / `lms.np.revdsm.com` (staging) as the LMS host.
 * TODO: make env build-driven (see env.ts gotcha) instead of deriving from API_URL.
 */
const getLmsRedirectUrl = (url: string): string => {
  if (url.includes('api.revdsm.com') && !url.includes('api.np')) {
    // Production LMS portal
    return 'https://lms.revdsm.com/';
  }
  // Development/Staging LMS portal
  return 'https://lms.np.revdsm.com/';
};

const S3_BUCKET = getS3Bucket(API_URL);
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com/`;

export const ENV = {
  API_URL,
  GOOGLE_MAPS_API_KEY: 'AIzaSyBT3b_a8aWTuI0l9wqjhiT7lSgV_36pkUg',
  APIFY_API_TOKEN: 'apify_api_D5hrRBM3VW3uamrDWgSu7KvkE83tY54wQrTM',
  WEATHER_API_KEY: 'e121ca1bd2b740f493472510252304',
  MAPBOX_ACCESS_TOKEN: getMapboxToken(API_URL),
  LMS_REDIRECT_URL: getLmsRedirectUrl(API_URL),
  S3_BUCKET,
  S3_BASE_URL,
} as const;

