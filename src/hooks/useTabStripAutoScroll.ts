import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

/** Within this many points of an end counts as AT the end (sub-pixel offsets never read 0). */
const EDGE_EPSILON = 2;
/** A tap on an edge arrow moves this fraction of the visible width — enough to bring the
 *  hidden neighbour fully in, never so much that the rep loses their place. */
const STEP_FRACTION = 0.7;

/**
 * Keeps the ACTIVE tab of a horizontal tab strip in view.
 *
 * Ticket: *"apply the auto scroll on the bar if user pass the pages … if the user is on page
 * 15 but the bottom view is still on the heading 1 from the bottom, that is wrong."* The Pitch
 * Book advances `activeCategory` when the rep pages past a section's last slide, so the state
 * was already right — but the strip is a horizontal scroller and nothing ever moved it, so the
 * live tab sat off-screen to the right while the bar still showed section 1.
 *
 * ⚠️ Written as a hook because the pitch book has TWO strips with the same requirement — the
 * fullscreen dock and the inline card's category bar — and a copy in each is exactly how the
 * two presentation bars drifted apart the last time.
 *
 * Usage:
 * ```tsx
 * const strip = useTabStripAutoScroll(activeId);
 * <ScrollView horizontal ref={strip.ref} onLayout={strip.onLayout}
 *             onContentSizeChange={strip.onContentSizeChange}
 *             onScroll={strip.onScroll} scrollEventThrottle={16}>
 *   {tabs.map((t) => <Pill key={t.id} onLayout={strip.onTabLayout(t.id)} … />)}
 * </ScrollView>
 * {strip.canScrollBack && <Arrow onPress={() => strip.step('back')} />}
 * ```
 *
 * `canScrollBack` / `canScrollForward` + `step` drive the edge arrows that tell the rep more
 * tabs exist off-screen. ⚠️ `onScroll` must be wired (with `scrollEventThrottle`) or the two
 * flags never move off their first value.
 *
 * @param activeId the id of the tab that should be visible
 * @param scope    a discriminator for strips that render DIFFERENT tab sets into the SAME
 *                 scroller (the dock swaps categories for tools). Without it a tab could read
 *                 a stale box belonging to the other set on the frame after the swap and
 *                 scroll to a position that means nothing in the row now on screen.
 */
export function useTabStripAutoScroll(activeId: string, scope: string = 'default') {
  const ref = useRef<ScrollView>(null);
  const boxes = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);
  const content = useRef(0);
  const offset = useRef(0);
  const [edges, setEdges] = useState({ back: false, forward: false });

  /*
    ⚠️ Set ONLY when a flag actually flips. This runs on every scroll frame, and an
    unconditional setState there would re-render the whole dock ~60 times a second while the
    rep drags the strip.
  */
  const syncEdges = useCallback(() => {
    const view = viewport.current;
    const max = content.current - view;
    const back = offset.current > EDGE_EPSILON;
    const forward = view > 0 && max > EDGE_EPSILON && offset.current < max - EDGE_EPSILON;
    setEdges((prev) => (prev.back === back && prev.forward === forward ? prev : { back, forward }));
  }, []);

  const keyOf = useCallback((id: string) => `${scope}:${id}`, [scope]);

  const reveal = useCallback(
    (animated = true) => {
      const box = boxes.current[`${scope}:${activeId}`];
      const view = viewport.current;
      if (!box || view <= 0) return;
      // Centre the tab where there is room to; the clamp is what keeps the first and last
      // tabs flush against their ends rather than floating in from the edge.
      let x = box.x + box.width / 2 - view / 2;
      if (content.current > 0) x = Math.min(x, content.current - view);
      ref.current?.scrollTo({ x: Math.max(0, x), animated });
    },
    [activeId, scope]
  );

  useEffect(() => {
    reveal();
  }, [reveal]);

  const onTabLayout = useCallback(
    (id: string) => (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      boxes.current[keyOf(id)] = { x, width };
      /*
        ⚠️ A tab that measures AFTER the effect has run — first paint, a set swap, a rotation
        — would otherwise never be revealed: the effect has already fired for this `activeId`
        and nothing re-runs it. Un-animated here, since this is the arrival position rather
        than a move the rep should see.
      */
      if (id === activeId) reveal(false);
    },
    [activeId, keyOf, reveal]
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewport.current = e.nativeEvent.layout.width;
      reveal(false);
      syncEdges();
    },
    [reveal, syncEdges]
  );

  const onContentSizeChange = useCallback(
    (w: number) => {
      content.current = w;
      reveal(false);
      syncEdges();
    },
    [reveal, syncEdges]
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.x;
      syncEdges();
    },
    [syncEdges]
  );

  const step = useCallback((direction: 'back' | 'forward') => {
    const view = viewport.current;
    if (view <= 0) return;
    const max = Math.max(0, content.current - view);
    const delta = view * STEP_FRACTION * (direction === 'forward' ? 1 : -1);
    const x = Math.min(max, Math.max(0, offset.current + delta));
    ref.current?.scrollTo({ x, animated: true });
  }, []);

  return {
    ref,
    onLayout,
    onContentSizeChange,
    onTabLayout,
    onScroll,
    step,
    canScrollBack: edges.back,
    canScrollForward: edges.forward,
  };
}

export default useTabStripAutoScroll;
