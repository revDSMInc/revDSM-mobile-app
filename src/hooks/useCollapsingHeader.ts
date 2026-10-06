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
  nextCollapseState,
  settleDuration,
  settleTarget,
} from '../utils/collapsing-header';

export interface CollapsingHeader {
  /**
   * Style for the header, which is an ABSOLUTE OVERLAY (`Reanimated.View`, top: 0): it slides up
   * with `translateY` and fades. The ScrollView below it never moves or resizes.
   */
  headerStyle: any;
  /** Style that slides the pinned trackers up by the same amount (`DynamicTabRenderer`). */
  trackerStyle: any;
  /** The header's measured height: how far down the list/trackers must start. 0 until measured. */
  topInset: number;
  /** Put on the header's `onLayout` so its natural height is measured once. */
  onHeaderLayout: (e: { nativeEvent: { layout: { height: number } } }) => void;
  /**
   * Spread onto the scrolling view, which MUST be a Reanimated scroll view
   * (`Reanimated.ScrollView`, or keyboard-controller's `KeyboardAwareScrollView`, which is
   * one). `onScroll` is a worklet handler that also carries the drag/momentum events.
   */
  scrollProps: {
    onScroll: any;
    scrollEventThrottle: number;
  };
  /** Top padding for whatever sits DIRECTLY under the header (the pinned tracker). */
  underHeaderStyle: { paddingTop: number };
  /** Kept for callers; the header state now lives on the UI thread. */
  hidden: boolean;
}

/** Gap above the pinned tracker. */
export const UNDER_HEADER_PAD_OPEN = 8;
export const UNDER_HEADER_PAD_COLLAPSED = 2;

/**
 * Instagram-style collapsing header: it FOLLOWS THE FINGER as the rep scrolls and settles
 * open or closed when they let go. The maths is `utils/collapsing-header.ts` (pure, worklet).
 *
 * ⚠️ TWO things were wrong with the first versions, and both were reported as "the screen
 * shakes":
 *
 * 1. THE ONE THAT MATTERS: the ScrollView itself moved (height, then a translated block). A
 *    scroll view measures the finger RELATIVE TO ITSELF, so every px it slides under a held
 *    finger reads as extra finger travel: it scrolls more, which collapses more - a feedback
 *    loop that exists ONLY while a finger is down ("shakes when I hold, calm when I let go").
 *    Now the header and the pinned trackers are ABSOLUTE OVERLAYS that slide up, and the
 *    ScrollView never moves or resizes; the list pads itself down by the header + tracker
 *    height instead. ⚠️ Nothing that contains the scroll view may be translated/resized from
 *    scroll position, ever.
 *
 * 2. The collapse was computed in a JS `onScroll` and pushed to the native transform a frame
 *    or two LATER. The scroll offset itself is native and instant, so while a finger was
 *    down the content (scroll + translate) fought itself - shaking only while holding, calm
 *    once released and momentum took over. The whole calculation now runs as a Reanimated
 *    scroll-handler WORKLET on the UI thread, in the same frame as the scroll.
 *    ⚠️ Never move it back into a JS `onScroll`/`setValue`.
 *
 * ⚠️ There is NO threshold and no fixed duration while a finger is down - the value is set
 * straight from the scroll delta. The measured header height is captured ONCE (its own
 * layout is stable now, but the first read is the real one).
 */
export function useCollapsingHeader(
  enabled: boolean = true,
  resetKey?: string | number
): CollapsingHeader {
  /** px of the header currently eaten. Written only on the UI thread while scrolling. */
  const collapsed = useSharedValue(0);
  const lastY = useSharedValue(0);
  const headerH = useSharedValue(0);
  /** Finger down, or its fling still running? (stops the header blinking - see utils.) */
  const userDriven = useSharedValue(false);
  /** A settle animation is playing; ignore the layout shift it causes. */
  const settling = useSharedValue(false);

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

  /**
   * Snap the remainder to whichever end is nearer. ⚠️ A drag ending does NOT end the gesture
   * - a fling hands over to momentum and the header keeps tracking through it; only
   * `onMomentumEnd` truly ends it. A drag with no fling emits no momentum events, so
   * `onEndDrag` settles too, and a fling re-opens the gesture via `onMomentumBegin`.
   */
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

  /**
   * Snap back open whenever `resetKey` changes - the Job Builder passes the active tab id.
   * ⚠️ Without this, advancing with the header collapsed lands the rep on a fresh tab scrolled
   * to the top with no step timeline.
   */
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

  // Fades over the FIRST HALF of the travel, so the step pills are gone before the header is a
  // thin sliver.
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
    // 16ms ~ one frame: the handler runs per scroll event, on the UI thread.
    scrollProps: { onScroll, scrollEventThrottle: 16 },
    hidden: false,
  };
}

export default useCollapsingHeader;
