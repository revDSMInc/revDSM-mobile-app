import {
  mergeSalesPhotos,
  salesPhotoKey,
  type SalesPhotoLike,
} from '../../src/utils/sales-photos-merge';

const server = (s3url: string) => ({ s3url, category: 'Front' });
const local = (uri: string) => ({ uri, category: 'Front', isPending: true });

describe('salesPhotoKey', () => {
  it('prefers s3url, then uri, then _id', () => {
    expect(salesPhotoKey({ s3url: 'a', uri: 'b', _id: 'c' })).toBe('a');
    expect(salesPhotoKey({ uri: 'b', _id: 'c' })).toBe('b');
    expect(salesPhotoKey({ _id: 'c' })).toBe('c');
  });

  it('is empty for a photo with no identity at all', () => {
    expect(salesPhotoKey({})).toBe('');
    expect(salesPhotoKey(null)).toBe('');
  });
});

/**
 * Client: *"I uploaded 3 images in offline and become online by remaining on same screen... it
 * become 0 when I turn on the internet"*.
 *
 * On reconnect the queue DRAINS (so the pending count goes to 0) and the lead read that follows
 * can legitimately not list the new photos yet. `{...prev, ...full}` then overwrote 3 with 0.
 */
describe('mergeSalesPhotos — a shorter server list never deletes what we hold', () => {
  it('⚠️ THE REPORTED CASE: keeps 3 photos when the server read comes back empty', () => {
    const held = [server('a.jpg'), server('b.jpg'), server('c.jpg')];
    expect(mergeSalesPhotos(held, [])).toHaveLength(3);
  });

  it('keeps the ones the server has not caught up with yet', () => {
    const held = [server('a.jpg'), server('b.jpg'), server('c.jpg')];
    const incoming = [server('a.jpg')];
    const out = mergeSalesPhotos(held, incoming);
    expect(out.map((p) => p.s3url)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  /** ⚠️ An ABSENT field means "the server said nothing", not "the server said none". */
  it('keeps everything when the response omits salesPhotos entirely', () => {
    const held = [server('a.jpg')];
    expect(mergeSalesPhotos(held, undefined)).toHaveLength(1);
    expect(mergeSalesPhotos(held, null)).toHaveLength(1);
  });

  it('takes the server row when both have it, so server fields win', () => {
    const held = [{ s3url: 'a.jpg', secureUrl: undefined, stale: true }];
    const incoming = [{ s3url: 'a.jpg', secureUrl: 'https://signed', stale: false }];
    const out = mergeSalesPhotos(held as any, incoming as any);
    expect(out).toHaveLength(1);
    expect((out[0] as any).secureUrl).toBe('https://signed');
  });

  it('adds photos taken on another device', () => {
    const out = mergeSalesPhotos([server('a.jpg')], [server('a.jpg'), server('z.jpg')]);
    expect(out).toHaveLength(2);
  });

  /** A device-only photo (local uri, no s3url) is held until the server lists it. */
  it('keeps an optimistic local photo the server has never seen', () => {
    const out = mergeSalesPhotos([local('file:///new.jpg')], []);
    expect(out).toHaveLength(1);
    expect((out[0] as any).uri).toBe('file:///new.jpg');
  });

  it('collapses the two once the server finally lists the upload', () => {
    // The device row and the server row share an s3url after the upload confirms.
    const held = [{ s3url: 'a.jpg', uri: 'file:///a.jpg' }];
    const out = mergeSalesPhotos(held, [{ s3url: 'a.jpg', secureUrl: 'x' }] as any);
    expect(out).toHaveLength(1);
  });

  /** ⚠️ Identity: no retention means hand back the incoming array untouched. */
  it('returns the incoming array itself when nothing needed retaining', () => {
    const incoming = [server('a.jpg')];
    expect(mergeSalesPhotos([server('a.jpg')], incoming)).toBe(incoming);
    expect(mergeSalesPhotos([], incoming)).toBe(incoming);
    expect(mergeSalesPhotos(null, incoming)).toBe(incoming);
  });

  it('drops null and undefined rows from either side', () => {
    const out = mergeSalesPhotos(
      [server('a.jpg'), null as any, undefined as any],
      [null as any, server('b.jpg')]
    );
    expect(out).toHaveLength(2);
  });

  /** A row with no identity cannot be matched, so it is not retained - it would duplicate. */
  it('does not retain an unidentifiable row', () => {
    const out = mergeSalesPhotos([{ category: 'Front' } as any], []);
    expect(out).toHaveLength(0);
  });

  it('never mutates either input', () => {
    const held = [server('a.jpg')];
    const incoming = [server('b.jpg')];
    mergeSalesPhotos(held, incoming);
    expect(held).toHaveLength(1);
    expect(incoming).toHaveLength(1);
  });

  it('is stable when applied repeatedly to its own output', () => {
    const held = [server('a.jpg'), server('b.jpg')];
    const once = mergeSalesPhotos(held, [server('a.jpg')]);
    const twice = mergeSalesPhotos(once, [server('a.jpg')]);
    expect(twice).toHaveLength(2);
  });

  /**
   * ⚠️ THE GUARD THAT KEEPS DELETION WORKING. A deleted photo is filtered downstream by
   * `deletedUrls` (`offlinePhotoDeleteQueue`), NOT by its absence from the server list - so
   * retention here cannot resurrect it. This pins the contract that makes that safe: the merge
   * is purely additive and knows nothing about deletion.
   */
  it('is additive only — deletion is somebody else’s job', () => {
    const held = [server('a.jpg'), server('deleted.jpg')];
    const out = mergeSalesPhotos(held, [server('a.jpg')]);
    // Still present HERE; the deletedUrls filter is what removes it on screen.
    expect(out.map((p) => p.s3url)).toContain('deleted.jpg');
  });
});

/**
 * The SECOND half of the same report, and the one three earlier attempts missed.
 *
 * Client: *"Manage Photos (3) ... opens at (0)"*, *"there are no photos to download"*, and the
 * round before: *"I uploaded 4 images ... I saw 5 images"*.
 *
 * A device copy is keyed by its local `uri`; its own uploaded row comes back keyed by `s3url`.
 * The keys never collide, so the stale local record used to be retained BESIDE its twin. After
 * `uploadQueue` unlinks the scratch file, that record counts but renders nothing.
 */
describe('mergeSalesPhotos — a device copy retires when its own upload lands', () => {
  const dev = (uri: string, sub: string): SalesPhotoLike => ({
    uri,
    category: 'Front',
    subcategory: sub,
    isPending: true,
  });
  const srv = (s3url: string, sub: string): SalesPhotoLike => ({
    s3url,
    category: 'Front',
    subcategory: sub,
  });

  it('drops the local copy once the server reports that slot', () => {
    const held = [dev('file:///tmp/a.jpg', 'Back')];
    const out = mergeSalesPhotos(held, [srv('https://s3/a.jpg', 'Back')]);
    expect(out).toHaveLength(1);
    expect(out[0].s3url).toBe('https://s3/a.jpg');
  });

  it('4 offline photos that all upload stay 4, never 5', () => {
    const subs = ['Back', 'Front-Left', 'Front-Right', 'Left'];
    const held = subs.map((sb, i) => dev(`file:///tmp/${i}.jpg`, sb));
    const incoming = subs.map((sb, i) => srv(`https://s3/${i}.jpg`, sb));
    const out = mergeSalesPhotos(held, incoming);
    expect(out).toHaveLength(4);
    expect(out.every((p) => !!p.s3url)).toBe(true);
  });

  it('keeps a local copy the server has NOT caught up with yet', () => {
    // Two shot into one slot, only one came back: the second must survive.
    const held = [dev('file:///tmp/a.jpg', 'Back'), dev('file:///tmp/b.jpg', 'Back')];
    const out = mergeSalesPhotos(held, [srv('https://s3/a.jpg', 'Back')]);
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.uri === 'file:///tmp/b.jpg')).toBe(true);
  });

  it('keeps every local copy while the server still lists none', () => {
    const held = [dev('file:///tmp/a.jpg', 'Back'), dev('file:///tmp/b.jpg', 'Left')];
    const out = mergeSalesPhotos(held, []);
    expect(out).toHaveLength(2);
  });

  it('does not let one slot retire another slot\u2019s photo', () => {
    const held = [dev('file:///tmp/a.jpg', 'Back')];
    // Server reports a DIFFERENT slot: the Back copy is still the only evidence it exists.
    const out = mergeSalesPhotos(held, [srv('https://s3/z.jpg', 'Left')]);
    expect(out).toHaveLength(2);
    expect(out.some((p) => p.uri === 'file:///tmp/a.jpg')).toBe(true);
  });

  it('still keeps a held row that HAS an s3url the server omitted', () => {
    // Read-after-write on an already-uploaded photo: unchanged behaviour.
    const held = [srv('https://s3/a.jpg', 'Back')];
    const out = mergeSalesPhotos(held, [srv('https://s3/b.jpg', 'Left')]);
    expect(out).toHaveLength(2);
  });

  it('is stable when applied repeatedly to its own output', () => {
    const held = [dev('file:///tmp/a.jpg', 'Back')];
    const once = mergeSalesPhotos(held, [srv('https://s3/a.jpg', 'Back')]);
    const twice = mergeSalesPhotos(once, [srv('https://s3/a.jpg', 'Back')]);
    expect(twice).toHaveLength(1);
  });
});
