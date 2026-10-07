import {
  API_URL,
  GOOGLE_MAPS_API_KEY,
  APIFY_API_TOKEN,
  WEATHER_API_KEY,
  MAPBOX_ACCESS_TOKEN,
  LMS_REDIRECT_URL,
  S3_BUCKET,
  S3_BASE_URL,
} from '@env';

const required = (name: string, value: string | undefined): string => {
  if (!value && typeof jest === 'undefined') {
    throw new Error(`Missing ${name}. Copy .env.example to .env, fill it in and restart Metro with --reset-cache.`);
  }
  return value ?? '';
};

const apiUrl = required('API_URL', API_URL);
const s3Bucket = required('S3_BUCKET', S3_BUCKET);

export const ENV = {
  API_URL: apiUrl,
  GOOGLE_MAPS_API_KEY: required('GOOGLE_MAPS_API_KEY', GOOGLE_MAPS_API_KEY),
  APIFY_API_TOKEN: required('APIFY_API_TOKEN', APIFY_API_TOKEN),
  WEATHER_API_KEY: required('WEATHER_API_KEY', WEATHER_API_KEY),
  MAPBOX_ACCESS_TOKEN: required('MAPBOX_ACCESS_TOKEN', MAPBOX_ACCESS_TOKEN),
  LMS_REDIRECT_URL: required('LMS_REDIRECT_URL', LMS_REDIRECT_URL),
  S3_BUCKET: s3Bucket,
  S3_BASE_URL: S3_BASE_URL || `https://${s3Bucket}.s3.amazonaws.com/`,
} as const;
