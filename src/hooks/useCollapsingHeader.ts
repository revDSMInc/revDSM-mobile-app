import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  fitsWithoutScrolling,
  nextCollapseState,
  settleDuration,
  settleTarget,
} from '../utils/collapsing-header';

export interface CollapsingHeader {
  headerStyle: any;
  trackerStyle: any;
  topInset: number;
  onHeaderLayout: (e: { nativeEvent: { layout: { height: number } } }) => void;
  scrollProps: {
    onScroll: any;
    onContentSizeChange: (w: number, h: number) => void;
    scrollEventThrottle: number;
  };
  underHeaderStyle: { paddingTop: number };
  hidden: boolean;
  /** Snap the header open (no animation). */
  reset: () => void;
}

const SETTLE_REOPEN_MS = 160;

export const UNDER_HEADER_PAD_OPEN = 8;
export const UNDER_HEADER_PAD_COLLAPSED = 2;

export function useCollapsingHeader(
  enabled: boolean = true,
  resetKey?: string | number
): CollapsingHeader {
  const collapsed = useSharedValue(0);
  const lastY = useSharedValue(0);
  const headerH = useSharedValue(0);
  const userDriven = useSharedValue(false);
  const settling = useSharedValue(false);
  const layoutH = useSharedValue(0);

  const [headerHeight, setHeaderHeight] = useState(0);
  const headerHeightRef = useRef(0);
  const onHeaderLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (headerHeightRef.current === 0 && h > 0) {
        headerHeightRef.current = h;
        headerH.value = h;
        setHeaderHeight(h);
      }
    },
    [headerH]
  );

  const settle = () => {
    'worklet';
    const h = headerH.value;
    if (h <= 0) return;
    const from = collapsed.value;
    const to = settleTarget(from, h);
    if (from === to) return;
    settling.value = true;
    collapsed.value = withTiming(
      to,
      { duration: settleDuration(from, to, h), easing: Easing.out(Easing.cubic) },
      () => {
        'worklet';
        settling.value = false;
      }
    );
  };

  useEffect(() => {
    userDriven.value = false;
    settling.value = false;
    lastY.value = 0;
    collapsed.value = 0;
  }, [resetKey, collapsed, lastY, userDriven, settling]);

  const onScroll = useAnimatedScrollHandler(
    {
      onBeginDrag: () => {
        userDriven.value = true;
      },
      onScroll: (e) => {
        layoutH.value = e.layoutMeasurement.height;
        if (!enabled) return;
        const prev = { collapsed: collapsed.value, lastY: lastY.value };
        const next = nextCollapseState(prev, {
          y: e.contentOffset.y,
          headerHeight: headerH.value,
          contentHeight: e.contentSize.height,
          layoutHeight: e.layoutMeasurement.height,
          userDriven: userDriven.value && !settling.value,
        });
        lastY.value = next.lastY;
        if (next.collapsed !== prev.collapsed) collapsed.value = next.collapsed;
      },
      onEndDrag: () => {
        userDriven.value = false;
        settle();
      },
      onMomentumBegin: () => {
        userDriven.value = true;
        settling.value = false;
      },
      onMomentumEnd: () => {
        userDriven.value = false;
        settle();
      },
    },
    [enabled]
  );

  // ⚠️ iOS emits NO scroll event when the content shrinks until it fits (a submitted agreement /
  // order sheet re-renders the summary), so a header collapsed by an earlier scroll stayed
  // half-faded and half-slid-up. Re-open it whenever the content stops being scrollable.
  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      if (fitsWithoutScrolling(h, layoutH.value) && collapsed.value !== 0) {
        settling.value = false;
        collapsed.value = withTiming(0, { duration: SETTLE_REOPEN_MS, easing: Easing.out(Easing.cubic) });
        lastY.value = 0;
      }
    },
    [collapsed, lastY, layoutH, settling]
  );

  const reset = useCallback(() => {
    settling.value = false;
    userDriven.value = false;
    lastY.value = 0;
    collapsed.value = 0;
  }, [collapsed, lastY, settling, userDriven]);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity:
      headerH.value > 0
        ? interpolate(
            collapsed.value,
            [0, headerH.value * 0.5, headerH.value],
            [1, 0.35, 0],
            Extrapolation.CLAMP
          )
        : 1,
    transform: [{ translateY: -collapsed.value }],
  }));
  const trackerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -collapsed.value }],
  }));

  return {
    headerStyle: headerAnimatedStyle,
    trackerStyle: trackerAnimatedStyle,
    topInset: headerHeight,
    underHeaderStyle: { paddingTop: UNDER_HEADER_PAD_OPEN },
    onHeaderLayout,
    scrollProps: { onScroll, onContentSizeChange, scrollEventThrottle: 16 },
    hidden: false,
    reset,
  };
}

export default useCollapsingHeader;
