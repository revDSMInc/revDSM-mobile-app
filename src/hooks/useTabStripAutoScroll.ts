import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

const EDGE_EPSILON = 2;
const STEP_FRACTION = 0.7;

export function useTabStripAutoScroll(activeId: string, scope: string = 'default') {
  const ref = useRef<ScrollView>(null);
  const boxes = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);
  const content = useRef(0);
  const offset = useRef(0);
  const [edges, setEdges] = useState({ back: false, forward: false });

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
