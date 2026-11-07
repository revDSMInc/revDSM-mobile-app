import {
  dedupeSlotPhotos,
  deviceOnlyAllowance,
  type SlotPhoto,
} from '../../src/utils/slot-photo-dedupe';

const onServer = (s3url: string): SlotPhoto => ({ s3url, secureUrl: 'https://signed/' + s3url });
const onDevice = (uri: string): SlotPhoto => ({ uri });

describe('deviceOnlyAllowance', () => {
  /** ⚠️ The slot holds max(server, device) photos, not their sum - an uploaded photo is in both. */
  it('is the gap between distinct device files and confirmed server rows', () => {
    expect(deviceOnlyAllowance(4, 0)).toBe(4);
    expect(deviceOnlyAllowance(4, 3)).toBe(1);
    expect(deviceOnlyAllowance(4, 4)).toBe(0);
  });

  /** ⚠️ The server may list MORE than this device knows (another device uploaded). */
  it('never goes negative', () => {
    expect(deviceOnlyAllowance(2, 5)).toBe(0);
  });

  it('is safe on junk', () => {
    expect(deviceOnlyAllowance(NaN as any, 1)).toBe(0);
    expect(deviceOnlyAllowance(3, NaN as any)).toBe(3);
  });
});

/**
 * Client: *"i uploaded 4 images in offline, become online, synced done, went in photos and guess
 * what i saw 5 images"* — with one slot showing the same shot three times.
 *
 * Cause: a device-only copy has no `s3url`, so an s3url-only dedupe never matched it and pushed it
 * on every pass, while `knownPhotosRef` kept it alive beside its own uploaded twin.
 */
describe('dedupeSlotPhotos', () => {
  it('⚠️ THE REPORTED CASE: an uploaded photo and its device copy collapse to one', () => {
    const out = dedupeSlotPhotos([onDevice('file:///a.jpg'), onServer('a.jpg')]);
    expect(out).toHaveLength(1);
    expect(out[0].s3url).toBe('a.jpg');
  });

  it('keeps a device copy while nothing is on the server yet', () => {
    const out = dedupeSlotPhotos([onDevice('file:///a.jpg')]);
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe('file:///a.jpg');
  });

  /** 4 offline photos, 3 landed: 3 server rows + 1 still waiting = 4, never 5. */
  it('shows exactly the gap during a partial sync', () => {
    const out = dedupeSlotPhotos([
      onDevice('file:///a.jpg'),
      onDevice('file:///b.jpg'),
      onDevice('file:///c.jpg'),
      onDevice('file:///d.jpg'),
      onServer('a.jpg'),
      onServer('b.jpg'),
      onServer('c.jpg'),
    ]);
    expect(out).toHaveLength(4);
    expect(out.filter((p) => p.s3url)).toHaveLength(3);
    expect(out.filter((p) => !p.s3url)).toHaveLength(1);
  });

  it('⚠️ never renders the same shot three times', () => {
    const out = dedupeSlotPhotos([
      onDevice('file:///back.jpg'),
      onDevice('file:///back.jpg'),
      onServer('back.jpg'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('dedupes repeated server rows by s3url', () => {
    expect(dedupeSlotPhotos([onServer('a.jpg'), onServer('a.jpg')])).toHaveLength(1);
  });

  it('dedupes repeated device rows by uri', () => {
    expect(dedupeSlotPhotos([onDevice('file:///a.jpg'), onDevice('file:///a.jpg')])).toHaveLength(1);
  });

  it('keeps two genuinely different device photos in one slot', () => {
    const out = dedupeSlotPhotos([onDevice('file:///a.jpg'), onDevice('file:///b.jpg')]);
    expect(out).toHaveLength(2);
  });

  /**
   * ⚠️ Server rows first, device copies after, so a tile does not jump when its upload lands.
   * Needs 2 device files against 1 server row, or the surplus is zero and nothing is retained -
   * one device file plus one server row is ONE photo, which is the whole point of the rule.
   */
  it('puts server rows before device copies', () => {
    const out = dedupeSlotPhotos([
      onDevice('file:///a.jpg'),
      onDevice('file:///new.jpg'),
      onServer('old.jpg'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].s3url).toBe('old.jpg');
    expect(out[1].s3url).toBeUndefined();
  });

  it('keeps every server row when the server has more than this device', () => {
    const out = dedupeSlotPhotos([onServer('a.jpg'), onServer('b.jpg'), onServer('c.jpg')]);
    expect(out).toHaveLength(3);
  });

  it('is safe on empty and junk input', () => {
    expect(dedupeSlotPhotos([])).toEqual([]);
    expect(dedupeSlotPhotos(null)).toEqual([]);
    expect(dedupeSlotPhotos(undefined)).toEqual([]);
    expect(dedupeSlotPhotos([null as any, undefined as any])).toEqual([]);
  });

  /** ⚠️ Never silently drop a photo that has no identity at all. */
  it('keeps an unidentifiable device record rather than losing it', () => {
    const out = dedupeSlotPhotos([{ } as any]);
    expect(out).toHaveLength(1);
  });

  it('is idempotent — re-running on its own output changes nothing', () => {
    const once = dedupeSlotPhotos([onDevice('file:///a.jpg'), onServer('a.jpg')]);
    expect(dedupeSlotPhotos(once)).toHaveLength(once.length);
  });
});
