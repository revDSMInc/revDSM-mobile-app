import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Ionicons';

import { useWarmedImageUris } from '../../hooks/useWarmedImageUris';
import { forgetWarmedUri } from '../../utils/imageFileCache';

const { width: SW, height: SH } = Dimensions.get('window');
const isRemoteUri = (u: string) => /^https?:/i.test(u);
// Google Maps images (street view) are fetched plainly, exactly as the thumbnail that opened the gallery fetched them:
// `force-cache` + progressive rendering never finished on iOS for them (an endless spinner / black screen).
const isGoogleMapsUri = (u: string) => /^https?:\/\/maps\.(googleapis|google)\.com\//i.test(u);
const THUMB = 52;
const THUMB_GAP = 8;

export interface GalleryImage {
  uri: string;
  label?: string;
}

interface ImageGalleryModalProps {
  visible: boolean;
  images: GalleryImage[];
  initialIndex?: number;
  onClose: () => void;
}

const ZoomablePage = React.memo(
  ({
    uri,
    fallbackUri,
    width,
    height,
    active,
    zoomed,
    onZoomChange,
    dragX,
    dragY,
    onRequestClose,
  }: {
    uri: string;
    /** The remote original, tried when a local copy fails to draw. */
    fallbackUri?: string;
    width: number;
    height: number;
    active: boolean;
    zoomed: boolean;
    onZoomChange: (z: boolean) => void;
    dragX: SharedValue<number>;
    dragY: SharedValue<number>;
    onRequestClose: () => void;
  }) => {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    // A file already on the device is shown at full opacity at once (never parked at 0 waiting for an event that may not
    // come); only a remote image fades in. A spinner is likewise only for bytes that are really still arriving.
    const opacity = useSharedValue(isRemoteUri(uri) ? 0 : 1);
    const [loading, setLoading] = useState(() => isRemoteUri(uri));
    // The source actually drawn: `uri`, or - if a local copy fails to decode - the remote original.
    const [src, setSrc] = useState(uri);
    const [broken, setBroken] = useState(false);

    useEffect(() => {
      setSrc(uri);
      setBroken(false);
      setLoading(isRemoteUri(uri));
      opacity.value = isRemoteUri(uri) ? 0 : 1;
    }, [uri]);

    useEffect(() => {
      if (!active) {
        scale.value = 1;
        savedScale.value = 1;
        tx.value = 0;
        ty.value = 0;
        savedTx.value = 0;
        savedTy.value = 0;
      }
    }, [active]);

    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.max(1, savedScale.value * e.scale);
      })
      .onEnd(() => {
        if (scale.value <= 1) {
          scale.value = withTiming(1);
          savedScale.value = 1;
          tx.value = withTiming(0);
          ty.value = withTiming(0);
          savedTx.value = 0;
          savedTy.value = 0;
          runOnJS(onZoomChange)(false);
        } else {
          savedScale.value = scale.value;
          runOnJS(onZoomChange)(true);
        }
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(250)
      .onEnd(() => {
        if (scale.value > 1) {
          scale.value = withTiming(1);
          savedScale.value = 1;
          tx.value = withTiming(0);
          ty.value = withTiming(0);
          savedTx.value = 0;
          savedTy.value = 0;
          runOnJS(onZoomChange)(false);
        } else {
          scale.value = withTiming(2.5);
          savedScale.value = 2.5;
          runOnJS(onZoomChange)(true);
        }
      });

    const pan = Gesture.Pan()
      .enabled(zoomed)
      .onUpdate((e) => {
        const maxX = (width * (scale.value - 1)) / 2;
        const maxY = (height * (scale.value - 1)) / 2;
        tx.value = Math.min(Math.max(savedTx.value + e.translationX, -maxX), maxX);
        ty.value = Math.min(Math.max(savedTy.value + e.translationY, -maxY), maxY);
      })
      .onEnd(() => {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      });

    const dismissPan = Gesture.Pan()
      .enabled(active && !zoomed)
      .activeOffsetY(14)
      .failOffsetX([-28, 28])
      .onUpdate((e) => {
        dragY.value = Math.max(0, e.translationY);
        dragX.value = e.translationX;
      })
      .onEnd((e) => {
        if (dragY.value > 120 || e.velocityY > 900) {
          runOnJS(onRequestClose)();
        } else {
          dragX.value = withTiming(0, { duration: 180 });
          dragY.value = withTiming(0, { duration: 180 });
        }
      });

    const composed = Gesture.Simultaneous(pan, pinch, doubleTap, dismissPan);

    const imgStyle = useAnimatedStyle(() => {
      const dismissScale = interpolate(dragY.value, [0, 400], [1, 0.82], Extrapolation.CLAMP);
      return {
        opacity: opacity.value,
        transform: [
          { translateX: tx.value + dragX.value },
          { translateY: ty.value + dragY.value },
          { scale: scale.value * dismissScale },
        ],
      };
    });

    return (
      <GestureDetector gesture={composed}>
        <Animated.View
          style={{ width, height, justifyContent: 'center', alignItems: 'center' }}
        >
          {broken ? (
            <View style={{ alignItems: 'center' }}>
              <Icon name="image-outline" size={48} color="#555" />
              <Text style={{ color: '#777', fontSize: 12, marginTop: 8 }}>Could not load this photo</Text>
            </View>
          ) : src ? (
            <>
              <Animated.Image
                source={isGoogleMapsUri(src) ? { uri: src } : { uri: src, cache: 'force-cache' }}
                style={[{ width, height }, imgStyle]}
                resizeMode="contain"
                progressiveRenderingEnabled={!isGoogleMapsUri(src)}
                fadeDuration={0}
                onLoadStart={() => {
                  if (isRemoteUri(src)) {
                    setLoading(true);
                    opacity.value = 0;
                  }
                }}
                onLoadEnd={() => {
                  setLoading(false);
                  opacity.value = isRemoteUri(src) ? withTiming(1, { duration: 180 }) : 1;
                }}
                onError={() => {
                  // A local copy that will not draw (corrupt / never an image): drop it and use the remote original.
                  if (!isRemoteUri(src) && fallbackUri && isRemoteUri(fallbackUri)) {
                    void forgetWarmedUri(fallbackUri);
                    setSrc(fallbackUri);
                    setLoading(true);
                    opacity.value = 0;
                    return;
                  }
                  setLoading(false);
                  setBroken(true);
                }}
              />
              {loading && (
                <View style={{ position: 'absolute' }}>
                  <ActivityIndicator size="large" color="#fff" />
                </View>
              )}
            </>
          ) : (
            <Icon name="image-outline" size={48} color="#555" />
          )}
        </Animated.View>
      </GestureDetector>
    );
  }
);

export const ImageGalleryModal = ({
  visible,
  images,
  initialIndex = 0,
  onClose,
}: ImageGalleryModalProps) => {
  const insets = useSafeAreaInsets();
  const warmed = useWarmedImageUris(visible ? images.map((i) => i.uri) : []);
  const srcOf = (uri: string) => warmed[uri] || uri;
  const pagerRef = useRef<FlatList>(null);
  const stripRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [mediaH, setMediaH] = useState(Math.max(1, SH - 220));

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [0, SH * 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [0, 100], [1, 0], Extrapolation.CLAMP),
  }));

  const topInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? 0 : 0,
    12
  );
  const bottomInset = Math.max(
    insets.bottom,
  );

  useEffect(() => {
    if (!visible) return;
    setIndex(initialIndex);
    setIsZoomed(false);
    dragX.value = 0;
    dragY.value = 0;
    if (images.length > 1) {
      setTimeout(
        () =>
          stripRef.current?.scrollToIndex({
            index: initialIndex,
            animated: false,
            viewPosition: 0.5,
          }),
        60
      );
    }
  }, [visible, initialIndex]);

  const hasMultiple = images.length > 1;

  const centerStrip = (i: number) => {
    if (!hasMultiple) return;
    stripRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.5 });
  };

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(images.length - 1, i));
    if (clamped === index) return;
    setIsZoomed(false);
    setIndex(clamped);
    pagerRef.current?.scrollToIndex({ index: clamped, animated: true });
    centerStrip(clamped);
  };

  const onMomentumEnd = (e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SW);
    if (i !== index) {
      setIsZoomed(false);
      setIndex(i);
      centerStrip(i);
    }
  };

  const ArrowBtn = ({ dir }: { dir: 'back' | 'forward' }) => (
    <TouchableOpacity
      onPress={() => goTo(index + (dir === 'forward' ? 1 : -1))}
      activeOpacity={0.7}
      style={{
        position: 'absolute',
        [dir === 'back' ? 'left' : 'right']: 10,
        top: Math.max(0, mediaH / 2 - 24),
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={`chevron-${dir}`} size={28} color="#fff" />
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Keep the status bar visible (translucent) so the real top safe-area
          inset is reported — hiding it collapses insets.top and the close
          button ends up overlapping the status bar. */}
      {visible && (
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      )}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingTop: topInset + 10, paddingBottom: bottomInset + 10 }}>
          {/* Black backdrop that fades out as the image is dragged down, revealing
              the chat behind (the Modal is transparent). Separate from the image so
              the image stays fully opaque while it follows the finger. */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}
          />
          {/* Header — takes real space at the top so the image sits below it.
              The outer container already pads the safe-area inset, so this adds a
              fixed margin below it and extra vertical height for breathing room
              around the close (✕) button and the image-count text. Fades with the
              drag so only the image remains while dismissing. */}
          <Animated.View
            style={[{
              paddingTop: 20,
              paddingBottom: 18,
              paddingHorizontal: 8,
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }, chromeStyle]}
          >
            <TouchableOpacity onPress={onClose} className="p-2">
              <Icon name="close" size={26} color="#fff" />
            </TouchableOpacity>
            {hasMultiple && (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                {index + 1} / {images.length}
              </Text>
            )}
            <View style={{ width: 42 }} />
          </Animated.View>

          {/* Middle band — the image fits exactly here, between header & strip */}
          <View
            style={{ flex: 1 }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && Math.abs(h - mediaH) > 1) setMediaH(h);
            }}
          >
            <FlatList
              ref={pagerRef}
              data={images}
              horizontal
              pagingEnabled
              scrollEnabled={!isZoomed}
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={initialIndex}
              getItemLayout={(_, i) => ({ length: SW, offset: SW * i, index: i })}
              onMomentumScrollEnd={onMomentumEnd}
              keyExtractor={(_, i) => `pg-${i}`}
              onScrollToIndexFailed={(info) => {
                setTimeout(
                  () =>
                    pagerRef.current?.scrollToIndex({
                      index: info.index,
                      animated: false,
                    }),
                  50
                );
              }}
              renderItem={({ item, index: i }) => (
                <ZoomablePage
                  uri={srcOf(item.uri)}
                  fallbackUri={item.uri}
                  width={SW}
                  height={mediaH}
                  active={i === index}
                  zoomed={isZoomed}
                  onZoomChange={setIsZoomed}
                  dragX={dragX}
                  dragY={dragY}
                  onRequestClose={onClose}
                />
              )}
            />

            {/* Left / right arrows — hidden while zoomed */}
            {hasMultiple && !isZoomed && index > 0 && <ArrowBtn dir="back" />}
            {hasMultiple && !isZoomed && index < images.length - 1 && (
              <ArrowBtn dir="forward" />
            )}
          </View>

          {/* Bottom: caption + thumbnail filmstrip — respects bottom inset. Fades
              with the drag so only the image remains while dismissing. */}
          <Animated.View
            style={[{
              paddingBottom: Math.max(insets.bottom, 12),
              paddingTop: 10,
            }, chromeStyle]}
          >
            {!!images[index]?.label && (
              <Text
                numberOfLines={1}
                style={{
                  color: '#fff',
                  fontWeight: '800',
                  fontSize: 14,
                  textAlign: 'center',
                  marginBottom: 10,
                  paddingHorizontal: 16,
                }}
              >
                {images[index].label}
              </Text>
            )}
            {hasMultiple && (
              <FlatList
                ref={stripRef}
                data={images}
                horizontal
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={initialIndex}
                getItemLayout={(_, i) => ({
                  length: THUMB + THUMB_GAP,
                  offset: (THUMB + THUMB_GAP) * i,
                  index: i,
                })}
                onScrollToIndexFailed={() => { }}
                keyExtractor={(_, i) => `th-${i}`}
                contentContainerStyle={{ paddingHorizontal: 12 }}
                renderItem={({ item, index: i }) => {
                  const activeThumb = i === index;
                  return (
                    <TouchableOpacity
                      onPress={() => goTo(i)}
                      activeOpacity={0.8}
                      style={{ marginRight: THUMB_GAP }}
                    >
                      <View
                        style={{
                          width: THUMB,
                          height: THUMB,
                          borderRadius: 8,
                          overflow: 'hidden',
                          borderWidth: 2,
                          borderColor: activeThumb ? '#fff' : 'transparent',
                          opacity: activeThumb ? 1 : 0.5,
                          backgroundColor: '#1a1a1a',
                        }}
                      >
                        {item.uri ? (
                          <Animated.Image
                            source={{ uri: srcOf(item.uri), cache: 'force-cache' }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={{ flex: 1, backgroundColor: '#222' }} />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};
