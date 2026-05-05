/**
 * S3 URL Resolver
 * Ensures relative paths are converted to full S3 URLs
 */
export const resolveS3Url = (path?: string): string => {
  if (!path) return '';
  if (path.startsWith('http')) return path;

  // Base URL for staging/dev bucket
  // Format: https://[bucket].s3.[region].amazonaws.com/[path]
  const baseUrl = 'https://np-revdsm-staging.s3.amazonaws.com/';

  // Ensure we don't double slash
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${baseUrl}${cleanPath}`;
};
