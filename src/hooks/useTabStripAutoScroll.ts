import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';

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
 *             onContentSizeChange={strip.onContentSizeChange}>
 *   {tabs.map((t) => <Pill key={t.id} onLayout={strip.onTabLayout(t.id)} … />)}
 * </ScrollView>
 * ```
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
    },
    [reveal]
  );

  const onContentSizeChange = useCallback(
    (w: number) => {
      content.current = w;
      reveal(false);
    },
    [reveal]
  );

  return { ref, onLayout, onContentSizeChange, onTabLayout };
}

export default useTabStripAutoScroll;
