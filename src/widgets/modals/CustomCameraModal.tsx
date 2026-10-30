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
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import Video from 'react-native-video';
import { formatRecordingTime } from '../../utils/camera-video';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { warmCaptureCoords } from '../../utils/capture-location';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Reanimated, { useSharedValue, useAnimatedProps, runOnJS, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets, SafeAreaView as SafeAreaViewContext } from 'react-native-safe-area-context';
import type { CameraWalkthroughController } from '../../hooks/useCameraWalkthrough';
import { VideoFramePicker, type FrameTag, type PickedFrame } from './VideoFramePicker';

export type { FrameTag, PickedFrame };

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
    /** Seconds; only on a recorded video. */
    duration?: number;
  }) => void;
  /**
   * Shows the Photo / Video switch. Off by default: a video is a different kind of asset (`type` is `video/*`) and the host
   * must be able to take it, so every flow opts in on its own.
   */
  allowVideo?: boolean;
  /**
   * Opt-in first-run walkthrough (Jira 576). When given, the shutter and timer are registered as spotlight
   * targets and a throwaway frame is grabbed for the walkthrough's tag-screen steps. The host renders the
   * overlay itself; omitting this prop leaves the camera exactly as it was.
   */
  walkthrough?: CameraWalkthroughController;
  /**
   * Record-then-pick (needs `allowVideo` and `onFramesDone`). A finished recording opens the frame picker instead of the
   * Use Video preview: the user scrubs the clip, saves frames as photos, and each frame goes through this to be tagged
   * by the host (resolve null = the user deleted it). `queued` is every frame already kept from this clip.
   */
  onRequestFrameTag?: (uri: string, queued: FrameTag[]) => Promise<FrameTag | null>;
  /** The kept, tagged frames after the picker's Done. The video is already deleted; only photos come back. */
  onFramesDone?: (frames: PickedFrame[]) => void;
}

const SAMPLE_RETRY_MS = 700;
const SAMPLE_MAX_TRIES = 4;

export const CustomCameraModal = ({
  visible,
  onClose,
  onCapture,
  allowVideo = false,
  walkthrough,
  onRequestFrameTag,
  onFramesDone,
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
    duration?: number;
  } | null>(null);
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [frameClip, setFrameClip] = useState<{ uri: string; duration: number } | null>(null);
  const pickFrames = allowVideo && !!onRequestFrameTag && !!onFramesDone;
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micGranted, setMicGranted] = useState(false);
  const recTickRef = useRef<any>(null);
  const isVideoMode = allowVideo && mode === 'video';

  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const device = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'] });
  const ultraWideDevice = useCameraDevice('back', { physicalDevices: ['ultra-wide-angle-camera'] });
  const hasPhysicalUltraWide = ultraWideDevice !== undefined &&
                               device !== undefined &&
                               ultraWideDevice.id !== device.id &&
                               ultraWideDevice.physicalDevices.includes('ultra-wide-angle-camera');

  const [activeDeviceType, setActiveDeviceType] = useState<'standard' | 'ultrawide'>('standard');
  const activeDevice = activeDeviceType === 'ultrawide' && ultraWideDevice ? ultraWideDevice : device;

  const format = useCameraFormat(activeDevice, [
    { photoAspectRatio: 4 / 3 },
    { videoAspectRatio: 4 / 3 },
    { photoResolution: 'max' },
    { videoResolution: 'max' }
  ]);
  const cameraRef = useRef<Camera>(null);
  const countdownScale = useRef(new Animated.Value(1)).current;
  const timerIntervalRef = useRef<any>(null);

  const minZoom = activeDevice?.minZoom ?? 1;
  const maxZoom = activeDevice?.maxZoom ?? 8;
  const neutralZoom = activeDevice?.neutralZoom ?? minZoom;
  const isUltrawideSupported = !!((device && device.neutralZoom > device.minZoom) || hasPhysicalUltraWide);

  const zoom = useSharedValue(neutralZoom);
  const startZoom = useSharedValue(neutralZoom);
  const [activeZoomLevel, setActiveZoomLevel] = useState(neutralZoom);

  useEffect(() => {
    if (activeDevice) {
      const defaultZoom = activeDevice.neutralZoom ?? activeDevice.minZoom ?? 1;
      zoom.value = defaultZoom;
      startZoom.value = defaultZoom;
      setActiveZoomLevel(defaultZoom);
    }
  }, [activeDevice?.id]); // reset when device changes

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

  useEffect(() => {
    if (visible) {
      warmCaptureCoords();
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

  useEffect(() => {
    if (!visible) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      setCapturedAsset(null);
      setFrameClip(null);
      setIsCapturing(false);
      setCountdown(null);
      setMode('photo');
      if (recTickRef.current) clearInterval(recTickRef.current);
      recTickRef.current = null;
      setRecording(false);
      setRecSeconds(0);
      cameraRef.current?.cancelRecording().catch(() => {});
      setActiveDeviceType('standard');
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

  // Walkthrough example photo: one real frame from this camera, kept in the cache dir only (never persisted or
  // uploaded). The camera can still be spinning up when the tour starts, so retry a few times before giving up
  // (the host falls back to a plain placeholder).
  const walkthroughPhase = walkthrough?.phase;
  const walkthroughHasSample = !!walkthrough?.sample;
  const walkthroughSetSample = walkthrough?.setSample;
  const hasActiveDevice = !!activeDevice;
  useEffect(() => {
    if (walkthroughPhase !== 'tour' || walkthroughHasSample || !walkthroughSetSample) return undefined;
    if (hasPermission !== true || !hasActiveDevice) return undefined;
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async () => {
      tries += 1;
      try {
        const photo = await cameraRef.current!.takePhoto({ flash: 'off', enableShutterSound: false });
        if (!cancelled) walkthroughSetSample(`file://${photo.path}`);
      } catch {
        if (!cancelled && tries < SAMPLE_MAX_TRIES) timer = setTimeout(attempt, SAMPLE_RETRY_MS);
      }
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [walkthroughPhase, walkthroughHasSample, walkthroughSetSample, hasPermission, hasActiveDevice]);

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
    if (recording) {
      stopVideo();
      return;
    }
    if (isCapturing || capturedAsset || !cameraRef.current || !activeDevice) return;

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
          startCapture();
        } else {
          setCountdown(currentVal);
        }
      }, 1000);
    } else {
      startCapture();
    }
  };

  const startCapture = () => (isVideoMode ? startVideo() : takePhoto());

  const ensureMic = async () => {
    const status = Camera.getMicrophonePermissionStatus();
    if (status === 'granted') return true;
    return (await Camera.requestMicrophonePermission()) === 'granted';
  };

  const startVideo = async () => {
    const cam = cameraRef.current;
    if (!cam) return;
    // Without the mic a clip is still recorded, just silent (the camera's `audio` prop follows micGranted).
    setMicGranted(await ensureMic());
    try {
      setIsCapturing(true);
      setRecording(true);
      setRecSeconds(0);
      recTickRef.current = setInterval(() => setRecSeconds((n) => n + 1), 1000);
      cam.startRecording({
        flash: flash === 'on' ? 'on' : 'off',
        onRecordingFinished: (video) => {
          finishVideo(video).catch((e) => console.warn('[CustomCameraModal] video finish failed:', e));
        },
        onRecordingError: (error) => {
          console.warn('[CustomCameraModal] recording error:', error);
          stopTicker();
        },
      });
    } catch (e) {
      console.warn('[CustomCameraModal] could not start recording:', e);
      stopTicker();
    }
  };

  const stopTicker = () => {
    if (recTickRef.current) clearInterval(recTickRef.current);
    recTickRef.current = null;
    setRecording(false);
    setIsCapturing(false);
    setCountdown(null);
  };

  const stopVideo = async () => {
    try {
      await cameraRef.current?.stopRecording();
    } catch (e) {
      console.warn('[CustomCameraModal] stopRecording failed:', e);
      stopTicker();
    }
  };

  const finishVideo = async (video: { path: string; duration: number; width: number; height: number }) => {
    stopTicker();
    if (pickFrames) {
      // Only frames are kept, so the clip stays where the camera wrote it (no pending_uploads copy).
      setFrameClip({ uri: `file://${video.path.replace(/^file:\/\//, '')}`, duration: video.duration });
      return;
    }
    let durablePath = video.path.replace(/^file:\/\//, '');
    try {
      const fs = ReactNativeBlobUtil.fs;
      const dir = `${fs.dirs.DocumentDir}/pending_uploads`;
      if (!(await fs.exists(dir))) await fs.mkdir(dir);
      const base = durablePath.split('/').pop() || `video_${Date.now()}.mp4`;
      const dest = `${dir}/${Date.now()}_${base}`;
      await fs.cp(durablePath, dest);
      durablePath = dest;
    } catch (e) {
      console.warn('[CustomCameraModal] Could not persist recorded video, using tmp path:', e);
    }
    const isMov = /\.mov$/i.test(durablePath);
    setCapturedAsset({
      uri: `file://${durablePath}`,
      fileName: durablePath.split('/').pop() || `video_${Date.now()}.mp4`,
      type: isMov ? 'video/quicktime' : 'video/mp4',
      width: video.width,
      height: video.height,
      duration: video.duration,
    });
  };

  const takePhoto = async () => {
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current!.takePhoto({
        flash: flash === 'auto' ? 'auto' : flash === 'on' ? 'on' : 'off',
      });

      let durablePath = photo.path;
      try {
        const fs = ReactNativeBlobUtil.fs;
        const dir = `${fs.dirs.DocumentDir}/pending_uploads`;
        if (!(await fs.exists(dir))) await fs.mkdir(dir);
        const base = photo.path.split('/').pop() || `photo_${Date.now()}.jpg`;
        const dest = `${dir}/${Date.now()}_${base}`;
        await fs.cp(photo.path.replace(/^file:\/\//, ''), dest);
        durablePath = dest;
      } catch (e) {
        console.warn('[CustomCameraModal] Could not persist captured photo, using tmp path:', e);
      }

      const fileName = durablePath.split('/').pop() || `photo_${Date.now()}.jpg`;
      const asset = {
        uri: `file://${durablePath}`,
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

  const viewfinderTop = insets.top + 20 + (Platform.OS === 'android' ? insets.top + 20 : 0);

  const maxViewfinderHeight = Math.max(
    0,
    screenHeight - viewfinderTop - insets.bottom - BOTTOM_CONTROLS_MIN_HEIGHT,
  );
  const viewfinderHeight = Math.min(screenWidth * (4 / 3), maxViewfinderHeight);
  const viewfinderWidth = viewfinderHeight * (3 / 4);
  const viewfinderLeft = (screenWidth - viewfinderWidth) / 2;

  const SafeAreaComponent = Platform.OS === 'android' ? SafeAreaViewContext : SafeAreaView;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, backgroundColor: 'black' }]}>
      {/* 4:3 Viewfinder centered container */}
      {hasPermission === true && activeDevice && !capturedAsset && !frameClip && (
        <View style={{
          position: 'absolute',
          top: viewfinderTop,
          left: viewfinderLeft,
          width: viewfinderWidth,
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
                  device={activeDevice}
                  format={format}
                  isActive={visible && !capturedAsset}
                  photo={true}
                  video={allowVideo}
                  audio={isVideoMode && micGranted}
                  animatedProps={animatedProps}
                  resizeMode="cover"
                  outputOrientation="device"
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

        {hasPermission === true && activeDevice && (
          <View style={{ flex: 1 }} pointerEvents="box-none">
            {/* PHOTO PREVIEW STATE */}
            {capturedAsset ? (
              <View style={styles.previewContainer}>
                <View style={{
                  position: 'absolute',
                  top: viewfinderTop,
                  left: viewfinderLeft,
                  width: viewfinderWidth,
                  height: viewfinderHeight,
                  overflow: 'hidden',
                  backgroundColor: 'black',
                }}>
                  {/* ⚠️ Ticket: a photo taken with the phone rotated to landscape (now
                      captured with a correct "device" EXIF orientation — see `outputOrientation`
                      below) looked CROPPED here — most of the frame was outside this box, which
                      is sized and positioned for a PORTRAIT photo (the live viewfinder is
                      portrait-only by design). The captured file itself is never cropped
                      (`takePhoto()` always returns the full sensor frame, independent of the
                      live preview's size/resizeMode — confirmed from vision-camera's iOS source:
                      AVCapturePhotoOutput and the preview's AVCaptureVideoPreviewLayer are
                      separate outputs). `resizeMode="cover"` was fitting the WHOLE photo into a
                      box shaped for the other orientation, hiding most of a wide photo off both
                      edges. `"contain"` always shows the full photo, letterboxed inside this same
                      box — do not go back to `cover` here. */}
                  {capturedAsset.type.startsWith('video/') ? (
                    <Video
                      source={{ uri: capturedAsset.uri }}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="contain"
                      controls
                      repeat
                    />
                  ) : (
                    <Image
                      source={{ uri: capturedAsset.uri }}
                      style={StyleSheet.absoluteFillObject}
                      resizeMode="contain"
                    />
                  )}
                </View>

                {/* Translucent overlay matching native iOS preview */}
                <View style={[styles.previewBottomBar, { position: 'absolute', top: viewfinderTop + viewfinderHeight, bottom: 0, left: 0, right: 0, backgroundColor: 'black', justifyContent: 'space-between', alignItems: 'center', paddingTop: 24, paddingBottom: 40 }]}>
                  <TouchableOpacity onPress={handleRetake} style={styles.previewButton}>
                    <Text style={styles.previewButtonText}>Retake</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={handleUsePhoto} style={styles.previewButton}>
                    <Text style={[styles.previewButtonText, styles.usePhotoText]}>
                      {capturedAsset.type.startsWith('video/') ? 'Use Video' : 'Use Photo'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
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

                  {/* Timer Toggle. The wrapper View is the walkthrough's spotlight target. */}
                  <View ref={walkthrough?.targetRef('timer')} collapsable={false}>
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
                </View>

                {/* BOTTOM CONTROL SECTION (iOS Style) */}
                <View style={[styles.iosBottomSection, { position: 'absolute', top: viewfinderTop + viewfinderHeight, bottom: 0, left: 0, right: 0, backgroundColor: 'black', zIndex: 10, paddingVertical: 12 }]}>
                  {/* Lives in the black bar, not over the viewfinder: on Android the camera surface paints over sibling views. */}
                  {recording && (
                    <View style={styles.recTimer} pointerEvents="none">
                      <View style={styles.recDot} />
                      <Text style={styles.recText}>{formatRecordingTime(recSeconds)}</Text>
                    </View>
                  )}
                  {allowVideo && !recording && (
                    <View ref={walkthrough?.targetRef('modes')} collapsable={false} style={styles.modeRow}>
                      {(['photo', 'video'] as const).map((m) => (
                        <TouchableOpacity
                          key={m}
                          onPress={() => !isCapturing && setMode(m)}
                          style={styles.modeButton}
                          accessibilityLabel={m === 'photo' ? 'Photo mode' : 'Video mode'}
                        >
                          <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'photo' ? 'Photo' : 'Video'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* ZOOM PILLS BAR (above shutter) */}
                  <View style={styles.iosZoomContainer}>
                    {isUltrawideSupported && (
                      <TouchableOpacity
                        onPress={() => {
                          if (device && device.neutralZoom > device.minZoom) {
                            zoom.value = withSpring(minZoom);
                            setActiveZoomLevel(minZoom);
                          } else if (ultraWideDevice) {
                            setActiveDeviceType('ultrawide');
                            const targetZoom = ultraWideDevice.neutralZoom ?? ultraWideDevice.minZoom ?? 1;
                            zoom.value = targetZoom;
                            setActiveZoomLevel(minZoom);
                          }
                        }}
                        style={[
                          styles.iosZoomButton,
                          (activeDeviceType === 'ultrawide' || (activeDeviceType === 'standard' && activeZoomLevel < neutralZoom)) && styles.iosZoomButtonActive
                        ]}
                      >
                        <Text style={[
                          styles.iosZoomText,
                          (activeDeviceType === 'ultrawide' || (activeDeviceType === 'standard' && activeZoomLevel < neutralZoom)) && styles.iosZoomTextActive
                        ]}>0.5x</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => {
                        if (activeDeviceType === 'ultrawide') {
                          setActiveDeviceType('standard');
                        }
                        const targetZoom = device ? (device.neutralZoom ?? 1) : 1;
                        zoom.value = withSpring(targetZoom);
                        setActiveZoomLevel(targetZoom);
                      }}
                      style={[
                        styles.iosZoomButton,
                        activeDeviceType === 'standard' && activeZoomLevel >= neutralZoom && activeZoomLevel < neutralZoom * 2 && styles.iosZoomButtonActive
                      ]}
                    >
                      <Text style={[
                        styles.iosZoomText,
                        activeDeviceType === 'standard' && activeZoomLevel >= neutralZoom && activeZoomLevel < neutralZoom * 2 && styles.iosZoomTextActive
                      ]}>1x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        if (activeDeviceType === 'ultrawide') {
                          setActiveDeviceType('standard');
                        }
                        const targetZoom = device ? (device.neutralZoom ?? 1) * 2 : 2;
                        zoom.value = withSpring(targetZoom);
                        setActiveZoomLevel(targetZoom);
                      }}
                      style={[
                        styles.iosZoomButton,
                        activeDeviceType === 'standard' && activeZoomLevel >= neutralZoom * 2 && activeZoomLevel < neutralZoom * 3 && styles.iosZoomButtonActive
                      ]}
                    >
                      <Text style={[
                        styles.iosZoomText,
                        activeDeviceType === 'standard' && activeZoomLevel >= neutralZoom * 2 && activeZoomLevel < neutralZoom * 3 && styles.iosZoomTextActive
                      ]}>2x</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        if (activeDeviceType === 'ultrawide') {
                          setActiveDeviceType('standard');
                        }
                        const targetZoom = device ? (device.neutralZoom ?? 1) * 3 : 3;
                        zoom.value = withSpring(targetZoom);
                        setActiveZoomLevel(targetZoom);
                      }}
                      style={[
                        styles.iosZoomButton,
                        activeDeviceType === 'standard' && activeZoomLevel >= neutralZoom * 3 && styles.iosZoomButtonActive
                      ]}
                    >
                      <Text style={[
                        styles.iosZoomText,
                        activeDeviceType === 'standard' && activeZoomLevel >= neutralZoom * 3 && styles.iosZoomTextActive
                      ]}>3x</Text>
                    </TouchableOpacity>
                  </View>

                  {/* SHUTTER & OTHER ACTIONS */}
                  <View style={styles.iosShutterRow}>
                    {/* Left: empty placeholder. ⚠️ It MUST stay — the shutter is
                        centred by the two 44pt spacers either side of it, so
                        deleting this shifts the button off-centre. */}
                    <View style={{ width: 44 }} />

                    {/* Center: iOS Shutter Button */}
                    <View ref={walkthrough?.targetRef('shutter')} collapsable={false} style={styles.iosShutterOuterWrapper}>
                      {isCapturing && countdown === null && !recording ? (
                        <ActivityIndicator size="large" color="#FFD607" />
                      ) : (
                        <TouchableOpacity
                          onPress={handleCapture}
                          style={[styles.iosShutterOuterRing, isVideoMode && { borderColor: 'white' }]}
                          disabled={isCapturing && !recording}
                          accessibilityLabel={recording ? 'Stop recording' : isVideoMode ? 'Start recording' : 'Take photo'}
                        >
                          <View
                            style={
                              recording
                                ? styles.iosShutterStop
                                : isVideoMode
                                  ? [styles.iosShutterInnerCircle, { backgroundColor: '#FF3B30' }]
                                  : styles.iosShutterInnerCircle
                            }
                          />
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

        {hasPermission === true && !activeDevice && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#FFD607" />
            <Text style={styles.loadingText}>Initializing camera...</Text>
          </View>
        )}
      </SafeAreaComponent>

      {frameClip && onRequestFrameTag && onFramesDone && (
        <VideoFramePicker
          clipUri={frameClip.uri}
          clipDuration={frameClip.duration}
          requestTag={onRequestFrameTag}
          onDone={(frames) => {
            setFrameClip(null);
            onFramesDone(frames);
          }}
          onDiscard={() => setFrameClip(null)}
        />
      )}
    </View>
  );
};

const BOTTOM_CONTROLS_MIN_HEIGHT = 200;

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
  modeRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 36, paddingTop: 2 },
  modeButton: { paddingVertical: 6, paddingHorizontal: 8 },
  modeText: { color: 'rgba(255,255,255,0.55)', fontSize: 17, fontWeight: '600' },
  modeTextActive: { color: '#FFD607' },
  recBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 9,
  },
  recTimer: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,59,48,0.9)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 6 },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#fff', marginRight: 8 },
  recText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  iosShutterStop: { width: 30, height: 30, borderRadius: 6, backgroundColor: '#FF3B30' },
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

