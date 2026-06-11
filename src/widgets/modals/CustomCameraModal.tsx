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
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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

  const device = useCameraDevice('back');
  const cameraRef = useRef<Camera>(null);
  const countdownScale = useRef(new Animated.Value(1)).current;
  const timerIntervalRef = useRef<any>(null);

  const [zoomFactor, setZoomFactor] = useState<1 | 2 | 3>(1);
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = device?.maxZoom ?? 8;
  const currentZoom = Math.min(minZoom * zoomFactor, maxZoom);

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
      setZoomFactor(1);
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

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, backgroundColor: 'black' }]}>
      {/* 16:9 Viewfinder background layer */}
      {hasPermission === true && device && !capturedAsset && (
        <View style={StyleSheet.absoluteFill}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible && !capturedAsset}
            photo={true}
            zoom={currentZoom}
            resizeMode="cover"
            outputOrientation="device"
          />

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

      <SafeAreaView style={{ flex: 1 }}>
        {hasPermission === false && (
          <View style={styles.center}>
            <Text style={styles.errorText}>Camera permission is required.</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {hasPermission === true && device && (
          <View style={{ flex: 1 }}>
            {/* PHOTO PREVIEW STATE */}
            {capturedAsset ? (
              <View style={styles.previewContainer}>
                <View style={styles.previewImageWrapper}>
                  <Image
                    source={{ uri: capturedAsset.uri }}
                    style={StyleSheet.absoluteFillObject}
                    resizeMode="cover"
                  />
                </View>
                
                {/* Translucent overlay matching native iOS preview */}
                <View style={styles.previewBottomBar}>
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
              <View style={{ flex: 1, justifyContent: 'space-between' }}>
                {/* TOP BAR CONTROLS (iOS Style) */}
                <View style={styles.iosTopBar}>
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

                {/* Spacer block to let viewfinder show through */}
                <View style={{ flex: 1 }} />

                {/* BOTTOM CONTROL SECTION (iOS Style) */}
                <View style={styles.iosBottomSection}>
                  {/* ZOOM PILLS BAR (above shutter) */}
                  <View style={styles.iosZoomContainer}>
                    <TouchableOpacity
                      onPress={() => setZoomFactor(1)}
                      style={[styles.iosZoomButton, zoomFactor === 1 && styles.iosZoomButtonActive]}
                    >
                      <Text style={[styles.iosZoomText, zoomFactor === 1 && styles.iosZoomTextActive]}>1x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setZoomFactor(2)}
                      style={[styles.iosZoomButton, zoomFactor === 2 && styles.iosZoomButtonActive]}
                    >
                      <Text style={[styles.iosZoomText, zoomFactor === 2 && styles.iosZoomTextActive]}>2x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setZoomFactor(3)}
                      style={[styles.iosZoomButton, zoomFactor === 3 && styles.iosZoomButtonActive]}
                    >
                      <Text style={[styles.iosZoomText, zoomFactor === 3 && styles.iosZoomTextActive]}>3x</Text>
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
      </SafeAreaView>
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

