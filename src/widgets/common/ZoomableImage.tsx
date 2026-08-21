import React, { useEffect, useState } from 'react';
import {
  type ImageSourcePropType,
  type ImageStyle,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  anchoredTranslate,
  clampPan,
  clampZoomScale,
  doubleTapTranslate,
  zoomOrigin,
} from '../../utils/zoom-transform';

/**
 * An image you can pinch, double-tap and drag to zoom — the standard photo-viewer
 * gesture set, as a drop-in replacement for a plain `<Image>`.
 *
 * WHY A COMPONENT: the pitch book paints the same slide from three places (the inline
 * card, and the fullscreen viewer's portrait and landscape layouts) and the roofline
 * deck repeats all three. Six copies of the gesture maths is six chances for one
 * surface to behave differently from the others.
 *
 * `source` is an `ImageSourcePropType`, so a bundled `require()` deck and a
 * portal-authored `{ uri }` deck both work with no branching at the call site.
 *
 * ⚠️ Inside a react-native `Modal` on Android the content must be wrapped in a
 * `GestureHandlerRootView` or none of these gestures fire — the modal is its own
 * native view hierarchy and never reaches the app-root one in `App.tsx`.
 */

const DEFAULT_MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const RESET_MS = 180;

export interface ZoomableImageProps {
  source?: ImageSourcePropType;
  /** Style for the image itself — normally the same `{ width, height }` a plain Image took. */
  style?: StyleProp<ImageStyle>;
  /** Style for the gesture wrapper. It clips, so a zoomed slide can't paint over the chrome. */
  containerStyle?: StyleProp<ViewStyle>;
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'center' | 'repeat';
  /**
   * Change this to snap back to 1x — pass the slide identity, so moving to the next
   * slide never lands the rep on a half-zoomed view of it.
   */
  resetKey?: string | number;
  maxScale?: number;
}

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  source,
  style,
  containerStyle,
  resizeMode = 'contain',
  resetKey,
  maxScale = DEFAULT_MAX_SCALE,
}) => {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // The focal point of the live pinch, and the image-space point under it, so the
  // pixels between the fingers stay between the fingers as the scale changes.
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  // Measured at layout rather than required from the caller: every call site sizes
  // its image with percentages inside a flex box, so nobody knows the pixels up front.
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);

  // Pan is enabled ONLY while zoomed, so at 1x a drag still belongs to whatever is
  // around the image (a pager, a scroll view) instead of being swallowed here.
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    setZoomed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const handleLayout = (e: LayoutChangeEvent) => {
    boxW.value = e.nativeEvent.layout.width;
    boxH.value = e.nativeEvent.layout.height;
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalX.value = e.focalX - boxW.value / 2;
      focalY.value = e.focalY - boxH.value / 2;
      originX.value = zoomOrigin(focalX.value, savedTx.value, savedScale.value);
      originY.value = zoomOrigin(focalY.value, savedTy.value, savedScale.value);
    })
    .onUpdate((e) => {
      const next = clampZoomScale(savedScale.value * e.scale, maxScale);
      scale.value = next;
      // Keep the pinch anchored, then hold the image inside its own box — at 1x both
      // bounds are 0, so pinching all the way out re-centres by itself.
      tx.value = anchoredTranslate(focalX.value, originX.value, next, boxW.value);
      ty.value = anchoredTranslate(focalY.value, originY.value, next, boxH.value);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      runOnJS(setZoomed)(scale.value > 1);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      if (scale.value > 1) {
        scale.value = withTiming(1, { duration: RESET_MS });
        savedScale.value = 1;
        tx.value = withTiming(0, { duration: RESET_MS });
        ty.value = withTiming(0, { duration: RESET_MS });
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(setZoomed)(false);
        return;
      }
      const next = Math.min(DOUBLE_TAP_SCALE, maxScale);
      // Zoom toward the tapped point: at 1x the image-space origin IS the tap offset.
      const nextX = doubleTapTranslate(e.x - boxW.value / 2, next, boxW.value);
      const nextY = doubleTapTranslate(e.y - boxH.value / 2, next, boxH.value);
      scale.value = withTiming(next, { duration: RESET_MS });
      tx.value = withTiming(nextX, { duration: RESET_MS });
      ty.value = withTiming(nextY, { duration: RESET_MS });
      savedScale.value = next;
      savedTx.value = nextX;
      savedTy.value = nextY;
      runOnJS(setZoomed)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      tx.value = clampPan(savedTx.value, e.translationX, scale.value, boxW.value);
      ty.value = clampPan(savedTy.value, e.translationY, scale.value, boxH.value);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const composed = Gesture.Simultaneous(pan, pinch, doubleTap);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        onLayout={handleLayout}
        style={[
          { justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
          containerStyle,
        ]}
      >
        {source != null && (
          <Animated.Image source={source} style={[style, imageStyle]} resizeMode={resizeMode} />
        )}
      </Animated.View>
    </GestureDetector>
  );
};

export default ZoomableImage;
