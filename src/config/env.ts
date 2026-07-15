// Centralised config — update API_URL to match your environment
const API_URL = 'https://api.np.revdsm.com/';

const getS3Bucket = (url: string): string => {
  if (url.includes('dev-api') || url.includes('api.np')) {
    return 'np-revdsm-staging';
  }
  // Production bucket name
  return 'mhalt-revdsm';
};

const getMapboxToken = (url: string): string => {
  if (url.includes('api.revdsm.com')) {
    // Production token
    return 'pk.eyJ1IjoicmV2ZHNtaW5jIiwiYSI6ImNtcmFrNmtxeDA2cDcyeHF3aGx5eWt6Mm4ifQ.N4J6zGby06pAoAEuQGIYRQ';
  }
  // Development/Staging token
  return 'pk.eyJ1IjoicmV2ZHNtaW5jIiwiYSI6ImNtcmFrNmVoZzA0MjYyeXNpMXBsa3Q0djMifQ.KZZG3r-btQQvb9MC3To7qA';
};

const S3_BUCKET = getS3Bucket(API_URL);
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com/`;

export const ENV = {
  API_URL,
  GOOGLE_MAPS_API_KEY: 'AIzaSyBT3b_a8aWTuI0l9wqjhiT7lSgV_36pkUg',
  APIFY_API_TOKEN: 'apify_api_D5hrRBM3VW3uamrDWgSu7KvkE83tY54wQrTM',
  WEATHER_API_KEY: 'e121ca1bd2b740f493472510252304',
  MAPBOX_ACCESS_TOKEN: getMapboxToken(API_URL),
  S3_BUCKET,
  S3_BASE_URL,
} as const;

