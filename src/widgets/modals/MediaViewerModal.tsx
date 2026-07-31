import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  Text,
  Dimensions,
  Alert,
  Platform,
  ActivityIndicator,
  PermissionsAndroid,
  StatusBar,
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
import { useTheme } from '../../theme/ThemeProvider';

const getNativeModules = () => {
  try {
    const cameraRollModule = require('@react-native-camera-roll/camera-roll');
    return {
      Video: require('react-native-video').default,
      ReactNativeBlobUtil: require('react-native-blob-util').default,
      CameraRoll: cameraRollModule.CameraRoll,
      iosReadGalleryPermission: cameraRollModule.iosReadGalleryPermission,
      iosRequestAddOnlyGalleryPermission: cameraRollModule.iosRequestAddOnlyGalleryPermission,
    };
  } catch {
    return {
      Video: null,
      ReactNativeBlobUtil: null,
      CameraRoll: null,
      iosReadGalleryPermission: null,
      iosRequestAddOnlyGalleryPermission: null,
    };
  }
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Drag-down-to-dismiss tuning (shared by image + video), mirroring
// ImageGalleryModal so both viewers feel identical.
const DISMISS_DISTANCE = 120; // px dragged before release dismisses
const DISMISS_VELOCITY = 900; // or a fast enough downward fling

// ─── Pinch/double-tap/pan-zoomable image (+ drag-down-to-dismiss) ────────────
// Same zoom behaviour as ImageGalleryModal's ZoomablePage. Pinch or double-tap
// to zoom; pan (only while zoomed) to move around; while NOT zoomed, a downward
// drag follows the finger and dismisses past a threshold (iMessage-style).
const ZoomableImage = React.memo(
  ({
    uri,
    width,
    height,
    dragX,
    dragY,
    onRequestClose,
    onLoadStart,
    onLoadEnd,
    onError,
  }: {
    uri: string;
    width: number;
    height: number;
    // Shared drag offsets owned by the parent so the backdrop + chrome fade off
    // the same value the image follows.
    dragX: SharedValue<number>;
    dragY: SharedValue<number>;
    onRequestClose: () => void;
    onLoadStart?: () => void;
    onLoadEnd?: () => void;
    onError?: () => void;
  }) => {
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const savedTx = useSharedValue(0);
    const savedTy = useSharedValue(0);
    // Fades the image in once it decodes, for a smooth arrival.
    const opacity = useSharedValue(0);
    // Drives which of pan (zoomed) vs dismiss-pan (not zoomed) is live.
    const [zoomed, setZoomed] = useState(false);

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
          runOnJS(setZoomed)(false);
        } else {
          savedScale.value = scale.value;
          runOnJS(setZoomed)(true);
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
          runOnJS(setZoomed)(false);
        } else {
          scale.value = withTiming(2.5);
          savedScale.value = 2.5;
          runOnJS(setZoomed)(true);
        }
      });

    // Pan the zoomed image within its own bounds; disabled at 1× so the
    // dismiss-drag below takes over.
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

    // iMessage-style drag-DOWN-to-dismiss (only while NOT zoomed). Activates on a
    // downward drag and fails on horizontal movement.
    const dismissPan = Gesture.Pan()
      .enabled(!zoomed)
      .activeOffsetY(14)
      .failOffsetX([-28, 28])
      .onUpdate((e) => {
        dragY.value = Math.max(0, e.translationY);
        dragX.value = e.translationX;
      })
      .onEnd((e) => {
        if (dragY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
          runOnJS(onRequestClose)();
        } else {
          dragX.value = withTiming(0, { duration: 180 });
          dragY.value = withTiming(0, { duration: 180 });
        }
      });

    const composed = Gesture.Simultaneous(pan, pinch, doubleTap, dismissPan);

    const imgStyle = useAnimatedStyle(() => {
      // Shrink toward the finger as it drags down (matches iMessage's peel-away).
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
          <Animated.Image
            source={{ uri, cache: 'force-cache' }}
            style={[{ width, height }, imgStyle]}
            resizeMode="contain"
            progressiveRenderingEnabled
            fadeDuration={0}
            onLoadStart={() => {
              opacity.value = 0;
              onLoadStart?.();
            }}
            onLoadEnd={() => {
              opacity.value = withTiming(1, { duration: 180 });
              onLoadEnd?.();
            }}
            onError={() => {
              opacity.value = withTiming(1);
              onError?.();
            }}
          />
        </Animated.View>
      </GestureDetector>
    );
  }
);

// ─── Drag-down-to-dismiss wrapper for the video ──────────────────────────────
// The video has no zoom (nothing to zoom into), so it only needs the iMessage
// swipe. `activeOffsetY(14)` + `failOffsetX` keeps the native player controls
// (tap play/pause, horizontal scrub) working — only a clear downward drag
// dismisses. The video follows the finger and shrinks slightly.
const DismissibleVideo = ({
  dragX,
  dragY,
  onRequestClose,
  children,
}: {
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  onRequestClose: () => void;
  children: React.ReactNode;
}) => {
  const dismissPan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-28, 28])
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      if (dragY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        runOnJS(onRequestClose)();
      } else {
        dragX.value = withTiming(0, { duration: 180 });
        dragY.value = withTiming(0, { duration: 180 });
      }
    });

  const style = useAnimatedStyle(() => {
    const dismissScale = interpolate(dragY.value, [0, 400], [1, 0.9], Extrapolation.CLAMP);
    return {
      flex: 1,
      transform: [
        { translateX: dragX.value },
        { translateY: dragY.value },
        { scale: dismissScale },
      ],
    };
  });

  return (
    <GestureDetector gesture={dismissPan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
};

interface MediaViewerModalProps {
  isVisible: boolean;
  onClose: () => void;
  mediaUri: string;
  mediaType: 'image' | 'video';
  fileName?: string;
}

// Single-media viewer (one image or video from a chat bubble). Shares the
// ImageGalleryModal look and gestures — pinch/double-tap/pan zoom on images and
// an iMessage-style drag-DOWN-to-dismiss on both images and videos: the black
// backdrop fades to reveal the chat behind, the header chrome fades quickly, and
// the media follows the finger, dismissing past a threshold or springing back.
export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
  isVisible,
  onClose,
  mediaUri,
  mediaType,
  fileName: _fileName,
}) => {
  useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [paused] = useState(false);
  const videoRef = useRef<any>(null);
  // Height of the middle band (between header and bottom inset). The image is
  // sized to exactly this so it never overlaps the chrome.
  const [mediaH, setMediaH] = useState(Math.max(1, SCREEN_HEIGHT - 220));

  // Drag-to-dismiss offsets, shared with the zoomable image / video wrapper. The
  // black backdrop fades over a long drag; the header chrome fades quickly so
  // only the media (following the finger) is left, like iMessage.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [0, SCREEN_HEIGHT * 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.value, [0, 100], [1, 0], Extrapolation.CLAMP),
  }));

  // A Modal can report insets.top === 0 on Android even though the status bar is
  // physically there — floor so the close button never lands in the status bar.
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 0 : 0, 12);
  const bottomInset = Math.max(insets.bottom);

  useEffect(() => {
    if (isVisible) {
      setImageLoading(true);
      // Reset any leftover drag from a previous dismiss so it opens fully-shown.
      dragX.value = 0;
      dragY.value = 0;
    }
    // dragX/dragY are stable useSharedValue refs — not real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, mediaUri]);

  // ─── Permissions ────────────────────────────────────────────────────────────
  const hasAndroidPermission = async () => {
    const version = Number(Platform.Version);
    // Android 13+ (API 33+) saves to the gallery via MediaStore with no storage permission.
    if (version >= 33) return true;
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  };

  const saveToGallery = async () => {
    const {
      ReactNativeBlobUtil,
      CameraRoll,
      iosReadGalleryPermission,
      iosRequestAddOnlyGalleryPermission,
    } = getNativeModules();
    if (!ReactNativeBlobUtil || !CameraRoll) return;

    // Only legacy Android (<=32) needs a runtime storage request; hasAndroidPermission()
    // already returns true on 33+ so this block only runs for older devices.
    if (Platform.OS === 'android' && !(await hasAndroidPermission())) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
    }

    if (Platform.OS === 'ios') {
      if (iosReadGalleryPermission && iosRequestAddOnlyGalleryPermission) {
        try {
          const status = await iosReadGalleryPermission('addOnly');
          if (status !== 'granted' && status !== 'limited') {
            const requestStatus = await iosRequestAddOnlyGalleryPermission();
            if (requestStatus !== 'granted' && requestStatus !== 'limited') {
              Alert.alert('Permission Denied', 'Photo Library permission is required to save photos.');
              return;
            }
          }
        } catch (error) {
          console.error('Failed to check/request iOS photo library permission:', error);
        }
      }
    }

    const saveToCameraRollWithRetry = async (tag: string, type: 'photo' | 'video', retries = 2, delayMs = 1000) => {
      for (let i = 0; i <= retries; i++) {
        try {
          await CameraRoll.saveAsset(tag, { type });
          return true;
        } catch (err) {
          if (i === retries) throw err;
          console.log(`Save attempt ${i + 1} failed, retrying in ${delayMs}ms...`, err);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
      return false;
    };

    setLoading(true);
    try {
      const ext = mediaType === 'image' ? 'jpg' : 'mp4';
      const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/save_${Date.now()}.${ext}`;
      const res = await ReactNativeBlobUtil.config({ path }).fetch('GET', mediaUri, {
        'Accept-Encoding': 'identity',
      });
      const rawPath = res.path();
      const saveTag = rawPath.startsWith('file://') ? rawPath : `file://${rawPath}`;
      await saveToCameraRollWithRetry(saveTag, mediaType === 'image' ? 'photo' : 'video');
      Alert.alert('Success', 'Saved to gallery!');
    } catch (err) {
      console.error('Save failed:', err);
      Alert.alert('Error', 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const { Video } = getNativeModules();

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Keep the status bar translucent (not hidden) so the real top inset is
          reported and the close button never overlaps it. */}
      {isVisible && (
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      )}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingTop: topInset + 10, paddingBottom: bottomInset + 10 }}>
          {/* Black backdrop that fades out as the media is dragged down, revealing
              the chat behind (the Modal is transparent). Separate from the media so
              the media stays fully opaque while it follows the finger. */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}
          />

          {/* Header — fades with the drag so only the media remains while dismissing. */}
          <Animated.View
            style={[{
              paddingTop: 10,
              paddingBottom: 10,
              paddingHorizontal: 8,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }, chromeStyle]}
          >
            <TouchableOpacity onPress={onClose} className="p-2">
              <Icon name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={saveToGallery}
              className="flex-row items-center bg-white/20 px-3 py-1.5 rounded-full"
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="download-outline" size={20} color="#fff" />
              )}
              <Text className="text-white text-[10px] ml-1.5 font-bold">SAVE</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Middle band — the media fits exactly here, between header & bottom */}
          <View
            style={{ flex: 1 }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && Math.abs(h - mediaH) > 1) setMediaH(h);
            }}
          >
            {mediaType === 'image' ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                {mediaUri ? (
                  <ZoomableImage
                    key={mediaUri}
                    uri={mediaUri}
                    width={SCREEN_WIDTH}
                    height={mediaH}
                    dragX={dragX}
                    dragY={dragY}
                    onRequestClose={onClose}
                    onLoadStart={() => setImageLoading(true)}
                    onLoadEnd={() => setImageLoading(false)}
                    onError={() => setImageLoading(false)}
                  />
                ) : (
                  <Icon name="image-outline" size={48} color="#555" />
                )}
                {imageLoading && (
                  <ActivityIndicator size="large" color="#fff" style={{ position: 'absolute' }} />
                )}
              </View>
            ) : (
              <DismissibleVideo dragX={dragX} dragY={dragY} onRequestClose={onClose}>
                {Video ? (
                  <Video
                    ref={videoRef}
                    source={{ uri: mediaUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                    paused={paused}
                    controls
                    repeat
                  />
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-white opacity-40">Video Unavailable</Text>
                  </View>
                )}
              </DismissibleVideo>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};
