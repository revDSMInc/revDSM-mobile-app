import {
  sectionImageUri,
  needsSecureUrl,
  isDisplayable,
  type SectionPhotoLike,
} from '../../src/utils/section-image-uri';

/**
 * Client, four rounds running: *"Manage Photos (3)"* on the Lead Center, the modal opening at
 * **(0)**, and *"There are no photos to download."* - after going online while staying on the
 * screen. A pull-to-reload always fixed it.
 */
describe('sectionImageUri', () => {
  const dev: SectionPhotoLike = { uri: 'file:///tmp/a.jpg' };
  const srv: SectionPhotoLike = { s3url: 'photos/a.jpg' };

  it('keeps the local uri when there is no s3url to resolve', () => {
    // resolveS3Url(undefined) returns '' — THE regression.
    expect(sectionImageUri(undefined, '', dev)).toBe('file:///tmp/a.jpg');
  });

  it('never yields an empty uri for a photo that has a local file', () => {
    expect(sectionImageUri(null, null, dev)).not.toBe('');
  });

  it('prefers the secure url above everything', () => {
    expect(sectionImageUri('https://secure/a.jpg', 'https://s3/a.jpg', dev)).toBe(
      'https://secure/a.jpg'
    );
  });

  it('prefers the resolved S3 url over a stale local copy', () => {
    expect(sectionImageUri(undefined, 'https://s3/a.jpg', dev)).toBe('https://s3/a.jpg');
  });

  it('is empty only when the photo truly has no source', () => {
    expect(sectionImageUri(undefined, '', {})).toBe('');
    expect(sectionImageUri(undefined, '', null)).toBe('');
  });

  it('tolerates a server photo with no local uri', () => {
    expect(sectionImageUri(undefined, 'https://s3/a.jpg', srv)).toBe('https://s3/a.jpg');
  });
});

describe('needsSecureUrl', () => {
  it('skips a device-only photo — there is no filePath to ask about', () => {
    expect(needsSecureUrl({ uri: 'file:///tmp/a.jpg' }, new Set())).toBe(false);
  });

  it('asks for a photo on S3 we do not already hold', () => {
    expect(needsSecureUrl({ s3url: 'photos/a.jpg' }, new Set())).toBe(true);
  });

  it('skips one we already resolved', () => {
    expect(needsSecureUrl({ s3url: 'photos/a.jpg' }, new Set(['photos/a.jpg']))).toBe(false);
  });

  it('skips an empty record', () => {
    expect(needsSecureUrl(null, new Set())).toBe(false);
    expect(needsSecureUrl({}, new Set())).toBe(false);
  });
});

describe('isDisplayable', () => {
  it('accepts a device-only photo', () => {
    expect(isDisplayable({ uri: 'file:///tmp/a.jpg' })).toBe(true);
  });

  it('accepts a server photo', () => {
    expect(isDisplayable({ s3url: 'photos/a.jpg' })).toBe(true);
  });

  /** The exact shape the old code produced, and the reason the download alert fired. */
  it('rejects the blanked-out record the regression created', () => {
    expect(isDisplayable({ uri: '', s3url: undefined })).toBe(false);
  });
});
