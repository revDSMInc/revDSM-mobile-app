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
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Ionicons';

const { width: SW, height: SH } = Dimensions.get('window');
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

// ─── One pinch/double-tap/pan-zoomable page ────────────────────────────────
// Pinch or double-tap to zoom; pan (only while zoomed) to move around. Pan is
// disabled at 1× so the parent pager keeps handling horizontal swipes.
const ZoomablePage = React.memo(
  ({
    uri,
    width,
    height,
    active,
    zoomed,
    onZoomChange,
  }: {
    uri: string;
    width: number;
    height: number;
    active: boolean;
    zoomed: boolean;
    onZoomChange: (z: boolean) => void;
  }) => {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    // Fades the image in once it decodes (smooth arrival), and drives the loader.
    const opacity = useSharedValue(0);
    const [loading, setLoading] = useState(true);

    // When this page scrolls off-screen, snap it back to 1× so it isn't still
    // zoomed the next time it becomes active.
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
        // Keep the image within its own bounds so it can't be flung off-screen.
        const maxX = (width * (scale.value - 1)) / 2;
        const maxY = (height * (scale.value - 1)) / 2;
        tx.value = Math.min(Math.max(savedTx.value + e.translationX, -maxX), maxX);
        ty.value = Math.min(Math.max(savedTy.value + e.translationY, -maxY), maxY);
      })
      .onEnd(() => {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      });

    const composed = Gesture.Simultaneous(pan, pinch, doubleTap);

    const imgStyle = useAnimatedStyle(() => ({
      opacity: opacity.value,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scale: scale.value },
      ],
    }));

    return (
      <GestureDetector gesture={composed}>
        <Animated.View
          style={{ width, height, justifyContent: 'center', alignItems: 'center' }}
        >
          {uri ? (
            <>
              <Animated.Image
                source={{ uri, cache: 'force-cache' }}
                style={[{ width, height }, imgStyle]}
                resizeMode="contain"
                progressiveRenderingEnabled
                fadeDuration={0}
                onLoadStart={() => {
                  setLoading(true);
                  opacity.value = 0;
                }}
                onLoadEnd={() => {
                  setLoading(false);
                  opacity.value = withTiming(1, { duration: 180 });
                }}
                onError={() => {
                  setLoading(false);
                  opacity.value = withTiming(1);
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

// Full-screen photo viewer for a chat album: swipe or use the ◀ ▶ arrows / the
// bottom thumbnail filmstrip to move between images (WhatsApp-style), pinch or
// double-tap to zoom. The image is laid out between the header and the
// filmstrip so it never slips under either, and top/bottom safe-area insets are
// respected.
export const ImageGalleryModal = ({
  visible,
  images,
  initialIndex = 0,
  onClose,
}: ImageGalleryModalProps) => {
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<FlatList>(null);
  const stripRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  // Height of the middle band (between header and filmstrip). The image is
  // sized to exactly this so it never overlaps the chrome. Seeded with an
  // estimate to avoid a blank first frame, then corrected on layout.
  const [mediaH, setMediaH] = useState(Math.max(1, SH - 220));

  // A Modal can report insets.top === 0 on Android even though the status bar
  // is physically there — floor with StatusBar.currentHeight so the close
  // button can never land inside the status bar.
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
    if (images.length > 1) {
      // Center the active thumbnail once the strip has laid out.
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
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: topInset + 10, paddingBottom: bottomInset + 10 }}>
          {/* Header — takes real space at the top so the image sits below it */}
          <View
            style={{
              paddingTop: topInset,
              paddingBottom: 10,
              paddingHorizontal: 8,
              backgroundColor: '#000',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
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
          </View>

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
                  uri={item.uri}
                  width={SW}
                  height={mediaH}
                  active={i === index}
                  zoomed={isZoomed}
                  onZoomChange={setIsZoomed}
                />
              )}
            />

            {/* Left / right arrows — hidden while zoomed */}
            {hasMultiple && !isZoomed && index > 0 && <ArrowBtn dir="back" />}
            {hasMultiple && !isZoomed && index < images.length - 1 && (
              <ArrowBtn dir="forward" />
            )}
          </View>

          {/* Bottom: caption + thumbnail filmstrip — respects bottom inset */}
          <View
            style={{
              paddingBottom: Math.max(insets.bottom, 12),
              paddingTop: 10,
              backgroundColor: '#000',
            }}
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
                            source={{ uri: item.uri, cache: 'force-cache' }}
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
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};
