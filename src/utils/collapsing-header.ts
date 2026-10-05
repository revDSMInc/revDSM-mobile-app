/**
 * The maths behind an Instagram-style collapsing header.
 *
 * ⚠️ This is **finger-tracked, not threshold-triggered**. An earlier version decided
 * "hidden: true" once a scroll passed a threshold and then played a fixed animation from
 * open to closed — which reads as the header SNAPPING away, because the rep's finger has
 * no influence once the animation starts. Instagram's header is wherever your thumb put
 * it: drag 30px and it is 30px shorter. That is what this computes. Do not reintroduce a
 * threshold; the reported "hides instantly / comes back instantly" was exactly that.
 *
 * The rule is a running total of scroll delta, clamped to the header's height:
 *
 *   collapsed = clamp(collapsed + (y - lastY), 0, headerHeight)
 *
 * so scrolling down eats into the header and scrolling up gives it back, continuously.
 * On release the remainder settles to whichever end is nearer (`settleTarget`).
 *
 * Kept free of React Native imports so it can be tested; the animation and the scroll
 * wiring live in `hooks/useCollapsingHeader.ts`.
 */

/** Below this offset the header is always fully open. */
export const TOP_ZONE_PX = 24;

/**
 * How far past the end of the content the offset may sit before samples are ignored.
 *
 * ⚠️ iOS over-scrolls past the bottom and then SETTLES BACK, which is a downward offset
 * change with no finger involved. Consumed as scroll it eats the header on release and
 * gives it back as the bounce completes — the "header goes when I scroll up, comes back
 * when I let go" report. `TOP_ZONE_PX` already covers the same effect at the top.
 */
export const BOUNCE_SLOP_PX = 4;

/**
 * Past this fraction of the header's height, a release settles CLOSED rather than open.
 *
 * Deliberately below half: once a rep has pushed most of the header away they meant to,
 * and springing it back because they stopped at 45% is the more annoying error.
 */
export const SETTLE_CLOSED_FRACTION = 0.4;

export interface CollapseState {
  /** How many px of the header are currently eaten, 0 … headerHeight. */
  collapsed: number;
  /** The previous raw offset, so a delta can be taken. */
  lastY: number;
}

export const INITIAL_COLLAPSE_STATE: CollapseState = {
  collapsed: 0,
  lastY: 0,
};

export interface CollapseInput {
  /** `contentOffset.y` */
  y: number;
  /** The header's measured height. 0/undefined until it has been laid out. */
  headerHeight?: number;
  /** `contentSize.height` */
  contentHeight?: number;
  /** `layoutMeasurement.height` */
  layoutHeight?: number;
  /**
   * Is the rep's finger down, or is this momentum from their fling?
   *
   * ⚠️ Decisive. Collapsing the header shrinks the layout ABOVE the scroll view, the
   * scroll view grows, and its `contentOffset.y` moves on its own — which fires
   * `onScroll` and would be consumed as the rep scrolling the other way, giving the
   * header back, which shifts the offset again: the BLINKING. Only samples the rep is
   * actually driving may move the header.
   *
   * Defaults to true so a caller that cannot supply it keeps the simple behaviour.
   */
  userDriven?: boolean;
}

/**
 * Fold a scroll sample into the collapse state. Returns the SAME object when nothing
 * changed, so a caller can skip the state update with a cheap identity check.
 */
export function nextCollapseState(prev: CollapseState, input: CollapseInput): CollapseState {
  const { y, headerHeight = 0, contentHeight, layoutHeight } = input;
  const userDriven = input.userDriven !== false;

  const follow = (collapsed: number): CollapseState =>
    prev.collapsed === collapsed && prev.lastY === y ? prev : { collapsed, lastY: y };

  // Nothing to collapse yet (not laid out), or not enough content to scroll. ⚠️ A list
  // barely taller than its viewport must stay fully open: there is no travel left to
  // scroll back up with, so a rep who collapsed it could never get the timeline back.
  const scrollable =
    typeof contentHeight === 'number' && typeof layoutHeight === 'number'
      ? contentHeight - layoutHeight
      : Infinity;
  if (headerHeight <= 0 || scrollable <= TOP_ZONE_PX) return follow(0);

  // At (or rubber-banded above) the top: always fully open.
  if (y <= TOP_ZONE_PX) return follow(0);

  // Past the END of the content: a bounce settling, not a scroll. Track the offset so the
  // next real sample takes its delta from here, but do not consume it.
  if (scrollable !== Infinity && y > scrollable + BOUNCE_SLOP_PX) {
    return prev.lastY === y ? prev : { ...prev, lastY: y };
  }

  // Not the rep's doing — follow the offset, change nothing. See `userDriven`.
  if (!userDriven) return prev.lastY === y ? prev : { ...prev, lastY: y };

  const delta = y - prev.lastY;
  if (delta === 0) return prev;

  // The whole behaviour, in one line: scrolling down eats the header, scrolling up gives
  // it back, 1:1 with the finger.
  const collapsed = Math.max(0, Math.min(headerHeight, prev.collapsed + delta));
  return collapsed === prev.collapsed && prev.lastY === y ? prev : { collapsed, lastY: y };
}

/**
 * Where a part-collapsed header lands when the rep lets go: 0 (fully open) or
 * `headerHeight` (fully closed). Never leaves it halfway.
 */
export function settleTarget(collapsed: number, headerHeight: number): number {
  if (headerHeight <= 0) return 0;
  return collapsed >= headerHeight * SETTLE_CLOSED_FRACTION ? headerHeight : 0;
}

/**
 * How long the settle takes: proportional to the distance still to travel, so a header
 * already 90% closed finishes almost instantly instead of taking as long as one that has
 * barely moved.
 */
export const SETTLE_MAX_MS = 220;
export const SETTLE_MIN_MS = 90;

export function settleDuration(collapsed: number, target: number, headerHeight: number): number {
  if (headerHeight <= 0) return SETTLE_MIN_MS;
  const fraction = Math.abs(target - collapsed) / headerHeight;
  return Math.round(SETTLE_MIN_MS + (SETTLE_MAX_MS - SETTLE_MIN_MS) * fraction);
}
