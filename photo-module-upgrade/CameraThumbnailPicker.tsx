/**
 * CameraThumbnailPicker.tsx
 *
 * Camera with Photo + Video modes. Record a clip, scrub through it frame by frame,
 * and save any frames as photos. Every photo (taken or pulled from video) is tagged.
 * The video itself is never kept: only the tagged photos are returned.
 *
 * Flow:  Camera  ->  (Video) record / stop  ->  Frame picker (scrub + capture + tag)
 *        ->  Review grid  ->  onPhotosAdded(photos)
 *
 * Dependencies (install once):
 *   yarn add react-native-vision-camera react-native-video react-native-create-thumbnail \
 *            @react-native-async-storage/async-storage react-native-safe-area-context
 *   cd ios && pod install
 *
 * Permissions: camera only (audio is off, so no microphone permission is needed).
 *   iOS  Info.plist: NSCameraUsageDescription
 *   Android Manifest: <uses-permission android:name="android.permission.CAMERA" />
 *
 * Usage:
 *   <CameraThumbnailPicker
 *     onClose={() => navigation.goBack()}
 *     onPhotosAdded={(photos) => addPhotosToJob(photos)}   // [{ uri, tag, source, frameTime? }]
 *     requestTag={openMyTagScreen}  // optional: (uri) => Promise<tagLabel | null>
 *   />
 *
 * If you leave out `requestTag`, a built-in Home tag screen is used (8 house positions + Extra).
 * Pass your existing Inspection Photos tag screen through `requestTag` to keep all sections/tabs.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type VideoFile,
} from 'react-native-vision-camera';
import Video, { type VideoRef } from 'react-native-video';
import { createThumbnail } from 'react-native-create-thumbnail';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TaggedPhoto = {
  uri: string;
  tag: string;
  source: 'photo' | 'video-frame';
  /** seconds into the clip, for video frames */
  frameTime?: number;
  width?: number;
  height?: number;
};

/** Open your tag UI for this photo. Resolve with the tag label, or null if the user cancelled / deleted it. */
export type RequestTag = (uri: string) => Promise<string | null>;

export type CameraThumbnailPickerProps = {
  onClose: () => void;
  /** Photo mode: called once per tagged photo. Video mode: called once with all frames on Done. */
  onPhotosAdded: (photos: TaggedPhoto[]) => void;
  requestTag?: RequestTag;
  /** Recording stops automatically at this length. Default 30. */
  maxVideoSeconds?: number;
  /** Show the first-run popup + walkthrough (until "Don't show again"). Default true. */
  showIntro?: boolean;
};

type Shot = { id: string; t: number; uri: string; tag: string; width?: number; height?: number };
type Clip = { uri: string; dur: number };
type Screen = 'camera' | 'pick' | 'review';
type Rect = { x: number; y: number; width: number; height: number };

/* ------------------------------------------------------------------ */
/* Constants + helpers                                                 */
/* ------------------------------------------------------------------ */

const FPS = 30; // scrub snaps to 1/30 s frames
const INTRO_KEY = 'revdsm_camera_intro_hidden';
const YELLOW = '#ffd60a';
const RED = '#ff3b30';
const GREEN = '#4cbb17';
const ZOOM_LABELS = [0.5, 1, 2, 3];
const TIMER_OPTIONS = [0, 3, 10];
const FRAME_MAX_PX = 4096; // keep full resolution (library default is 512)

const HOME_LAYOUT: (string | null)[][] = [
  ['Back-Left', 'Back', 'Back-Right'],
  ['Left Side', null, 'Right Side'],
  ['Front-Left', 'Front', 'Front-Right'],
];

const TOUR: { title: string; body: string; target?: 'shutter' | 'timer' | 'modes' }[] = [
  { title: 'Take it, then tag it', body: 'Tap the capture button like normal. Right after each shot, you tag it.', target: 'shutter' },
  { title: 'Pick where it goes', body: 'On the tag screen, pick the section, then tap the spot that matches the photo, or tap Tag as Extra. Every photo gets tagged this way.' },
  { title: "Can't reach the capture button?", body: "Phone on an extension pole, or up a ladder where you can't reach the capture button? Tap the timer at the top and set it. The camera takes the photo for you when it runs out.", target: 'timer' },
  { title: 'Or record, then pick the shot', body: 'Same situation, another way: switch to Video, start recording, move the phone into position, then stop. Drag the slider to the sharpest frame and save it as a photo. Each frame gets tagged. The video is not kept.', target: 'modes' },
];

const toUri = (p: string) => (/^(file|content|ph):\/\//.test(p) ? p : `file://${p}`);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (t: number) => {
  t = Math.max(0, t);
  return `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}.${pad(Math.floor((t % 1) * 100))}`;
};
const fmtShort = (t: number) => {
  t = Math.round(t);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function CameraThumbnailPicker({
  onClose,
  onPhotosAdded,
  requestTag,
  maxVideoSeconds = 30,
  showIntro = true,
}: CameraThumbnailPickerProps) {
  const insets = useSafeAreaInsets();

  /* ---------- camera setup ---------- */
  const camRef = useRef<Camera>(null);
  const device = useCameraDevice('back', {
    physicalDevices: ['ultra-wide-angle-camera', 'wide-angle-camera', 'telephoto-camera'],
  });
  const { hasPermission, requestPermission } = useCameraPermission();
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Zoom buttons that this device can actually do. 1x = the device's neutral (wide) lens.
  const zoomOptions = useMemo(() => {
    if (!device) return [] as { label: number; value: number }[];
    const n = device.neutralZoom;
    return ZOOM_LABELS.map((label) => ({ label, value: clamp(n * label, device.minZoom, device.maxZoom) })).filter(
      ({ label }) => (label < 1 ? device.minZoom < n * 0.95 : n * label <= device.maxZoom + 0.01),
    );
  }, [device]);
  const [zoomLabel, setZoomLabel] = useState(1);
  useEffect(() => {
    // Start on 0.5x when the device has an ultra-wide, like the mock.
    if (zoomOptions.some((z) => z.label === 0.5)) setZoomLabel(0.5);
  }, [zoomOptions]);
  const zoom = zoomOptions.find((z) => z.label === zoomLabel)?.value ?? device?.neutralZoom ?? 1;

  /* ---------- shared state ---------- */
  const [screen, setScreen] = useState<Screen>('camera');
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  /* ---------- white flash on capture ---------- */
  const flashAnim = useRef(new Animated.Value(0)).current;
  const doFlash = useCallback(() => {
    flashAnim.setValue(0.85);
    Animated.timing(flashAnim, { toValue: 0, duration: 350, useNativeDriver: true }).start();
  }, [flashAnim]);

  /* ---------- tagging (built-in screen unless requestTag is given) ---------- */
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [tagReq, setTagReq] = useState<{ uri: string; resolve: (t: string | null) => void } | null>(null);
  const askTag = useCallback<RequestTag>(
    (uri) => (requestTag ? requestTag(uri) : new Promise((resolve) => setTagReq({ uri, resolve }))),
    [requestTag],
  );
  const bumpTag = (tag: string, d: number) =>
    setTagCounts((c) => ({ ...c, [tag]: Math.max(0, (c[tag] || 0) + d) }));
  const finishTag = (tag: string | null) => {
    tagReq?.resolve(tag);
    setTagReq(null);
  };

  /* ---------- flash + self-timer ---------- */
  const [flashOn, setFlashOn] = useState(false);
  const [timerSecs, setTimerSecs] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setCountdown(null);
  };
  useEffect(() => () => cancelCountdown(), []);

  /* ---------- photo mode ---------- */
  const takePhotoNow = useCallback(async () => {
    if (!camRef.current) return;
    setBusy(true);
    try {
      const p = await camRef.current.takePhoto({ flash: flashOn && device?.hasFlash ? 'on' : 'off' });
      doFlash();
      const uri = toUri(p.path);
      const tag = await askTag(uri);
      if (tag) {
        bumpTag(tag, 1);
        onPhotosAdded([{ uri, tag, source: 'photo', width: p.width, height: p.height }]);
        showToast(`Saved as ${tag}`);
      } else {
        showToast('Photo deleted');
      }
    } catch (e) {
      showToast('Could not take photo');
    } finally {
      setBusy(false);
    }
  }, [askTag, device?.hasFlash, doFlash, flashOn, onPhotosAdded, showToast]);

  const onPhotoShutter = () => {
    if (busy) return;
    if (countdown !== null) return cancelCountdown(); // tap again to cancel the timer
    if (!timerSecs) return void takePhotoNow();
    let left = timerSecs;
    setCountdown(left);
    countdownRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        cancelCountdown();
        takePhotoNow();
      } else setCountdown(left);
    }, 1000);
  };

  /* ---------- video mode ---------- */
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const recStart = useRef(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [pickerT, setPickerT] = useState(0);

  const openPicker = useCallback((uri: string, dur: number) => {
    setClip({ uri, dur: Math.max(dur, 1 / FPS) });
    setShots([]);
    setPickerT(0);
    setScreen('pick');
  }, []);

  const startRec = () => {
    if (!camRef.current) return;
    recStart.current = Date.now();
    setRecSecs(0);
    setRecording(true);
    camRef.current.startRecording({
      flash: 'off',
      onRecordingFinished: (v: VideoFile) => {
        setRecording(false);
        openPicker(toUri(v.path), v.duration || (Date.now() - recStart.current) / 1000);
      },
      onRecordingError: (e) => {
        setRecording(false);
        showToast(`Recording failed: ${e.message}`);
      },
    });
  };
  const stopRec = () => camRef.current?.stopRecording().catch(() => setRecording(false));

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const s = (Date.now() - recStart.current) / 1000;
      setRecSecs(s);
      if (s >= maxVideoSeconds) stopRec();
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, maxVideoSeconds]);

  const onShutter = () => {
    if (mode === 'photo') onPhotoShutter();
    else if (recording) stopRec();
    else startRec();
  };

  /* ---------- frame picker: video only moves with the slider ---------- */
  const videoRef = useRef<VideoRef>(null);
  const durRef = useRef(1);
  durRef.current = clip?.dur ?? 1;
  const seekTarget = useRef<number | null>(null);
  const seekRaf = useRef<number | null>(null);
  const snap = (v: number) => {
    const f = 1 / FPS;
    return clamp(Math.round(v / f) * f, 0, Math.floor((durRef.current - 0.001) / f) * f);
  };
  const seekTo = useCallback((t: number) => {
    setPickerT(t);
    seekTarget.current = t;
    if (seekRaf.current == null) {
      seekRaf.current = requestAnimationFrame(() => {
        seekRaf.current = null;
        if (seekTarget.current != null) videoRef.current?.seek(seekTarget.current, Platform.OS === 'ios' ? 0 : undefined);
      });
    }
  }, []);

  const barRef = useRef<View>(null);
  const barBox = useRef({ x: 0, w: 1 });
  const measureBar = () =>
    barRef.current?.measure((_x, _y, w, _h, pageX) => { barBox.current = { x: pageX, w: w || 1 }; });
  const seekToPageX = (pageX: number) => {
    const p = clamp((pageX - barBox.current.x) / barBox.current.w, 0, 1);
    seekTo(snap(p * durRef.current));
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => seekToPageX(e.nativeEvent.pageX),
        onPanResponderMove: (e) => seekToPageX(e.nativeEvent.pageX),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const trayRef = useRef<ScrollView>(null);
  const captureFrame = async () => {
    if (!clip || busy) return;
    setBusy(true);
    const at = pickerT;
    try {
      const th = await createThumbnail({
        url: clip.uri,
        timeStamp: Math.round(at * 1000),
        format: 'jpeg',
        maxWidth: FRAME_MAX_PX,
        maxHeight: FRAME_MAX_PX,
        cacheName: `frame_${uid()}`,
        onlySyncedFrames: false, // needs the Android patch to take effect (see notes)
      });
      doFlash();
      const uri = toUri(th.path);
      const tag = await askTag(uri);
      if (tag) {
        bumpTag(tag, 1);
        setShots((s) => [...s, { id: uid(), t: at, uri, tag, width: th.width, height: th.height }]);
        setTimeout(() => trayRef.current?.scrollToEnd({ animated: true }), 50);
      }
    } catch (e) {
      showToast('Could not save that frame');
    } finally {
      setBusy(false);
    }
  };

  const removeShot = (s: Shot) => {
    bumpTag(s.tag, -1);
    setShots((list) => list.filter((x) => x.id !== s.id));
  };

  const discardClip = (msg: string, keepTags = false) => {
    if (!keepTags) shots.forEach((s) => bumpTag(s.tag, -1));
    setClip(null);
    setShots([]);
    setPickerT(0);
    setScreen('camera');
    showToast(msg);
  };

  const finish = () => {
    onPhotosAdded(
      shots.map((s) => ({ uri: s.uri, tag: s.tag, source: 'video-frame' as const, frameTime: s.t, width: s.width, height: s.height })),
    );
    const n = shots.length;
    discardClip(`Added ${n} ${n === 1 ? 'photo' : 'photos'}. The video was discarded.`, true);
  };

  /* ---------- Android back button ---------- */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tagReq) return false; // Modal handles it
      if (screen === 'review') { setScreen('pick'); return true; }
      if (screen === 'pick') { discardClip('Video discarded. Nothing was saved.'); return true; }
      if (recording) return true;
      onClose();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, recording, tagReq, shots]);

  /* ---------- first-run popup + walkthrough ---------- */
  const [introSheet, setIntroSheet] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [rootH, setRootH] = useState(0);
  const rootRef = useRef<View>(null);
  const shutterRef = useRef<View>(null);
  const timerRef = useRef<View>(null);
  const modesRef = useRef<View>(null);

  useEffect(() => {
    if (!showIntro) return;
    AsyncStorage.getItem(INTRO_KEY).then((v) => { if (v !== '1') setIntroSheet(true); }).catch(() => setIntroSheet(true));
  }, [showIntro]);
  const hideIntroForever = () => AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {});

  useEffect(() => {
    if (tourStep === null) return setSpot(null);
    const target = TOUR[tourStep].target;
    const ref = target === 'shutter' ? shutterRef : target === 'timer' ? timerRef : target === 'modes' ? modesRef : null;
    if (!ref?.current || !rootRef.current) return setSpot(null);
    ref.current.measureLayout(
      rootRef.current,
      (x, y, width, height) => setSpot({ x: x - 12, y: y - 12, width: width + 24, height: height + 24 }),
      () => setSpot(null),
    );
  }, [tourStep]);
  const endTour = (forever: boolean) => {
    setTourStep(null);
    if (forever) hideIntroForever();
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  if (!hasPermission) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.msg}>Camera access is needed to take photos.</Text>
        <Pressable style={[s.btn, s.btnPrimary, { marginTop: 20, alignSelf: 'center', paddingHorizontal: 28 }]} onPress={requestPermission}>
          <Text style={[s.btnText, { color: '#000' }]}>Allow camera</Text>
        </Pressable>
        <Pressable style={{ marginTop: 16 }} onPress={onClose}><Text style={s.link}>Close</Text></Pressable>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const n = shots.length;
  const overlayOpen = introSheet || tourStep !== null;

  return (
    <View ref={rootRef} style={s.root} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      {/* ================= CAMERA ================= */}
      {screen === 'camera' && (
        <>
          <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable hitSlop={16} onPress={() => !recording && onClose()} accessibilityLabel="Close camera">
              <Text style={s.icon}>✕</Text>
            </Pressable>
            <Pressable
              hitSlop={16}
              disabled={!device.hasFlash || mode === 'video'}
              onPress={() => setFlashOn((f) => !f)}
              accessibilityLabel={flashOn ? 'Flash on' : 'Flash off'}
            >
              <Text style={[s.topLabel, flashOn && { color: YELLOW }, (!device.hasFlash || mode === 'video') && { opacity: 0.35 }]}>
                {flashOn ? 'Flash On' : 'Flash Off'}
              </Text>
            </Pressable>
            <Pressable
              ref={timerRef}
              hitSlop={16}
              disabled={mode === 'video'}
              onPress={() => setTimerSecs((t) => TIMER_OPTIONS[(TIMER_OPTIONS.indexOf(t) + 1) % TIMER_OPTIONS.length])}
              accessibilityLabel={timerSecs ? `Timer ${timerSecs} seconds` : 'Timer off'}
            >
              <Text style={[s.topLabel, timerSecs > 0 && { color: YELLOW }, mode === 'video' && { opacity: 0.35 }]}>
                {timerSecs ? `Timer ${timerSecs}s` : 'Timer Off'}
              </Text>
            </Pressable>
          </View>

          <View style={s.preview}>
            <Camera
              ref={camRef}
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={screen === 'camera' && appActive && !tagReq}
              photo
              video
              audio={false}
              zoom={zoom}
            />
            {recording && (
              <View style={s.recPill}>
                <View style={s.recDot} />
                <Text style={s.recText}>{`${Math.floor(recSecs / 60)}:${pad(Math.floor(recSecs % 60))}`}</Text>
              </View>
            )}
            {countdown !== null && (
              <View style={[StyleSheet.absoluteFill, s.center]} pointerEvents="none">
                <Text style={s.countdown}>{countdown}</Text>
              </View>
            )}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flashAnim }]} />
            {toast && <View style={s.pill} pointerEvents="none"><Text style={s.pillText}>{toast}</Text></View>}
          </View>

          <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.zoomRow}>
              {zoomOptions.map((z) => (
                <Pressable
                  key={z.label}
                  onPress={() => setZoomLabel(z.label)}
                  style={[s.zoomBtn, zoomLabel === z.label && s.zoomBtnOn]}
                  accessibilityLabel={`${z.label}x zoom`}
                >
                  <Text style={[s.zoomText, zoomLabel === z.label && { color: YELLOW, fontWeight: '700' }]}>{`${z.label}x`}</Text>
                </Pressable>
              ))}
            </View>

            <View ref={modesRef} style={[s.modes, recording && { opacity: 0.3 }]} pointerEvents={recording ? 'none' : 'auto'}>
              {(['photo', 'video'] as const).map((m) => (
                <Pressable key={m} onPress={() => { cancelCountdown(); setMode(m); }} style={s.modeBtn}>
                  <Text style={[s.modeText, mode === m && { color: YELLOW }]}>{m === 'photo' ? 'Photo' : 'Video'}</Text>
                </Pressable>
              ))}
            </View>

            <View style={s.shutterRow}>
              <View style={s.side} />
              <Pressable ref={shutterRef} onPress={onShutter} disabled={busy && !recording} style={s.shutter} accessibilityLabel="Capture">
                <View
                  style={[
                    s.core,
                    mode === 'video' && { backgroundColor: RED },
                    recording && { width: 34, height: 34, borderRadius: 8 },
                  ]}
                />
              </Pressable>
              <View style={s.side} />
            </View>
          </View>
        </>
      )}

      {/* ================= FRAME PICKER ================= */}
      {screen === 'pick' && clip && (
        <>
          <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable hitSlop={16} onPress={() => discardClip('Video discarded. Nothing was saved.')} accessibilityLabel="Discard video">
              <Text style={s.icon}>✕</Text>
            </Pressable>
            <Text style={s.title}>Capture Photos</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={s.preview}>
            <Video
              ref={videoRef}
              source={{ uri: clip.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              paused
              muted
              repeat={false}
              onLoad={(d) => {
                if (d.duration > 0) setClip((c) => (c ? { ...c, dur: d.duration } : c));
                videoRef.current?.seek(0);
              }}
            />
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flashAnim }]} />
            <View style={s.pill} pointerEvents="none">
              <Text style={s.pillText}>
                {toast ?? (n === 0 ? 'Drag the slider, then tap capture' : `${n} ${n === 1 ? 'photo' : 'photos'} captured`)}
              </Text>
            </View>

            {n > 0 && (
              <ScrollView ref={trayRef} horizontal showsHorizontalScrollIndicator={false} style={s.tray} contentContainerStyle={s.trayContent}>
                {shots.map((sh) => (
                  <Pressable key={sh.id} style={s.thumb} onPress={() => seekTo(sh.t)} accessibilityLabel={`Photo tagged ${sh.tag}`}>
                    <Image source={{ uri: sh.uri }} style={StyleSheet.absoluteFill} />
                    <View style={s.thumbLabel}><Text style={s.thumbLabelText} numberOfLines={1}>{sh.tag}</Text></View>
                    <Pressable style={s.thumbX} hitSlop={6} onPress={() => removeShot(sh)} accessibilityLabel="Remove photo">
                      <Text style={s.thumbXText}>✕</Text>
                    </Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.scrub} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Video position">
              <View style={s.scrubTimes}>
                <Text style={s.scrubTime}>{fmt(pickerT)}</Text>
                <Text style={s.scrubTime}>{fmtShort(clip.dur)}</Text>
              </View>
              <View ref={barRef} style={s.bar} onLayout={measureBar}>
                <View style={[s.fill, { width: `${(pickerT / clip.dur) * 100}%` }]} />
                {shots.map((sh) => (
                  <View key={sh.id} style={[s.tick, { left: `${(sh.t / clip.dur) * 100}%` }]} />
                ))}
              </View>
            </View>

            <View style={s.shutterRow}>
              <Pressable style={s.side} onPress={() => discardClip('Video and captured frames discarded.')}>
                <Text style={s.txtBtn}>Retake</Text>
              </Pressable>
              <Pressable onPress={captureFrame} disabled={busy} style={[s.shutter, busy && { opacity: 0.6 }]} accessibilityLabel="Save this frame as a photo">
                <View style={s.core} />
              </Pressable>
              <Pressable style={[s.side, { alignItems: 'flex-end' }]} disabled={n === 0} onPress={() => setScreen('review')}>
                <Text style={[s.txtBtn, { color: n ? YELLOW : '#5c5c61', fontWeight: '600' }]}>{n ? `Done (${n})` : 'Done'}</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

      {/* ================= REVIEW ================= */}
      {screen === 'review' && (
        <>
          <View style={[s.topBar, { paddingTop: insets.top + 8, justifyContent: 'center' }]}>
            <Text style={s.title}>{`${n} ${n === 1 ? 'Photo' : 'Photos'} Added`}</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.grid}>
            {shots.map((sh) => (
              <View key={sh.id} style={s.gridItem}>
                <Image source={{ uri: sh.uri }} style={StyleSheet.absoluteFill} />
                <View style={s.gridTag}><Text style={s.gridTagText}>{sh.tag}</Text></View>
              </View>
            ))}
          </ScrollView>
          <Text style={s.summary}>The video is discarded. Only these photos are kept.</Text>
          <View style={[s.shutterRow, { paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }]}>
            <Pressable onPress={() => setScreen('pick')}><Text style={s.txtBtn}>Back</Text></Pressable>
            <Pressable onPress={finish}><Text style={[s.txtBtn, { color: YELLOW, fontWeight: '600' }]}>Done</Text></Pressable>
          </View>
        </>
      )}

      {/* ================= FIRST-RUN POPUP ================= */}
      {introSheet && (
        <View style={[StyleSheet.absoluteFill, s.dim, s.center]}>
          <View style={s.dlg}>
            <Text style={s.eyebrow}>CAMERA</Text>
            <Text style={s.dlgTitle}>Want a quick walkthrough?</Text>
            <Text style={s.dlgBody}>See how photo tagging, the timer and video capture work. It takes about 30 seconds.</Text>
            <Pressable style={[s.btn, s.btnPrimary]} onPress={() => { setIntroSheet(false); setTourStep(0); }}>
              <Text style={[s.btnText, { color: '#000' }]}>Show me the walkthrough</Text>
            </Pressable>
            <Pressable style={s.btn} onPress={() => setIntroSheet(false)}>
              <Text style={s.btnText}>Never mind</Text>
            </Pressable>
            <Pressable style={{ paddingVertical: 14 }} onPress={() => { setIntroSheet(false); hideIntroForever(); }}>
              <Text style={s.link}>Don't show again</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ================= WALKTHROUGH ================= */}
      {tourStep !== null && (
        <View style={StyleSheet.absoluteFill}>
          <Spotlight rect={spot} />
          <View
            style={[
              s.tip,
              spot && spot.y + spot.height / 2 < rootH / 2
                ? { top: spot.y + spot.height + 20 }
                : spot
                  ? { bottom: rootH - spot.y + 20 }
                  : { top: rootH * 0.3 },
            ]}
          >
            <View style={s.tipHead}>
              <Text style={s.tipCount}>{`${tourStep + 1} OF ${TOUR.length}`}</Text>
              {tourStep < TOUR.length - 1 && (
                <Pressable hitSlop={10} onPress={() => endTour(false)}><Text style={s.tipSkip}>Skip</Text></Pressable>
              )}
            </View>
            <Text style={s.tipTitle}>{TOUR[tourStep].title}</Text>
            <Text style={s.tipBody}>{TOUR[tourStep].body}</Text>
            {tourStep < TOUR.length - 1 ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {tourStep > 0 && (
                  <Pressable style={[s.btn, { flex: 1 }]} onPress={() => setTourStep(tourStep - 1)}>
                    <Text style={s.btnText}>Back</Text>
                  </Pressable>
                )}
                <Pressable style={[s.btn, s.btnPrimary, { flex: 1 }]} onPress={() => setTourStep(tourStep + 1)}>
                  <Text style={[s.btnText, { color: '#000' }]}>Next</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable style={[s.btn, s.btnPrimary]} onPress={() => endTour(false)}>
                  <Text style={[s.btnText, { color: '#000' }]}>Got it</Text>
                </Pressable>
                <Pressable style={s.btn} onPress={() => endTour(true)}>
                  <Text style={s.btnText}>Got it, don't show again</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      )}

      {/* ================= BUILT-IN TAG SCREEN ================= */}
      {!requestTag && (
        <TagScreen
          uri={tagReq?.uri ?? null}
          counts={tagCounts}
          onTag={(t) => finishTag(t)}
          onCancel={() => finishTag(null)}
        />
      )}

      {busy && !tagReq && !overlayOpen && screen === 'pick' && (
        <View style={[StyleSheet.absoluteFill, s.center]} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Spotlight: dims everything except one rectangle                     */
/* ------------------------------------------------------------------ */

function Spotlight({ rect }: { rect: Rect | null }) {
  if (!rect) return <View style={[StyleSheet.absoluteFill, s.dimHeavy]} />;
  const { x, y, width, height } = rect;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-only">
      <View style={[s.dimHeavy, { position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(0, y) }]} />
      <View style={[s.dimHeavy, { position: 'absolute', left: 0, right: 0, top: y + height, bottom: 0 }]} />
      <View style={[s.dimHeavy, { position: 'absolute', left: 0, width: Math.max(0, x), top: y, height }]} />
      <View style={[s.dimHeavy, { position: 'absolute', left: x + width, right: 0, top: y, height }]} />
      <View style={{ position: 'absolute', left: x, top: y, width, height, borderWidth: 3, borderColor: YELLOW, borderRadius: 16 }} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Built-in tag screen (Home section). Replace with your own via       */
/* the `requestTag` prop to keep Inspection / Measure / Roofline tabs. */
/* ------------------------------------------------------------------ */

function TagScreen({
  uri,
  counts,
  onTag,
  onCancel,
}: {
  uri: string | null;
  counts: Record<string, number>;
  onTag: (tag: string) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [uri]);
  const slots = HOME_LAYOUT.flat().filter((t): t is string => !!t && (counts[t] || 0) > 0).length;

  return (
    <Modal visible={!!uri} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[t.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={t.header}>
          <Pressable hitSlop={16} onPress={onCancel} accessibilityLabel="Close without saving">
            <Text style={s.icon}>✕</Text>
          </Pressable>
          <Text style={t.title}>Tag Photo</Text>
          <Text style={t.count}>{`${slots}/8 HOME SLOTS`}</Text>
        </View>

        <Pressable style={t.photo} onPress={() => setExpanded(true)} accessibilityLabel="Expand photo">
          {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
          <Text style={t.photoHintL}>Tag this photo below</Text>
          <Text style={t.photoHintR}>TAP TO EXPAND</Text>
          <Pressable style={t.trash} hitSlop={10} onPress={onCancel} accessibilityLabel="Delete photo">
            <Text style={t.trashText}>Delete</Text>
          </Pressable>
        </Pressable>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Text style={t.lbl}>↑ ↑  BACK OF HOME</Text>
          {HOME_LAYOUT.map((row, r) => (
            <View key={r} style={t.row}>
              {row.map((name, c) =>
                name ? (
                  <Pressable key={name} style={[t.btn, (counts[name] || 0) > 0 && t.btnOn]} onPress={() => onTag(name)}>
                    <Text style={t.btnText} numberOfLines={1}>{name}</Text>
                    {(counts[name] || 0) > 1 && (
                      <View style={t.badge}><Text style={t.badgeText}>{counts[name]}</Text></View>
                    )}
                  </Pressable>
                ) : (
                  <View key={`c${c}`} style={[t.btn, t.home]}><Text style={t.homeText}>HOME</Text></View>
                ),
              )}
            </View>
          ))}
          <Text style={t.lbl}>↓ ↓  FRONT OF HOME (road)</Text>
          <Pressable style={t.extra} onPress={() => onTag('Extra')}>
            <Text style={t.extraText}>+  Tag as Extra</Text>
          </Pressable>
        </ScrollView>

        {expanded && uri && (
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} onPress={() => setExpanded(false)} accessibilityLabel="Close expanded photo">
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  msg: { color: '#fff', fontSize: 16, textAlign: 'center', paddingHorizontal: 32 },
  link: { color: '#98989d', fontSize: 15, textAlign: 'center' },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 12 },
  icon: { color: '#fff', fontSize: 22, fontWeight: '600' },
  topLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },

  preview: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  recPill: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: RED, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  recText: { color: '#fff', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  countdown: { color: '#fff', fontSize: 120, fontWeight: '200', textShadowColor: 'rgba(0,0,0,.6)', textShadowRadius: 12 },
  pill: { position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: 'rgba(30,30,32,.75)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  pillText: { color: '#fff', fontSize: 15, fontWeight: '500' },

  bottom: { paddingTop: 12, backgroundColor: '#000' },
  zoomRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 14 },
  zoomBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#262628', alignItems: 'center', justifyContent: 'center' },
  zoomBtnOn: { backgroundColor: '#353537', borderWidth: 1, borderColor: '#4a4a4d' },
  zoomText: { color: '#ececec', fontSize: 13, fontWeight: '500' },
  modes: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 14, alignSelf: 'center' },
  modeBtn: { minWidth: 70, paddingVertical: 6, alignItems: 'center' },
  modeText: { color: '#8e8e93', fontSize: 16, fontWeight: '600', letterSpacing: 0.5 },

  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  side: { width: 90 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  core: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  txtBtn: { color: '#fff', fontSize: 18, fontWeight: '500' },

  scrub: { marginHorizontal: 24, marginBottom: 18, borderRadius: 24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 16, backgroundColor: 'rgba(48,48,52,.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,.14)' },
  scrubTimes: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  scrubTime: { color: '#fff', fontSize: 17, fontWeight: '500', fontVariant: ['tabular-nums'] },
  bar: { height: 16, borderRadius: 8, backgroundColor: '#737a93', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#e8eaf3' },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: YELLOW },

  tray: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 110, backgroundColor: 'rgba(0,0,0,.55)' },
  trayContent: { alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  thumb: { width: 66, height: 80, borderRadius: 9, overflow: 'hidden', borderWidth: 2, borderColor: '#fff', backgroundColor: '#222' },
  thumbLabel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 2, backgroundColor: 'rgba(0,0,0,.6)' },
  thumbLabelText: { color: '#fff', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  thumbX: { position: 'absolute', right: 0, top: 0, width: 24, height: 24, borderBottomLeftRadius: 8, backgroundColor: 'rgba(0,0,0,.6)', alignItems: 'center', justifyContent: 'center' },
  thumbXText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingVertical: 8 },
  gridItem: { width: '48.5%', aspectRatio: 804 / 948, borderRadius: 8, overflow: 'hidden', backgroundColor: '#222' },
  gridTag: { position: 'absolute', left: 6, bottom: 6, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(0,0,0,.6)' },
  gridTagText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  summary: { color: '#d1d1d6', fontSize: 15, textAlign: 'center', paddingHorizontal: 24, paddingVertical: 14 },

  dim: { backgroundColor: 'rgba(0,0,0,.66)' },
  dimHeavy: { backgroundColor: 'rgba(0,0,0,.76)' },
  dlg: { width: '86%', borderRadius: 22, padding: 24, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: '#3a3a3c' },
  eyebrow: { color: YELLOW, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  dlgTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 6, marginBottom: 8 },
  dlgBody: { color: '#c7c7cc', fontSize: 16, lineHeight: 22, marginBottom: 16 },
  btn: { height: 50, borderRadius: 25, backgroundColor: '#3a3a3c', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnPrimary: { backgroundColor: YELLOW },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600' },

  tip: { position: 'absolute', left: '7%', right: '7%', borderRadius: 20, padding: 20, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: '#3a3a3c' },
  tipHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tipCount: { color: '#98989d', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  tipSkip: { color: '#c7c7cc', fontSize: 15 },
  tipTitle: { color: '#fff', fontSize: 21, fontWeight: '700', marginTop: 4, marginBottom: 6 },
  tipBody: { color: '#c7c7cc', fontSize: 15, lineHeight: 21, marginBottom: 12 },
});

const t = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1f1a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2a3a36' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  count: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  photo: { height: 180, backgroundColor: '#000' },
  photoHintL: { position: 'absolute', left: 12, bottom: 10, color: '#fff', fontSize: 14, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 6 },
  photoHintR: { position: 'absolute', right: 12, bottom: 12, color: '#cfd4d2', fontSize: 12, fontWeight: '700', letterSpacing: 1, textShadowColor: '#000', textShadowRadius: 6 },
  trash: { position: 'absolute', right: 10, top: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,.6)' },
  trashText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  lbl: { color: '#b7bcbb', fontSize: 15, fontWeight: '700', textAlign: 'center', marginVertical: 4 },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, height: 56, borderRadius: 10, borderWidth: 1, borderColor: '#29423d', backgroundColor: '#0b2822', alignItems: 'center', justifyContent: 'center' },
  btnOn: { borderColor: GREEN, backgroundColor: '#10381f' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  badge: { position: 'absolute', right: 4, top: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#06210f', fontSize: 11, fontWeight: '700' },
  home: { borderWidth: 0, backgroundColor: 'transparent' },
  homeText: { color: '#2c403b', fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  extra: { marginTop: 8, height: 52, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#3f8f1c', alignItems: 'center', justifyContent: 'center' },
  extraText: { color: GREEN, fontSize: 16, fontWeight: '500' },
});
