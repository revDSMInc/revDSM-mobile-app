jest.mock('../../src/config/env', () => ({
  ENV: { S3_BASE_URL: 'https://my-bucket.s3.amazonaws.com/' },
}));

import { resolveS3Url } from '../../src/utils/s3-utils';

describe('resolveS3Url', () => {
  test('returns empty string for empty path', () => {
    expect(resolveS3Url('')).toBe('');
    expect(resolveS3Url(undefined as any)).toBe('');
  });

  test('returns path as-is if it already starts with http', () => {
    expect(resolveS3Url('https://cdn.example.com/image.jpg')).toBe('https://cdn.example.com/image.jpg');
  });

  test('prepends S3_BASE_URL for relative paths', () => {
    expect(resolveS3Url('images/photo.jpg')).toBe('https://my-bucket.s3.amazonaws.com/images/photo.jpg');
  });

  test('removes leading slash from relative path', () => {
    expect(resolveS3Url('/images/photo.jpg')).toBe('https://my-bucket.s3.amazonaws.com/images/photo.jpg');
  });

  test('handles nested paths', () => {
    const result = resolveS3Url('uploads/user/123/profile.png');
    expect(result).toBe('https://my-bucket.s3.amazonaws.com/uploads/user/123/profile.png');
  });
});
