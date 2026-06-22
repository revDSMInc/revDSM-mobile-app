// Centralised config — update API_URL to match your environment
const API_URL = 'https://dev-api.revdsm.com/';

const getS3Bucket = (url: string): string => {
  if (url.includes('dev-api') || url.includes('staging-api')) {
    return 'np-revdsm-staging';
  }
  // Production bucket name
  return 'mhalt-revdsm';
};

const S3_BUCKET = getS3Bucket(API_URL);
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com/`;

export const ENV = {
  API_URL,
  GOOGLE_MAPS_API_KEY: 'AIzaSyBT3b_a8aWTuI0l9wqjhiT7lSgV_36pkUg',
  APIFY_API_TOKEN: 'apify_api_D5hrRBM3VW3uamrDWgSu7KvkE83tY54wQrTM',
  WEATHER_API_KEY: 'e121ca1bd2b740f493472510252304',
  MAPBOX_ACCESS_TOKEN: 'pk.eyJ1IjoicmV2ZHNtaW5jIiwiYSI6ImNtcDFiNHM2eTAzOWkycnB6bzZibHdxMjIifQ.fk5Yn1dJLMZql8HQPZqxiA',
  S3_BUCKET,
  S3_BASE_URL,
} as const;

