import { ENV } from '../config/env';

export const resolveS3Url = (path?: string): string => {
  if (!path) return '';
  if (path.startsWith('http')) return path;

  const baseUrl = ENV.S3_BASE_URL;

  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${baseUrl}${cleanPath}`;
};

