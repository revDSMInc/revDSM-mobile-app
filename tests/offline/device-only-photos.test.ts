import {
  isDeviceOnlyPhoto,
  keepDeviceOnlyPhotos,
} from '../../src/utils/device-only-photos';

const local = (uri: string) => ({ uri });
const uploaded = (s3url: string) => ({ s3url, uri: `file://${s3url}` });

describe('isDeviceOnlyPhoto', () => {
  it('a photo with no s3url has never been to the server', () => {
    expect(isDeviceOnlyPhoto(local('file:///tmp/a.jpg'))).toBe(true);
  });

  it('a photo with an s3url is server-backed', () => {
    expect(isDeviceOnlyPhoto(uploaded('leads/1/front.jpg'))).toBe(false);
  });

  it('is safe on junk', () => {
    expect(isDeviceOnlyPhoto(null)).toBe(false);
    expect(isDeviceOnlyPhoto(undefined)).toBe(false);
  });
});

/**
 * The client's report: four photos taken offline, camera closed, every count fell to 0, and they
 * reappeared after navigating away and back.
 */
describe('keepDeviceOnlyPhotos — the offline wipe', () => {
  it('⚠️ KEEPS four photos shot offline when the server says the lead has none', () => {
    const optimistic = {
      Front: [local('file:///a.jpg'), local('file:///b.jpg')],
      Back: [local('file:///c.jpg'), local('file:///d.jpg')],
    };
    const kept = keepDeviceOnlyPhotos(optimistic);
    expect(kept.Front).toHaveLength(2);
    expect(kept.Back).toHaveLength(2);
  });

  /** A server read IS evidence about a server-backed photo - those still clear. */
  it('still drops photos the server has, which is what the clear was for', () => {
    const kept = keepDeviceOnlyPhotos({
      Front: [uploaded('leads/1/front.jpg')],
    });
    expect(kept.Front).toBeUndefined();
  });

  it('keeps only the local half of a mixed section', () => {
    const kept = keepDeviceOnlyPhotos({
      Front: [uploaded('leads/1/front.jpg'), local('file:///new.jpg')],
    });
    expect(kept.Front).toHaveLength(1);
    expect(kept.Front[0].uri).toBe('file:///new.jpg');
  });

  it('drops a section that becomes empty rather than leaving a stray key', () => {
    const kept = keepDeviceOnlyPhotos({
      Front: [uploaded('leads/1/front.jpg')],
      Back: [local('file:///b.jpg')],
    });
    expect(Object.keys(kept)).toEqual(['Back']);
  });

  /** ⚠️ Identity matters: a new object here re-renders every photo grid. */
  it('returns the SAME object when there was nothing to keep or clear', () => {
    const empty = {};
    expect(keepDeviceOnlyPhotos(empty)).toBe(empty);
  });

  it('clears to a plain empty object when only server photos were held', () => {
    expect(keepDeviceOnlyPhotos({ Front: [uploaded('x.jpg')] })).toEqual({});
  });

  it('is safe on null/undefined', () => {
    expect(keepDeviceOnlyPhotos(null)).toEqual({});
    expect(keepDeviceOnlyPhotos(undefined)).toEqual({});
  });

  /**
   * ⚠️ The regression guard. The old code was `setSectionImages({})` unconditionally; if anyone
   * reinstates that, this fails.
   */
  it('never returns empty while a device-only photo is held', () => {
    const kept = keepDeviceOnlyPhotos({ Front: [local('file:///only.jpg')] });
    expect(Object.keys(kept).length).toBeGreaterThan(0);
  });
});
