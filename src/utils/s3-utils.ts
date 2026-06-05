import { ENV } from '../config/env';

/**
 * S3 URL Resolver
 * Ensures relative paths are converted to full S3 URLs
 */
export const resolveS3Url = (path?: string): string => {
  if (!path) return '';
  if (path.startsWith('http')) return path;

  // Base URL format: https://[bucket].s3.amazonaws.com/
  const baseUrl = ENV.S3_BASE_URL;

  // Ensure we don't double slash
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${baseUrl}${cleanPath}`;
};

