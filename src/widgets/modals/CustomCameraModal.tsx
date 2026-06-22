import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Animated,
  SafeAreaView,
  Image,
  Dimensions,
  Platform,
} from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Reanimated, { useSharedValue, useAnimatedProps, runOnJS, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets, SafeAreaView as SafeAreaViewContext } from 'react-native-safe-area-context';

const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);

interface CustomCameraModalProps {
  visible: boolean;
  onClose: () => void;
  onCapture: (asset: {
    uri: string;
    fileName: string;
    type: string;
    width: number;
    height: number;
  }) => void;
}

export const CustomCameraModal = ({
  visible,
  onClose,
  onCapture,
}: CustomCameraModalProps) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedAsset, setCapturedAsset] = useState<{
    uri: string;
    fileName: string;
    type: string;
    width: number;
    height: number;
  } | null>(null);

  const insets = useSafeAreaInsets();

  const device = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'] });
  const format = useCameraFormat(device, [
    { photoAspectRatio: 4 / 3 },
    { videoAspectRatio: 4 / 3 },
    { photoResolution: 'max' },
    { videoResolution: 'max' }
  ]);
  const cameraRef = useRef<Camera>(null);
  const countdownScale = useRef(new Animated.Value(1)).current;
  const timerIntervalRef = useRef<any>(null);

  const minZoom = device?.minZoom ?? 1;
  const maxZoom = device?.maxZoom ?? 8;
  const neutralZoom = device?.neutralZoom ?? minZoom;
  const isUltrawideSupported = neutralZoom > minZoom;

  const zoom = useSharedValue(neutralZoom);
  const startZoom = useSharedValue(neutralZoom);
  const [activeZoomLevel, setActiveZoomLevel] = useState(neutralZoom);

  useEffect(() => {
    if (device) {
      const defaultZoom = device.neutralZoom ?? device.minZoom ?? 1;
      zoom.value = defaultZoom;
      startZoom.value = defaultZoom;
      setActiveZoomLevel(defaultZoom);
    }
  }, [device?.id]); // reset when device changes

  const updateActiveZoomLevel = (val: number) => {
    setActiveZoomLevel(val);
  };

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      startZoom.value = zoom.value;
    })
    .onUpdate((e) => {
      let newZoom = startZoom.value * e.scale;
      newZoom = Math.max(Math.min(newZoom, maxZoom), minZoom);
      zoom.value = newZoom;
    })
    .onEnd(() => {
      runOnJS(updateActiveZoomLevel)(zoom.value);
    });

  const animatedProps = useAnimatedProps(() => ({
    zoom: zoom.value,
  }), [zoom]);

  // Request permissions
  useEffect(() => {
    if (visible) {
      (async () => {
        const cameraPermission = await Camera.getCameraPermissionStatus();
        if (cameraPermission === 'granted') {
          setHasPermission(true);
        } else {
          const request = await Camera.requestCameraPermission();
          setHasPermission(request === 'granted');
        }
      })();
    }
  }, [visible]);

  // Reset states and clear interval when visibility changes
  useEffect(() => {
    if (!visible) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setCapturedAsset(null);
      setIsCapturing(false);
      setCountdown(null);
      zoom.value = neutralZoom;
      startZoom.value = neutralZoom;
      setActiveZoomLevel(neutralZoom);
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [visible]);

  // Handle countdown animation
  useEffect(() => {
    if (countdown !== null) {
      countdownScale.setValue(0);
      Animated.spring(countdownScale, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 12,
      }).start();
    }
  }, [countdown]);

  const cycleTimer = () => {
    if (isCapturing || capturedAsset) return;
    setTimer((prev) => {
      if (prev === 0) return 3;
      if (prev === 3) return 10;
      return 0;
    });
  };

  const cycleFlash = () => {
    if (isCapturing || capturedAsset) return;
    setFlash((prev) => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
  };

  const handleCapture = async () => {
    if (isCapturing || capturedAsset || !cameraRef.current || !device) return;

    if (timer > 0) {
      setIsCapturing(true);
      setCountdown(timer);

      let currentVal = timer;
      timerIntervalRef.current = setInterval(() => {
        currentVal -= 1;
        if (currentVal <= 0) {
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
          }
          setCountdown(null);
          takePhoto();
        } else {
          setCountdown(currentVal);
        }
      }, 1000);
    } else {
      takePhoto();
    }
  };

  const takePhoto = async () => {
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current!.takePhoto({
        flash: flash === 'auto' ? 'auto' : flash === 'on' ? 'on' : 'off',
      });

      const fileName = photo.path.split('/').pop() || `photo_${Date.now()}.jpg`;
      const asset = {
        uri: `file://${photo.path}`,
        fileName,
        type: 'image/jpeg',
        width: photo.width,
        height: photo.height,
      };

      setCapturedAsset(asset);
    } catch (error) {
      console.log('Failed to capture photo, falling back to mock asset (normal on Simulator):', error);

      const mockAsset = {
        uri: 'https://picsum.photos/800/600',
        fileName: `mock_photo_${Date.now()}.jpg`,
        type: 'image/jpeg',
        width: 800,
        height: 600,
      };

      setCapturedAsset(mockAsset);
    } finally {
      setIsCapturing(false);
      setCountdown(null);
    }
  };

  const handleUsePhoto = () => {
    if (capturedAsset) {
      onCapture(capturedAsset);
      setCapturedAsset(null);
    }
  };

  const handleRetake = () => {
    setCapturedAsset(null);
  };

  if (!visible) return null;

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const viewfinderHeight = screenWidth * (4 / 3);
  const viewfinderTop = insets.top + 20 + (Platform.OS === 'android' ? insets.top + 20 : 0);

  const SafeAreaComponent = Platform.OS === 'android' ? SafeAreaViewContext : SafeAreaView;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, backgroundColor: 'black' }]}>
      {/* 4:3 Viewfinder centered container */}
      {hasPermission === true && device && !capturedAsset && (
        <View style={{
          position: 'absolute',
          top: viewfinderTop,
          left: 0,
          width: screenWidth,
          height: viewfinderHeight,
          overflow: 'hidden',
          backgroundColor: 'black',
        }}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <GestureDetector gesture={pinchGesture}>
              <View style={StyleSheet.absoluteFill}>
                <ReanimatedCamera
                  ref={cameraRef as any}
                  style={StyleSheet.absoluteFill}
                  device={device}
                  format={format}
                  isActive={visible && !capturedAsset}
                  photo={true}
                  animatedProps={animatedProps}
                  resizeMode="cover"
                  outputOrientation="preview"
                />
              </View>
            </GestureDetector>
          </GestureHandlerRootView>

          {/* COUNTDOWN OVERLAY */}
          {countdown !== null && (
            <View style={styles.countdownContainer}>
              <Animated.Text
                style={[
                  styles.countdownText,
                  { transform: [{ scale: countdownScale }] },
                ]}
              >
                {countdown}
              </Animated.Text>
            </View>
          )}
        </View>
      )}

      <SafeAreaComponent style={{ flex: 1 }} pointerEvents="box-none">
        {hasPermission === false && (
          <View style={styles.center}>
            <Text style={styles.errorText}>Camera permission is required.</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {hasPermission === true && device && (
          <View style={{ flex: 1 }} pointerEvents="box-none">
            {/* PHOTO PREVIEW STATE */}
            {capturedAsset ? (
              <View style={styles.previewContainer}>
                <View style={{
                  position: 'absolute',
                  top: viewfinderTop,
                  left: 0,
                  width: screenWidth,
                  height: viewfinderHeight,
                  overflow: 'hidden',
                  backgroundColor: 'black',
                }}>
                  <Image
                    source={{ uri: capturedAsset.uri }}
                    style={StyleSheet.absoluteFillObject}
                    resizeMode="cover"
                  />
                </View>

                {/* Translucent overlay matching native iOS preview */}
                <View style={[styles.previewBottomBar, { position: 'absolute', top: viewfinderTop + viewfinderHeight, bottom: 0, left: 0, right: 0, backgroundColor: 'black', justifyContent: 'space-between', alignItems: 'center', paddingTop: 24, paddingBottom: 40 }]}>
                  <TouchableOpacity onPress={handleRetake} style={styles.previewButton}>
                    <Text style={styles.previewButtonText}>Retake</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={handleUsePhoto} style={styles.previewButton}>
                    <Text style={[styles.previewButtonText, styles.usePhotoText]}>Use Photo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* ACTIVE CAMERA STATE */
              <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
                {/* TOP BAR CONTROLS (iOS Style) */}
                <View style={[
                  styles.iosTopBar,
                  {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: viewfinderTop,
                    paddingTop: Platform.OS === 'android' ? insets.top : 0,
                    backgroundColor: 'black',
                    zIndex: 10
                  }
                ]}>
                  <TouchableOpacity onPress={onClose} style={styles.iosIconButton} disabled={isCapturing}>
                    <Icon name="close" size={28} color="white" />
                  </TouchableOpacity>

                  {/* Flash Toggle */}
                  <TouchableOpacity onPress={cycleFlash} style={styles.iosIconButton} disabled={isCapturing}>
                    <Icon
                      name={
                        flash === 'on'
                          ? 'flash'
                          : flash === 'auto'
                            ? 'flash-auto'
                            : 'flash-off'
                      }
                      size={24}
                      color={flash === 'off' ? 'white' : '#FFD607'}
                    />
                  </TouchableOpacity>

                  {/* Timer Toggle */}
                  <TouchableOpacity onPress={cycleTimer} style={styles.iosIconButton} disabled={isCapturing}>
                    <Icon
                      name={timer > 0 ? 'timer-outline' : 'timer-off-outline'}
                      size={24}
                      color={timer > 0 ? '#FFE082' : 'white'}
                    />
                    {timer > 0 && (
                      <Text style={{ color: '#FFE082', fontSize: 12, fontWeight: 'bold', marginLeft: 4 }}>
                        {timer}s
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* BOTTOM CONTROL SECTION (iOS Style) */}
                <View style={[styles.iosBottomSection, { position: 'absolute', top: viewfinderTop + viewfinderHeight, bottom: 0, left: 0, right: 0, backgroundColor: 'black', zIndex: 10, paddingVertical: 12 }]}>
                  {/* ZOOM PILLS BAR (above shutter) */}
                  <View style={styles.iosZoomContainer}>
                    {(isUltrawideSupported || Platform.OS === 'android') && (
                      <TouchableOpacity
                        onPress={() => { zoom.value = withSpring(minZoom); setActiveZoomLevel(minZoom); }}
                        style={[styles.iosZoomButton, activeZoomLevel < neutralZoom && styles.iosZoomButtonActive]}
                      >
                        <Text style={[styles.iosZoomText, activeZoomLevel < neutralZoom && styles.iosZoomTextActive]}>0.5x</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => { zoom.value = withSpring(neutralZoom); setActiveZoomLevel(neutralZoom); }}
                      style={[styles.iosZoomButton, activeZoomLevel >= neutralZoom && activeZoomLevel < neutralZoom * 2 && styles.iosZoomButtonActive]}
                    >
                      <Text style={[styles.iosZoomText, activeZoomLevel >= neutralZoom && activeZoomLevel < neutralZoom * 2 && styles.iosZoomTextActive]}>1x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { zoom.value = withSpring(neutralZoom * 2); setActiveZoomLevel(neutralZoom * 2); }}
                      style={[styles.iosZoomButton, activeZoomLevel >= neutralZoom * 2 && activeZoomLevel < neutralZoom * 3 && styles.iosZoomButtonActive]}
                    >
                      <Text style={[styles.iosZoomText, activeZoomLevel >= neutralZoom * 2 && activeZoomLevel < neutralZoom * 3 && styles.iosZoomTextActive]}>2x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { zoom.value = withSpring(neutralZoom * 3); setActiveZoomLevel(neutralZoom * 3); }}
                      style={[styles.iosZoomButton, activeZoomLevel >= neutralZoom * 3 && styles.iosZoomButtonActive]}
                    >
                      <Text style={[styles.iosZoomText, activeZoomLevel >= neutralZoom * 3 && styles.iosZoomTextActive]}>3x</Text>
                    </TouchableOpacity>
                  </View>

                  {/* SHUTTER & OTHER ACTIONS */}
                  <View style={styles.iosShutterRow}>
                    {/* Left side: Empty placeholder for centering */}
                    <View style={{ width: 44 }} />

                    {/* Center: iOS Shutter Button */}
                    <View style={styles.iosShutterOuterWrapper}>
                      {isCapturing && countdown === null ? (
                        <ActivityIndicator size="large" color="#FFD607" />
                      ) : (
                        <TouchableOpacity
                          onPress={handleCapture}
                          style={styles.iosShutterOuterRing}
                          disabled={isCapturing}
                        >
                          <View style={styles.iosShutterInnerCircle} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Right side: Empty placeholder for centering */}
                    <View style={{ width: 44 }} />
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {hasPermission === true && !device && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#FFD607" />
            <Text style={styles.loadingText}>Initializing camera...</Text>
          </View>
        )}
      </SafeAreaComponent>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 20,
  },
  loadingText: {
    color: 'white',
    fontSize: 16,
    marginTop: 15,
  },
  closeBtn: {
    backgroundColor: '#FFD607',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  closeText: {
    color: 'black',
    fontWeight: 'bold',
  },
  iosCameraContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  iosTopBar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  iosIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  countdownContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 9,
  },
  countdownText: {
    color: '#FFD607',
    fontSize: 120,
    fontWeight: '900',
  },
  iosBottomSection: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingBottom: 20,
    justifyContent: 'center',
  },
  iosZoomContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  iosZoomButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  iosZoomButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  iosZoomText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  iosZoomTextActive: {
    color: '#FFD607',
  },
  iosShutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    marginTop: 5,
  },
  iosSideButtonPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosShutterOuterWrapper: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosShutterOuterRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosShutterInnerCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'white',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  previewImageWrapper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'black',
  },
  previewBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingTop: 20,
    paddingBottom: 40,
  },
  previewButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  previewButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '500',
  },
  usePhotoText: {
    color: '#FFD607',
    fontWeight: 'bold',
  },
});

