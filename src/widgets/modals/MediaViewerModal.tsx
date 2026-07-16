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

// ─── Pinch/double-tap/pan-zoomable image ────────────────────────────────────
// Same zoom behaviour as ImageGalleryModal's ZoomablePage, but standalone (no
// pager to coordinate with, since the media viewer shows a single item).
const ZoomableImage = React.memo(
  ({
    uri,
    width,
    height,
    onLoadStart,
    onLoadEnd,
    onError,
  }: {
    uri: string;
    width: number;
    height: number;
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
        } else {
          savedScale.value = scale.value;
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
        } else {
          scale.value = withTiming(2.5);
          savedScale.value = 2.5;
        }
      });

    const pan = Gesture.Pan()
      .onUpdate((e) => {
        // Only pans once zoomed in; keep the image within its own bounds.
        if (scale.value <= 1) return;
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

interface MediaViewerModalProps {
  isVisible: boolean;
  onClose: () => void;
  mediaUri: string;
  mediaType: 'image' | 'video';
  fileName?: string;
}

// Single-media viewer (one image or video from a chat bubble). Shares the
// ImageGalleryModal look — black flex-column layout, a header whose close button
// clears the status bar, and the media laid out between the header and the
// bottom safe area — but with NO left/right arrows and NO thumbnail filmstrip
// (there is only one item). Images are pinch/double-tap/pan zoomable.
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

  // A Modal can report insets.top === 0 on Android even though the status bar is
  // physically there — floor so the close button never lands in the status bar.
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 0 : 0, 12);
  const bottomInset = Math.max(insets.bottom);

  useEffect(() => {
    if (isVisible) {
      setImageLoading(true);
    }
  }, [isVisible, mediaUri]);

  // ─── Permissions ────────────────────────────────────────────────────────────
  const hasAndroidPermission = async () => {
    const version = Number(Platform.Version);
    if (version >= 33) {
      const [hasImage, hasVideo] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO),
      ]);
      return hasImage && hasVideo;
    }
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

    if (Platform.OS === 'android' && !(await hasAndroidPermission())) {
      const version = Number(Platform.Version);
      if (version >= 33) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ]);
      } else {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
      }
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
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: topInset + 10, paddingBottom: bottomInset + 10 }}>
          {/* Header — takes real space so the media sits below it */}
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
          </View>

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
              <View style={{ flex: 1 }}>
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
              </View>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};
