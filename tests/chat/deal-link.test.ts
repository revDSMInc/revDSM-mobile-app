import {
  canOpenDeal,
  isInstallingToday,
  isPendingInstall,
  isPendingRehash,
} from '../../src/screens/ChatThreads/utils/deal-link';

// The three Messages buckets that may jump into My Deals (REVUIUX-552).

describe('isPendingRehash', () => {
  it('is true for a lead sent back to the rep and not resulted', () => {
    expect(isPendingRehash({ isRehashed: true, status: 'selfGenerated' })).toBe(true);
    expect(isPendingRehash({ isRehashed: true, status: 'lfLead' })).toBe(true);
  });

  it('is false once the rep results it as a sale', () => {
    expect(isPendingRehash({ isRehashed: true, status: 'sale' })).toBe(false);
  });

  // The 'rehash' status is the rep's own result and belongs to "No Sales";
  // it is the inverse of the isRehashed flag the Rehash Center sets.
  it("treats the 'rehash' status as resulted, not as pending rehash", () => {
    expect(isPendingRehash({ isRehashed: true, status: 'rehash' })).toBe(false);
  });

  it('is false for a lead never sent back for rehash', () => {
    expect(isPendingRehash({ status: 'selfGenerated' })).toBe(false);
    expect(isPendingRehash({ isRehashed: false, status: 'selfGenerated' })).toBe(false);
    expect(isPendingRehash(null)).toBe(false);
    expect(isPendingRehash(undefined)).toBe(false);
  });
});

describe('isPendingInstall', () => {
  it('is true for a sold job whose install day is still ahead', () => {
    expect(isPendingInstall({ installBucket: 'Pending Install' })).toBe(true);
  });

  it('is false for a sold job already installed or installing today', () => {
    expect(isPendingInstall({ installBucket: 'Already Installed' })).toBe(false);
    expect(isPendingInstall({ installBucket: 'Installing Today' })).toBe(false);
  });

  it('is false when there is no install bucket', () => {
    expect(isPendingInstall({ status: 'sale' })).toBe(false);
    expect(isPendingInstall(null)).toBe(false);
  });
});

describe('isInstallingToday', () => {
  it("is true when the install day is today", () => {
    expect(isInstallingToday({ installBucket: 'Installing Today' })).toBe(true);
  });

  it('is false for another bucket, or no bucket at all', () => {
    expect(isInstallingToday({ installBucket: 'Pending Install' })).toBe(false);
    expect(isInstallingToday({ installBucket: 'Already Installed' })).toBe(false);
    expect(isInstallingToday({ status: 'sale' })).toBe(false);
    expect(isInstallingToday(null)).toBe(false);
  });
});

describe('canOpenDeal', () => {
  it('opens for each of the three buckets the ticket names', () => {
    expect(canOpenDeal({ isRehashed: true, status: 'selfGenerated' })).toBe(true);
    expect(canOpenDeal({ installBucket: 'Pending Install' })).toBe(true);
    expect(canOpenDeal({ installBucket: 'Installing Today' })).toBe(true);
  });

  it('does not open for an already installed job - no deal left to work', () => {
    expect(canOpenDeal({ installBucket: 'Already Installed' })).toBe(false);
  });

  it('does not open for a row with no install bucket', () => {
    expect(canOpenDeal({ status: 'sale' })).toBe(false);
    expect(canOpenDeal({ status: 'selfGenerated' })).toBe(false);
    expect(canOpenDeal({ status: 'notHit' })).toBe(false);
    expect(canOpenDeal(null)).toBe(false);
  });
});
