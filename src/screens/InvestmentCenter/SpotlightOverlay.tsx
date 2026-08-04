import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Dimensions,
  StatusBar,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';

const { width: SW, height: SH } = Dimensions.get('window');
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// How far above dead-center the enlarged card settles, so it clears the bottom
// step-controls pill.
const SETTLE_DY = -SH * 0.04;
const OPEN_MS = 300;
const CLOSE_MS = 240;
const EASE = Easing.out(Easing.cubic);

export interface SpotlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpotlightState {
  /** Stable id of the section currently enlarged. */
  id: string;
  /** The section's in-place footprint in window coordinates (from measureInWindow). */
  rect: SpotlightRect;
  /** Settled zoom factor (already clamped to fit the screen). */
  finalScale: number;
}

interface Props {
  /** The active section, or null when nothing is enlarged (overlay unmounts). */
  spotlight: SpotlightState | null;
  /** Title shown in the bottom step-controls pill. */
  title: string;
  /** Fired once the collapse animation finishes — the parent clears `spotlight`. */
  onClosed: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** The enlarged card, laid out at width = spotlight.rect.w (scale does the zoom). */
  children: React.ReactNode;
}

/**
 * iOS-style "spotlight" zoom for the Investment Center cards. Tapping a card
 * (Total Investment / 1-Year Program / In-Home Pre Order) lifts it off the page:
 * it flies from its in-place footprint to screen-center while scaling up, and the
 * rest of the screen dims. The card stays fully interactive while enlarged; the
 * bottom pill steps forward/back through the three sections without collapsing, and
 * tapping the dimmed area collapses the card back into its place.
 *
 * The transition is a FLIP: the enlarged content is laid out at the section's real
 * in-place width, so at scale 1 it exactly overlays the original card; it then
 * animates translate→center + scale→finalScale (and reverses on close).
 */
export function SpotlightOverlay({ spotlight, title, onClosed, onPrev, onNext, children }: Props) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const backdrop = useSharedValue(0);
  // Card opacity — starts hidden so the very first paint (before the open effect
  // positions the card at its origin) never flashes it at center.
  const reveal = useSharedValue(0);
  // Inner-content opacity — cross-fades the card body on a forward/back switch.
  const contentOpacity = useSharedValue(1);

  const prevIdRef = useRef<string | null>(null);

  const rect = spotlight?.rect ?? null;
  const finalScale = spotlight?.finalScale ?? 1;

  useEffect(() => {
    const id = spotlight?.id ?? null;
    const prev = prevIdRef.current;
    prevIdRef.current = id;
    if (!id || !rect) return;

    // Origin transform: the card is laid out centered (its layout center = screen
    // center) at width rect.w, so translating its center to the section's real
    // center + scale 1 makes it overlay the in-place card exactly.
    const originTx = rect.x + rect.w / 2 - SW / 2;
    const originTy = rect.y + rect.h / 2 - SH / 2;

    if (!prev) {
      // OPEN — snap to the origin, reveal, then fly to center while zooming up.
      tx.value = originTx;
      ty.value = originTy;
      scale.value = 1;
      contentOpacity.value = 1;
      reveal.value = 1;
      backdrop.value = withTiming(1, { duration: OPEN_MS, easing: EASE });
      tx.value = withTiming(0, { duration: OPEN_MS, easing: EASE });
      ty.value = withTiming(SETTLE_DY, { duration: OPEN_MS, easing: EASE });
      scale.value = withTiming(finalScale, { duration: OPEN_MS, easing: EASE });
    } else if (prev !== id) {
      // SWITCH — new section grows from its own in-place slot; body cross-fades.
      tx.value = originTx;
      ty.value = originTy;
      scale.value = 1;
      contentOpacity.value = 0;
      contentOpacity.value = withTiming(1, { duration: OPEN_MS, easing: EASE });
      tx.value = withTiming(0, { duration: OPEN_MS, easing: EASE });
      ty.value = withTiming(SETTLE_DY, { duration: OPEN_MS, easing: EASE });
      scale.value = withTiming(finalScale, { duration: OPEN_MS, easing: EASE });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlight?.id]);

  const requestClose = () => {
    const r = rect;
    if (!r) {
      onClosed();
      return;
    }
    const originTx = r.x + r.w / 2 - SW / 2;
    const originTy = r.y + r.h / 2 - SH / 2;
    // Collapse back into the section's place, then let the parent unmount us.
    backdrop.value = withTiming(0, { duration: CLOSE_MS, easing: EASE });
    tx.value = withTiming(originTx, { duration: CLOSE_MS, easing: EASE });
    ty.value = withTiming(originTy, { duration: CLOSE_MS, easing: EASE });
    scale.value = withTiming(1, { duration: CLOSE_MS, easing: EASE }, (finished) => {
      if (finished) {
        reveal.value = 0;
        runOnJS(onClosed)();
      }
    });
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const controlsStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

  return (
    <Modal visible={!!spotlight} transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      {!!spotlight && <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />}

      {/* Dimmed backdrop — tap anywhere off the card to collapse it. */}
      <AnimatedPressable
        onPress={requestClose}
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.72)' },
          backdropStyle,
        ]}
      />

      {/* Centered enlarged card. box-none lets taps on the empty margin fall
          through to the backdrop, while the card keeps its own touches. */}
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View pointerEvents="box-none" style={[{ width: rect?.w ?? SW * 0.8 }, cardStyle]}>
          <Animated.View pointerEvents="box-none" style={contentStyle}>
            {children}
          </Animated.View>
        </Animated.View>
      </View>

      {/* Bottom step controls — exit hint + prev / title / next pill. */}
      <Animated.View
        pointerEvents="box-none"
        style={[{ position: 'absolute', left: 0, right: 0, bottom: SH * 0.045, alignItems: 'center' }, controlsStyle]}
      >
        <Pressable onPress={requestClose} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 16 }}>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
            Tap anywhere to exit
          </Text>
        </Pressable>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: 'rgba(30,41,59,0.9)',
            borderRadius: 999,
            paddingVertical: 8,
            paddingLeft: 8,
            paddingRight: 8,
            marginTop: 6,
          }}
        >
          <Pressable
            onPress={onPrev}
            hitSlop={8}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>
          <Text
            numberOfLines={1}
            style={{ color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 0.5, minWidth: 120, textAlign: 'center' }}
          >
            {title}
          </Text>
          <Pressable
            onPress={onNext}
            hitSlop={8}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

export default SpotlightOverlay;
