import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { flipStart, GAUGE_FLIP, type FlipRect } from '../utils/drop-gauge';

/**
 * Morphs its child from a rectangle somewhere else on screen into where it is laid out - the
 * prototype's `flip()`, used for the full-screen swap into the drop screen.
 *
 * With no `from`, this is a plain `View` carrying `style`: nothing is measured and nothing moves,
 * so a caller can wrap unconditionally.
 *
 * ⚠️ HIDDEN UNTIL MEASURED. The child's own position is only known after layout, and drawing one
 * frame at the destination before the morph starts reads as a flicker. Opacity holds at 0 until
 * `measureInWindow` answers, then the start transform and opacity are applied together.
 *
 * ⚠️ `from` must be in WINDOW coordinates (`measureInWindow`), the same space this measures in.
 * Mixing in a parent-relative `onLayout` rect lands the morph in the wrong place by the scroll
 * offset and header height.
 *
 * The rule itself lives in `utils/drop-gauge.ts` (`flipStart`) so it is unit-tested.
 */
export function FlipFromRect({
  from,
  delay = 0,
  style,
  children,
}: {
  from?: FlipRect | null;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(1)).current;
  const op = useRef(new Animated.Value(from ? 0 : 1)).current;
  const started = useRef(false);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => animRef.current?.stop(), []);

  const onLayout = useCallback(() => {
    if (!from || started.current) return;
    started.current = true;
    ref.current?.measureInWindow((x, y, width, height) => {
      const s = flipStart(from, { x, y, width, height });
      if (!s) {
        op.setValue(1);
        return;
      }
      tx.setValue(s.translateX);
      ty.setValue(s.translateY);
      sc.setValue(s.scale);
      op.setValue(1);
      const cfg = {
        duration: GAUGE_FLIP.MS,
        delay,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      };
      animRef.current = Animated.parallel([
        Animated.timing(tx, { ...cfg, toValue: 0 }),
        Animated.timing(ty, { ...cfg, toValue: 0 }),
        Animated.timing(sc, { ...cfg, toValue: 1 }),
      ]);
      animRef.current.start();
    });
  }, [from, delay, tx, ty, sc, op]);

  if (!from) return <View style={style}>{children}</View>;

  return (
    <Animated.View
      ref={ref as any}
      collapsable={false}
      onLayout={onLayout}
      style={[
        style,
        { opacity: op, transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Fades its child up from 14px below on mount when `animate` is set - the prototype's
 * `canvas.returning` (`fadeUp .4s`), played when the rollout card comes back after the drop
 * screen closes. Without `animate` it is a plain `View`, so the first mount of the card and every
 * ordinary re-render are untouched.
 */
export function FadeUpOnMount({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return undefined;
    const a = Animated.timing(v, {
      toValue: 1,
      duration: GAUGE_FLIP.RETURN_MS,
      easing: Easing.bezier(0.2, 0.9, 0.25, 1),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
    // Mount only: the flag is read once, when the card comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!animate) return <View>{children}</View>;
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [GAUGE_FLIP.RETURN_PX, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
