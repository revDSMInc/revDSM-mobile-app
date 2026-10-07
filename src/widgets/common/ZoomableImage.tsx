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

const DEFAULT_MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const RESET_MS = 180;

export interface ZoomableImageProps {
  source?: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'center' | 'repeat';
  resetKey?: string | number;
  maxScale?: number;
  onSingleTap?: () => void;
  onSwipe?: (translationX: number, translationY: number) => void;
}

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
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);

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

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDistance(TAP_MAX_DISTANCE)
    .onEnd((_e, success) => {
      if (success && onSingleTap) runOnJS(onSingleTap)();
    });

  const swipe = Gesture.Pan()
    .enabled(!zoomed && !!onSwipe)
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
