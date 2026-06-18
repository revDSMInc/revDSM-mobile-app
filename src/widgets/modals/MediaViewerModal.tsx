import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Image,
  Modal,
  TouchableOpacity,
  Text,
  Dimensions,
  Alert,
  Platform,
  ActivityIndicator,
  PermissionsAndroid,
  StatusBar,
  Animated,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../theme/ThemeProvider';
import SafeBottomSpacer from '../../widgets/common/SafeBottomSpacer';

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

interface MediaViewerModalProps {
  isVisible: boolean;
  onClose: () => void;
  mediaUri: string;
  mediaType: 'image' | 'video';
  fileName?: string;
}

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

  // ─── Animation & Swipe ──────────────────────────────────────────────────────
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = translateY.interpolate({
    inputRange: [-200, 0, 200],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        translateY.setValue(gestureState.dy);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dy) > 100) {
          Animated.timing(translateY, {
            toValue: gestureState.dy > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT,
            duration: 200,
            useNativeDriver: true,
          }).start(onClose);
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (isVisible) {
      translateY.setValue(0);
      setImageLoading(true);
    }
  }, [isVisible, translateY, mediaUri]);

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
      const res = await ReactNativeBlobUtil.config({ path }).fetch('GET', mediaUri);
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
      <StatusBar hidden={isVisible} backgroundColor="#fff" />
      <Animated.View
        className="flex-1 top-10 bg-black"
        style={{ opacity, transform: [{ translateY }] }}
        {...panResponder.panHandlers}
      >
        <View
          className="absolute top-0 w-full z-50 flex-row justify-between items-center px-4 py-2"
          style={{ paddingTop: Math.max(insets.top, 10), backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <TouchableOpacity onPress={onClose} className="p-2">
            <Icon name="close" size={28} color="#fff" />
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

        <View
          style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
          className="justify-center items-center"
        >
          {mediaType === 'image' ? (
            <View className="justify-center items-center relative w-full h-full">
              <Image
                source={{ uri: mediaUri }}
                style={{ width: SCREEN_WIDTH, height: '100%' }}
                resizeMode="contain"
                onLoadStart={() => setImageLoading(true)}
                onLoadEnd={() => setImageLoading(false)}
              />
              {imageLoading && (
                <ActivityIndicator
                  size="large"
                  color="#ffffff"
                  className="absolute"
                  style={{ position: 'absolute' }}
                />
              )}
            </View>
          ) : (
            <View style={{ width: SCREEN_WIDTH, height: '100%' }}>
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
        <SafeBottomSpacer />
      </Animated.View>
    </Modal>
  );
};
