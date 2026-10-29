/**
 * How the RevRender viewer's footer shows "which render am I on".
 *
 * Pure so it can be tested: `RevRenderHistoryModal` itself reaches React Native and cannot be
 * loaded under jest (CLAUDE.md section 6).
 */

/** A dot plus its margins. Keep in sync with `styles.dot` in the modal. */
export const DOT_TOTAL_W = 26;

/**
 * What the dots cannot have: both chevrons (32 px icon + 10 px padding either side) and the
 * 20 px gutter on each side of the strip, plus the row's own 8 px padding either side.
 */
export const NAV_RESERVED_W = 2 * 52 + 2 * 20 + 16;

export type PagerMode = 'none' | 'dots' | 'counter';

/**
 * ⚠️ The dots are a FIXED width each, and the footer row was centred with nothing bounding it.
 * Past ~8 renders the strip is wider than the screen, so the row overflowed at BOTH ends and
 * carried the chevrons off the edges - the right one half cut off, the left one gone entirely.
 *
 * The fix is not to shrink the dots: at 15 renders they become hairlines nobody can count. It is
 * to stop drawing them once they no longer fit and show a "3 / 11" counter instead, which is
 * bounded at any number of renders.
 *
 * Measured against the REAL width rather than a magic render count, because what competes for
 * the space is the chevrons and the gutters - and that is different on a phone and an iPad.
 */
export const pagerModeFor = (count: number, screenWidth: number): PagerMode => {
  if (!Number.isFinite(count) || count <= 1) return 'none';
  const available = screenWidth - NAV_RESERVED_W;
  return count * DOT_TOTAL_W <= available ? 'dots' : 'counter';
};
