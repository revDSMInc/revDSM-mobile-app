import { countSyncWork, syncBannerFor } from '../../src/utils/sync-banner';

// The home screen gets ONE line about syncing, and never an error.

describe('countSyncWork', () => {
  it('counts draft and uploading as pending', () => {
    expect(countSyncWork([{ status: 'draft' }, { status: 'uploading' }])).toEqual({
      pending: 2,
      blocked: 0,
    });
  });

  it('counts failed and needs-review as blocked, not pending', () => {
    expect(countSyncWork([{ status: 'failed' }, { status: 'needs-review' }])).toEqual({
      pending: 0,
      blocked: 2,
    });
  });

  it('survives an empty or missing queue', () => {
    expect(countSyncWork([])).toEqual({ pending: 0, blocked: 0 });
    expect(countSyncWork(null)).toEqual({ pending: 0, blocked: 0 });
  });
});

describe('syncBannerFor', () => {
  it('says it is syncing while work is in flight', () => {
    expect(syncBannerFor({ pending: 2, blocked: 0 }, false, true).tone).toBe('syncing');
  });

  it('says done once the queue empties, but only if we saw it working', () => {
    expect(syncBannerFor({ pending: 0, blocked: 0 }, true, true).tone).toBe('done');
    expect(syncBannerFor({ pending: 0, blocked: 0 }, true, true).title).toBe('Syncing done');
  });

  // A cold start with an empty queue is the normal state, not a finished sync.
  it('stays silent on a cold start with nothing queued', () => {
    expect(syncBannerFor({ pending: 0, blocked: 0 }, false, true).tone).toBe('none');
  });

  // The connection strip is already saying the useful thing; two strips is noise.
  it('stays silent while offline, even with work queued', () => {
    expect(syncBannerFor({ pending: 3, blocked: 0 }, false, false).tone).toBe('none');
  });

  /**
   * The product decision this strip exists to enforce: a rep on a driveway cannot act on a
   * sync error, and a red card on the lead list reads as "the app is broken".
   */
  it('shows NOTHING for blocked work - errors belong in Profile', () => {
    expect(syncBannerFor({ pending: 0, blocked: 2 }, false, true).tone).toBe('none');
    expect(syncBannerFor({ pending: 0, blocked: 5 }, false, true).title).toBe('');
  });

  it('keeps reporting syncing when some work is blocked but some is still going', () => {
    expect(syncBannerFor({ pending: 1, blocked: 1 }, false, true).tone).toBe('syncing');
  });
});
