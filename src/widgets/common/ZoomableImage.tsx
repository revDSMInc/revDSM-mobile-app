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
import { isRemoteImageUrl, warmToLocalCache } from '../../utils/imageFileCache';
import {
  SWIPE_ACTIVATE_DISTANCE,
  TAP_MAX_DISTANCE,
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
  /**
   * Fired on a single tap that is NOT the start of a double tap.
   *
   * Optional, and the gesture is only composed in when it is supplied — see `singleTap`.
   */
  onSingleTap?: () => void;
  /**
   * A horizontal swipe across the image while it is NOT zoomed, for hosts that page
   * between images. Receives the gesture's total travel; the host decides what counts.
   */
  onSwipe?: (translationX: number, translationY: number) => void;
}

/**
 * Serve a slide from the on-disk cache once it has been downloaded once.
 *
 * ⚠️ This is what makes a pitch book and a roofline deck PRESENTABLE WITH NO SIGNAL, and it
 * lives here rather than in each screen for the reason `PhotoPeekPressable` owns its own
 * warming: a slide is painted at five sites across two screens (inline card, fullscreen
 * portrait, fullscreen landscape, and the media viewer), and any one of them left on the
 * network url is a blank frame in front of a customer. One component, every site.
 *
 * The url it is handed offline is an EXPIRED presigned link, and that is fine —
 * `getLocalCachePath` strips the query, so the dead url still names the same file the live
 * one downloaded. See the note on `OFFLINE_CACHE.PITCH_BOOK_DECK`.
 *
 * A bundled `require()` deck is a number, not a url, and is returned untouched.
 */
const useCachedSource = (source?: ImageSourcePropType): ImageSourcePropType | undefined => {
  const uri =
    source && typeof source === 'object' && !Array.isArray(source)
      ? (source as { uri?: string }).uri
      : undefined;
  const [cached, setCached] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCached(null);
    if (!isRemoteImageUrl(uri)) return undefined;
    warmToLocalCache(uri)
      .then((file) => {
        if (active && file) setCached(file);
      })
      .catch(() => {
        /* Never worse than before: the caller's own url is still rendered below. */
      });
    return () => {
      active = false;
    };
  }, [uri]);

  if (!cached || !uri) return source;
  return { ...(source as object), uri: cached } as ImageSourcePropType;
};

export const ZoomableImage: React.FC<ZoomableImageProps> = ({
  source,
  style,
  containerStyle,
  resizeMode = 'contain',
  resetKey,
  maxScale = DEFAULT_MAX_SCALE,
  onSingleTap,
  onSwipe,
}) => {
  const resolvedSource = useCachedSource(source);
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

  /**
   * A single tap on the image, for hosts that use it to toggle their own chrome.
   *
   * ⚠️ `Gesture.Exclusive(doubleTap, singleTap)` — NOT `Simultaneous`. A double tap
   * begins with a single one, so composing them in parallel would fire the host's toggle
   * on the first tap of every zoom gesture: the chrome would flash away each time a rep
   * double-tapped to zoom into detail. Exclusive makes the single tap wait for the double
   * to fail, which is the standard 250 ms this component already sets on `maxDuration`.
   *
   * Absent the prop the composition is byte-identical to before, so the other callers
   * (the pitch book's inline card, Roofline Deck) are untouched.
   *
   * ⚠️ `maxDistance` is what keeps a SWIPE from also being this tap. The composition below
   * is `Simultaneous`, so the swipe activating does not cancel the tap, and an RNGH tap has
   * no movement limit by default — a quick swipe used to end as a successful tap as well,
   * and in the pitch book that toggled the dock back on with every page turn. See
   * `TAP_MAX_DISTANCE` in `utils/zoom-transform.ts`.
   */
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(TAP_MAX_DISTANCE)
    .onEnd((_e, success) => {
      if (success && onSingleTap) runOnJS(onSingleTap)();
    });

  /**
   * Paging swipe — the exact COMPLEMENT of `pan` above, which is `.enabled(zoomed)`.
   *
   * ⚠️ It lives in this composition rather than in an overlay laid on top of the image,
   * and that is the whole point. A sibling `GestureDetector` covering the image swallows
   * the touch whether or not its gesture activates, so the previous edge-strip version
   * ate taps on any control beneath it — the prev/next arrows sit at exactly those edges
   * — and only worked in the strips. Composed here it arbitrates with pinch and pan
   * properly and works across the WHOLE image.
   *
   * ⚠️ `.enabled(!zoomed)` is what keeps a zoomed-in slide draggable: pan and swipe are
   * never both live, so panning to detail can never turn into a page change.
   */
  const swipe = Gesture.Pan()
    .enabled(!zoomed && !!onSwipe)
    // Horizontal intent only, so a vertical drag still reaches a scrolling parent.
    .activeOffsetX([-SWIPE_ACTIVATE_DISTANCE, SWIPE_ACTIVATE_DISTANCE])
    .onEnd((e) => {
      if (onSwipe) runOnJS(onSwipe)(e.translationX, e.translationY);
    });

  const taps = onSingleTap ? Gesture.Exclusive(doubleTap, singleTap) : doubleTap;
  const composed = Gesture.Simultaneous(pan, pinch, taps, swipe);

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
        {resolvedSource != null && (
          <Animated.Image source={resolvedSource} style={[style, imageStyle]} resizeMode={resizeMode} />
        )}
      </Animated.View>
    </GestureDetector>
  );
};

export default ZoomableImage;
