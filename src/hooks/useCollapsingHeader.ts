import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import {
  INITIAL_COLLAPSE_STATE,
  nextCollapseState,
  settleDuration,
  settleTarget,
  type CollapseState,
} from '../utils/collapsing-header';

export interface CollapsingHeader {
  /** Spread onto the collapsing header's `Animated.View`. */
  headerStyle: {
    height: Animated.AnimatedInterpolation<number> | undefined;
    opacity: Animated.AnimatedInterpolation<number> | number;
    overflow: 'hidden';
  };
  /** Put on the header's `onLayout` so its natural height is measured once. */
  onHeaderLayout: (e: { nativeEvent: { layout: { height: number } } }) => void;
  /**
   * Spread onto the scrolling view. Carries `onScroll` AND the touch/momentum handlers —
   * ⚠️ spread the whole object, don't cherry-pick `onScroll`, or the header blinks and
   * never settles (see `userDriven` in `utils/collapsing-header.ts`).
   */
  scrollProps: {
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
    onScrollBeginDrag: () => void;
    onScrollEndDrag: () => void;
    onMomentumScrollBegin: () => void;
    onMomentumScrollEnd: () => void;
    scrollEventThrottle: number;
  };
  /**
   * Animated top padding for whatever sits DIRECTLY under the header — here the pinned
   * allocation tracker. Tracks the collapse so the gap above the tracker closes with the
   * header instead of leaving it stranded below a band of white.
   */
  underHeaderStyle: { paddingTop: Animated.AnimatedInterpolation<number> | number };
  /** True once the header is more than half eaten. For callers that need to know. */
  hidden: boolean;
}

/** Gap above the pinned tracker with the header fully open / fully collapsed. */
export const UNDER_HEADER_PAD_OPEN = 8;
export const UNDER_HEADER_PAD_COLLAPSED = 2;

/**
 * Instagram-style collapsing header: the header's height FOLLOWS THE FINGER as the rep
 * scrolls, and settles open or closed when they let go.
 *
 * The maths is `utils/collapsing-header.ts`, which is pure and tested. This owns the
 * animated value, the measurement, and the gesture bookkeeping.
 *
 * ⚠️ It animates HEIGHT, not `translateY`. A translated header would slide out OVER the
 * content and leave a gap where it used to be, because the content's own layout does not
 * move — the pinned allocation tracker would stay put with a white band above it.
 * Collapsing the height lets everything below rise to fill the space, which is what the
 * ticket asks for. Height cannot be driven on the UI thread, so `useNativeDriver` is
 * false; it is one small view, which is not the thing to optimise here.
 *
 * ⚠️ There is NO threshold and no fixed duration while a finger is down. `setValue` per
 * scroll frame is what makes it feel attached to the thumb; an `Animated.timing` from
 * open to closed reads as a snap however long you make it, which is what the first
 * version did and what got reported.
 *
 * ⚠️ The measured height is captured ONCE. The header's own `onLayout` fires with ~0 as
 * it collapses, and adopting that would leave it unable to reopen.
 */
export function useCollapsingHeader(
  enabled: boolean = true,
  resetKey?: string | number
): CollapsingHeader {
  const stateRef = useRef<CollapseState>(INITIAL_COLLAPSE_STATE);
  const [hidden, setHidden] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerHeightRef = useRef(0);

  /** px of the header currently eaten. Driven directly, frame by frame, while dragging. */
  const collapsed = useRef(new Animated.Value(0)).current;

  /**
   * Is the rep's finger down, or is their fling still running?
   *
   * ⚠️ This is what stops the header blinking. Collapsing it shrinks the layout above the
   * scroll view, the offset moves by itself, and `onScroll` fires with nobody touching
   * the screen — which would be consumed as a scroll the other way and hand the header
   * straight back.
   */
  const userDrivenRef = useRef(false);
  /** A settle animation is playing; ignore the layout shift it causes. */
  const settlingRef = useRef(false);

  const onHeaderLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = e.nativeEvent.layout.height;
    // Measure once — see the warning above.
    if (headerHeightRef.current === 0 && h > 0) {
      headerHeightRef.current = h;
      setHeaderHeight(h);
    }
  }, []);

  /** Snap the remainder to whichever end is nearer. Called when the gesture ends. */
  const settle = useCallback(() => {
    const h = headerHeightRef.current;
    if (h <= 0) return;
    const from = stateRef.current.collapsed;
    const to = settleTarget(from, h);
    if (from === to) {
      setHidden(to > 0);
      return;
    }
    settlingRef.current = true;
    stateRef.current = { ...stateRef.current, collapsed: to };
    setHidden(to > 0);
    Animated.timing(collapsed, {
      toValue: to,
      // Proportional to the distance left, so a header already nearly shut finishes
      // almost at once rather than taking as long as one that has barely moved.
      duration: settleDuration(from, to, h),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      settlingRef.current = false;
    });
  }, [collapsed]);

  /**
   * Snap back open whenever `resetKey` changes — the Job Builder passes the active tab id.
   *
   * ⚠️ Without this, advancing to the next step with the header collapsed lands the rep on
   * a fresh tab scrolled to the top with no step timeline, recoverable only by scrolling
   * down and back up. The scroll position resets on a tab change, so this must too.
   */
  useEffect(() => {
    stateRef.current = INITIAL_COLLAPSE_STATE;
    userDrivenRef.current = false;
    settlingRef.current = false;
    setHidden(false);
    collapsed.setValue(0);
  }, [resetKey, collapsed]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!enabled) return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const next = nextCollapseState(stateRef.current, {
        y: contentOffset.y,
        headerHeight: headerHeightRef.current,
        contentHeight: contentSize?.height,
        layoutHeight: layoutMeasurement?.height,
        userDriven: userDrivenRef.current && !settlingRef.current,
      });
      if (next === stateRef.current) return;
      const moved = next.collapsed !== stateRef.current.collapsed;
      stateRef.current = next;
      if (!moved) return;
      // Written straight to the animated value — no timing, no spring. THIS is the
      // finger-tracking; anything that interpolates here reintroduces the snap.
      collapsed.setValue(next.collapsed);
    },
    [enabled, collapsed]
  );

  const onScrollBeginDrag = useCallback(() => {
    userDrivenRef.current = true;
  }, []);
  /**
   * ⚠️ A drag ending does NOT end the gesture — a fling hands over to momentum and the
   * header must keep tracking through it, as Instagram's does. Only `onMomentumScrollEnd`
   * truly ends it. But a drag that stops without a fling emits no momentum events at all,
   * so this has to settle too; a fling then re-opens the gesture via
   * `onMomentumScrollBegin`, which RN fires after `onScrollEndDrag`.
   */
  const onScrollEndDrag = useCallback(() => {
    userDrivenRef.current = false;
    settle();
  }, [settle]);
  const onMomentumScrollBegin = useCallback(() => {
    userDrivenRef.current = true;
    settlingRef.current = false;
  }, []);
  const onMomentumScrollEnd = useCallback(() => {
    userDrivenRef.current = false;
    settle();
  }, [settle]);

  return {
    headerStyle: {
      height:
        headerHeight > 0
          ? collapsed.interpolate({
              inputRange: [0, headerHeight],
              outputRange: [headerHeight, 0],
              extrapolate: 'clamp',
            })
          : undefined,
      // Fades over the FIRST HALF of the travel, so the step pills are gone before the
      // header is a thin sliver — cross-fading all the way down looks like squashing.
      opacity:
        headerHeight > 0
          ? collapsed.interpolate({
              inputRange: [0, headerHeight * 0.5, headerHeight],
              outputRange: [1, 0.35, 0],
              extrapolate: 'clamp',
            })
          : 1,
      overflow: 'hidden',
    },
    underHeaderStyle: {
      // Eases from the open gap to the collapsed one across the SAME travel as the
      // header, so the two move as one block rather than the padding snapping at the end.
      paddingTop:
        headerHeight > 0
          ? collapsed.interpolate({
              inputRange: [0, headerHeight],
              outputRange: [UNDER_HEADER_PAD_OPEN, UNDER_HEADER_PAD_COLLAPSED],
              extrapolate: 'clamp',
            })
          : UNDER_HEADER_PAD_OPEN,
    },
    onHeaderLayout,
    scrollProps: {
      onScroll,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollBegin,
      onMomentumScrollEnd,
      // 16ms ≈ one frame. The header is redrawn per event, so a coarser throttle is
      // visible as stepping rather than sliding.
      scrollEventThrottle: 16,
    },
    hidden,
  };
}

export default useCollapsingHeader;
