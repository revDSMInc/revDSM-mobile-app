import {
  DOT_TOTAL_W,
  NAV_RESERVED_W,
  pagerModeFor,
} from '../../src/utils/render-pager';

// iPhone 13/14/15 logical width - the device the overflow was reported on.
const IPHONE = 390;
const IPHONE_SE = 320;
const IPAD_PORTRAIT = 820;

describe('pagerModeFor', () => {
  it('shows nothing for a single render', () => {
    expect(pagerModeFor(1, IPHONE)).toBe('none');
    expect(pagerModeFor(0, IPHONE)).toBe('none');
  });

  it('keeps the dots for the counts that genuinely fit', () => {
    expect(pagerModeFor(2, IPHONE)).toBe('dots');
    expect(pagerModeFor(5, IPHONE)).toBe('dots');
  });

  it('swaps to a counter before the row can overflow', () => {
    // The reported bug: 11 renders carried both chevrons off a 390 pt screen.
    expect(pagerModeFor(11, IPHONE)).toBe('counter');
    expect(pagerModeFor(30, IPHONE)).toBe('counter');
  });

  /**
   * The actual contract: whatever mode is chosen, the dots must never need more room than
   * there is. This is the assertion that fails if someone grows the dot or the chevron.
   */
  it('never chooses dots that do not fit, at any count or width', () => {
    [IPHONE_SE, IPHONE, IPAD_PORTRAIT, 1024].forEach((width) => {
      for (let count = 1; count <= 40; count += 1) {
        if (pagerModeFor(count, width) === 'dots') {
          expect(count * DOT_TOTAL_W).toBeLessThanOrEqual(width - NAV_RESERVED_W);
        }
      }
    });
  });

  it('gives a wider screen more dots before falling back', () => {
    const dotsOn = (width: number) => {
      let n = 0;
      for (let count = 2; count <= 60; count += 1) {
        if (pagerModeFor(count, width) === 'dots') n = count;
      }
      return n;
    };
    expect(dotsOn(IPAD_PORTRAIT)).toBeGreaterThan(dotsOn(IPHONE));
    expect(dotsOn(IPHONE)).toBeGreaterThan(dotsOn(IPHONE_SE));
  });

  it('falls back rather than overflowing on the narrowest phone', () => {
    expect(pagerModeFor(9, IPHONE_SE)).toBe('counter');
  });
});
