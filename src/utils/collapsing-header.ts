export const TOP_ZONE_PX = 24;

export const BOUNCE_SLOP_PX = 4;

export const SETTLE_CLOSED_FRACTION = 0.4;

export interface CollapseState {
  collapsed: number;
  lastY: number;
}

export const INITIAL_COLLAPSE_STATE: CollapseState = {
  collapsed: 0,
  lastY: 0,
};

export interface CollapseInput {
  y: number;
  headerHeight?: number;
  contentHeight?: number;
  layoutHeight?: number;
  userDriven?: boolean;
}

export function nextCollapseState(prev: CollapseState, input: CollapseInput): CollapseState {
  'worklet';
  const { y, headerHeight = 0, contentHeight, layoutHeight } = input;
  const userDriven = input.userDriven !== false;

  const follow = (collapsed: number): CollapseState => {
    'worklet';
    return prev.collapsed === collapsed && prev.lastY === y ? prev : { collapsed, lastY: y };
  };

  const scrollable =
    typeof contentHeight === 'number' && typeof layoutHeight === 'number'
      ? contentHeight - layoutHeight
      : Infinity;
  if (headerHeight <= 0 || scrollable <= TOP_ZONE_PX) return follow(0);

  if (y <= TOP_ZONE_PX) return follow(0);

  if (scrollable !== Infinity && y > scrollable + BOUNCE_SLOP_PX) {
    return prev.lastY === y ? prev : { ...prev, lastY: y };
  }

  if (!userDriven) return prev.lastY === y ? prev : { ...prev, lastY: y };

  const delta = y - prev.lastY;
  if (delta === 0) return prev;

  const collapsed = Math.max(0, Math.min(headerHeight, prev.collapsed + delta));
  return collapsed === prev.collapsed && prev.lastY === y ? prev : { collapsed, lastY: y };
}

export function settleTarget(collapsed: number, headerHeight: number): number {
  'worklet';
  if (headerHeight <= 0) return 0;
  return collapsed >= headerHeight * SETTLE_CLOSED_FRACTION ? headerHeight : 0;
}

export const SETTLE_MAX_MS = 220;
export const SETTLE_MIN_MS = 90;

export function settleDuration(collapsed: number, target: number, headerHeight: number): number {
  'worklet';
  if (headerHeight <= 0) return SETTLE_MIN_MS;
  const fraction = Math.abs(target - collapsed) / headerHeight;
  return Math.round(SETTLE_MIN_MS + (SETTLE_MAX_MS - SETTLE_MIN_MS) * fraction);
}
