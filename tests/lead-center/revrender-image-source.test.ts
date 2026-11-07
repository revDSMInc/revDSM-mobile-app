import {
  blockedRenderItems,
  extractS3Key,
  isLocalImagePath,
  renderImageBlockReason,
} from '../../src/utils/revrender-image-source';

// The exact value the backend logged on all 60 failures.
const REPORTED =
  'file:///var/mobile/Containers/Data/Application/4AA7B84D-308D-401D-B8ED-11D56303FA4E/Documents/pending_uploads/1793293776377_3E905DC8-F67A-4208-9E97-B79A14608A9A.jpg';

describe('extractS3Key', () => {
  it('REFUSES the path from the incident, instead of passing it through', () => {
    expect(extractS3Key(REPORTED)).toBeNull();
  });

  it('refuses every device-local form', () => {
    [
      'file:///var/mobile/x.jpg',
      'content://media/external/images/1',
      'ph://ABC-123',
      'assets-library://asset/asset.JPG',
      '/var/mobile/Containers/Data/Application/x/Documents/photo.jpg',
      '/data/user/0/com.revdsm/files/upload_queue/a.jpg',
      'data:image/jpeg;base64,/9j/4AAQ',
    ].forEach((v) => expect(extractS3Key(v)).toBeNull());
  });

  it('refuses anything still sitting in the upload queue, whatever the shape', () => {
    expect(extractS3Key('pending_uploads/1793293776377_abc.jpg')).toBeNull();
    expect(extractS3Key('Documents/upload_queue/x.jpg')).toBeNull();
  });

  it('refuses empty input rather than returning an empty key', () => {
    expect(extractS3Key('')).toBeNull();
    expect(extractS3Key(null)).toBeNull();
    expect(extractS3Key(undefined)).toBeNull();
    expect(extractS3Key('   ')).toBeNull();
  });

  it('takes the key out of a full https url', () => {
    expect(extractS3Key('https://bucket.s3.amazonaws.com/company/123/front.jpg')).toBe(
      'company/123/front.jpg'
    );
  });

  it('drops a presigned query string - the signature is not part of the key', () => {
    expect(
      extractS3Key('https://bucket.s3.amazonaws.com/company/123/front.jpg?X-Amz-Signature=abc')
    ).toBe('company/123/front.jpg');
  });

  it('passes a bare S3 key through unchanged', () => {
    expect(extractS3Key('company/123/front.jpg')).toBe('company/123/front.jpg');
  });
});

describe('isLocalImagePath', () => {
  it('is true for device paths and false for server ones', () => {
    expect(isLocalImagePath(REPORTED)).toBe(true);
    expect(isLocalImagePath('/var/mobile/x.jpg')).toBe(true);
    expect(isLocalImagePath('https://bucket.s3.amazonaws.com/a/b.jpg')).toBe(false);
    expect(isLocalImagePath('company/123/front.jpg')).toBe(false);
    expect(isLocalImagePath('')).toBe(false);
  });
});

describe('renderImageBlockReason', () => {
  it('blocks the incident photo as still uploading', () => {
    // What uploadQueue stores before the upload drains: empty s3url, local uri.
    expect(renderImageBlockReason({ s3url: '', uri: REPORTED })).toBe('uploading');
  });

  it('allows a photo that finished uploading', () => {
    expect(
      renderImageBlockReason({
        s3url: 'https://bucket.s3.amazonaws.com/company/123/front.jpg',
        uri: REPORTED,
      })
    ).toBeNull();
  });

  it('allows a bare key in s3url', () => {
    expect(renderImageBlockReason({ s3url: 'company/123/front.jpg' })).toBeNull();
  });

  it('reports a photo with no source at all as missing, not uploading', () => {
    // "uploading" promises it will resolve on its own; this one never will.
    expect(renderImageBlockReason({})).toBe('missing');
    expect(renderImageBlockReason(null)).toBe('missing');
  });

  it('accepts a usable remote uri even when s3url is empty', () => {
    expect(
      renderImageBlockReason({ s3url: '', uri: 'https://bucket.s3.amazonaws.com/a/b.jpg' })
    ).toBeNull();
  });
});

describe('blockedRenderItems', () => {
  const ok = { photo: { s3url: 'company/1/a.jpg' }, viewLabel: 'Front' };
  const pending = { photo: { s3url: '', uri: REPORTED }, viewLabel: 'Front' };

  it('is empty when every render can be sent', () => {
    expect(blockedRenderItems([ok, ok])).toEqual([]);
  });

  it('names each blocked entry and its reason', () => {
    const blocked = blockedRenderItems([ok, pending, pending]);
    expect(blocked).toHaveLength(2);
    expect(blocked[0].reason).toBe('uploading');
    expect(blocked[0].item).toBe(pending);
  });

  /**
   * The incident: 4 looks queued against ONE pending photo, submitted 15 times. Not one of
   * those 60 requests should ever have left the device.
   */
  it('blocks the whole burst from the incident', () => {
    const burst = [pending, pending, pending, pending];
    expect(blockedRenderItems(burst)).toHaveLength(4);
  });
});
