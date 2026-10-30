import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Video, { type VideoRef } from 'react-native-video';
import { extractVideoFrame } from '../../utils/video-frame';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FRAME_PICKER_FPS,
  formatClipLength,
  formatScrubTime,
  scrubFraction,
  snapFrameTime,
} from '../../utils/camera-video';

const YELLOW = '#F8D34A';
const FRAME_MAX_PX = 4096; // keep full resolution (the library default is 512)

/** What the host's tag screen resolves with. `target` is opaque to the picker: the host reads it back on commit. */
export interface FrameTag {
  label: string;
  target: unknown;
}

export interface PickedFrame extends FrameTag {
  uri: string;
  fileName: string;
  type: 'image/jpeg';
  width?: number;
  height?: number;
}

interface Shot extends FrameTag {
  id: string;
  t: number;
  uri: string;
  width?: number;
  height?: number;
}

interface Props {
  clipUri: string;
  clipDuration: number;
  /** Open the host's tag screen for this frame. Resolve null when the user deletes the frame instead of tagging it. */
  requestTag: (uri: string, queued: FrameTag[]) => Promise<FrameTag | null>;
  /** The kept frames, each already copied to durable storage. The video file is deleted before this is called. */
  onDone: (frames: PickedFrame[]) => void;
  /** Throw the clip and every frame away. */
  onDiscard: () => void;
}

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const toUri = (p: string) => (/^(file|content|ph):\/\//.test(p) ? p : `file://${p}`);
const stripScheme = (p: string) => p.replace(/^file:\/\//, '');

/**
 * Record-then-pick: scrub a recorded clip with the bar, save any frame as a photo, tag it through the host, repeat.
 * Done shows a grid of the kept frames; confirming it hands them back and deletes the video (only photos are kept).
 * An in-card overlay, never a native Modal (see the Modal rules in CLAUDE.md §6).
 */
export const VideoFramePicker = ({ clipUri, clipDuration, requestTag, onDone, onDiscard }: Props) => {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<'pick' | 'review'>('pick');
  const [duration, setDuration] = useState(Math.max(clipDuration, 1 / FRAME_PICKER_FPS));
  const [pickerT, setPickerT] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // Shown in the pill over the video: a flash raised from here can sit behind the camera overlay and never be seen.
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current); }, []);

  const videoRef = useRef<VideoRef>(null);
  const durRef = useRef(duration);
  durRef.current = duration;
  const seekTarget = useRef<number | null>(null);
  const seekRaf = useRef<number | null>(null);
  const trayRef = useRef<ScrollView>(null);
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(
    () => () => {
      if (seekRaf.current != null) cancelAnimationFrame(seekRaf.current);
    },
    [],
  );

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
    barRef.current?.measure((_x, _y, w, _h, pageX) => {
      barBox.current = { x: pageX, w: w || 1 };
    });
  const seekToPageX = (pageX: number) => {
    const p = scrubFraction(pageX, barBox.current.x, barBox.current.w);
    seekTo(snapFrameTime(p * durRef.current, durRef.current));
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          measureBar();
          seekToPageX(e.nativeEvent.pageX);
        },
        onPanResponderMove: (e) => seekToPageX(e.nativeEvent.pageX),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const doFlash = () => {
    flash.setValue(0.85);
    Animated.timing(flash, { toValue: 0, duration: 350, useNativeDriver: true }).start();
  };

  const captureFrame = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const at = pickerT;
    try {
      const th = await extractVideoFrame({
        url: clipUri,
        timeStamp: Math.round(at * 1000),
        format: 'jpeg',
        maxWidth: FRAME_MAX_PX,
        maxHeight: FRAME_MAX_PX,
        cacheName: `frame_${uid()}`,
        onlySyncedFrames: false, // needs the Android patch (patches/react-native-create-thumbnail+2.2.0.patch)
      });
      doFlash();
      const uri = toUri(th.path);
      const tag = await requestTag(uri, shots.map(({ label, target }) => ({ label, target })));
      if (tag) {
        setShots((s) => [...s, { id: uid(), t: at, uri, label: tag.label, target: tag.target, width: th.width, height: th.height }]);
        setTimeout(() => trayRef.current?.scrollToEnd({ animated: true }), 50);
      }
    } catch (e) {
      console.warn('[VideoFramePicker] could not save frame:', e);
      setError(e instanceof Error ? e.message : 'Could not save that frame');
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(null), 6000);
    } finally {
      setBusy(false);
    }
  };

  const removeShot = (id: string) => setShots((list) => list.filter((x) => x.id !== id));

  const deleteVideo = async () => {
    try {
      await ReactNativeBlobUtil.fs.unlink(stripScheme(clipUri));
    } catch {
      // best effort: it lives in the cache / tmp dir either way
    }
  };

  const discard = () => {
    deleteVideo();
    onDiscard();
  };

  const finish = async () => {
    if (saving || !shots.length) return;
    setSaving(true);
    const fs = ReactNativeBlobUtil.fs;
    const dir = `${fs.dirs.DocumentDir}/pending_uploads`;
    const out: PickedFrame[] = [];
    try {
      if (!(await fs.exists(dir))) await fs.mkdir(dir);
    } catch {
      // fall back to the cache path below
    }
    for (const sh of shots) {
      let path = stripScheme(sh.uri);
      try {
        const dest = `${dir}/${Date.now()}_${sh.id}.jpg`;
        // eslint-disable-next-line no-await-in-loop
        await fs.cp(path, dest);
        path = dest;
      } catch (e) {
        console.warn('[VideoFramePicker] could not persist frame, using cache path:', e);
      }
      out.push({
        uri: `file://${path}`,
        fileName: path.split('/').pop() || `frame_${Date.now()}.jpg`,
        type: 'image/jpeg',
        width: sh.width,
        height: sh.height,
        label: sh.label,
        target: sh.target,
      });
    }
    await deleteVideo();
    setSaving(false);
    onDone(out);
  };

  const n = shots.length;
  const photosWord = (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      {screen === 'pick' ? (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable hitSlop={16} onPress={discard} accessibilityLabel="Discard video">
              <Text style={styles.icon}>✕</Text>
            </Pressable>
            <Text style={styles.title}>Capture Photos</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.preview}>
            <Video
              ref={videoRef}
              source={{ uri: clipUri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              paused
              muted
              repeat={false}
              onLoad={(d) => {
                if (d.duration > 0) setDuration(d.duration);
                videoRef.current?.seek(0);
              }}
            />
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />
            <View style={[styles.pill, error ? { backgroundColor: 'rgba(211,47,47,.92)', maxWidth: '90%' } : null]} pointerEvents="none">
              <Text style={styles.pillText}>{error ?? (n === 0 ? 'Drag the slider, then tap capture' : `${photosWord(n)} captured`)}</Text>
            </View>

            {n > 0 && (
              <ScrollView ref={trayRef} horizontal showsHorizontalScrollIndicator={false} style={styles.tray} contentContainerStyle={styles.trayContent}>
                {shots.map((sh) => (
                  <Pressable key={sh.id} style={styles.thumb} onPress={() => seekTo(sh.t)} accessibilityLabel={`Photo tagged ${sh.label}`}>
                    <Image source={{ uri: sh.uri }} style={StyleSheet.absoluteFill} />
                    <View style={styles.thumbLabel}>
                      <Text style={styles.thumbLabelText} numberOfLines={1}>{sh.label}</Text>
                    </View>
                    <Pressable style={styles.thumbX} hitSlop={6} onPress={() => removeShot(sh.id)} accessibilityLabel="Remove photo">
                      <Text style={styles.thumbXText}>✕</Text>
                    </Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {busy && (
              <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
                <ActivityIndicator color="#fff" size="large" />
              </View>
            )}
          </View>

          <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.scrub} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Video position">
              <View style={styles.scrubTimes}>
                <Text style={styles.scrubTime}>{formatScrubTime(pickerT)}</Text>
                <Text style={styles.scrubTime}>{formatClipLength(duration)}</Text>
              </View>
              <View ref={barRef} style={styles.bar} onLayout={measureBar}>
                <View style={[styles.fill, { width: `${(pickerT / duration) * 100}%` }]} />
                {shots.map((sh) => (
                  <View key={sh.id} style={[styles.tick, { left: `${(sh.t / duration) * 100}%` }]} />
                ))}
              </View>
            </View>

            <View style={styles.shutterRow}>
              <Pressable style={styles.side} onPress={discard}>
                <Text style={styles.txtBtn}>Retake</Text>
              </Pressable>
              <Pressable onPress={captureFrame} disabled={busy} style={[styles.shutter, busy && { opacity: 0.6 }]} accessibilityLabel="Save this frame as a photo">
                <View style={styles.core} />
              </Pressable>
              <Pressable style={[styles.side, { alignItems: 'flex-end' }]} disabled={n === 0} onPress={() => setScreen('review')}>
                <Text style={[styles.txtBtn, { color: n ? YELLOW : '#5c5c61', fontWeight: '600' }]}>{n ? `Done (${n})` : 'Done'}</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + 8, justifyContent: 'center' }]}>
            <Text style={styles.title}>{`${n} ${n === 1 ? 'Photo' : 'Photos'} Added`}</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.grid}>
            {shots.map((sh) => (
              <View key={sh.id} style={styles.gridItem}>
                <Image source={{ uri: sh.uri }} style={StyleSheet.absoluteFill} />
                <View style={styles.gridTag}>
                  <Text style={styles.gridTagText}>{sh.label}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.summary}>The video is discarded. Only these photos are kept.</Text>
          <View style={[styles.shutterRow, { paddingBottom: insets.bottom + 24 }]}>
            <Pressable onPress={() => setScreen('pick')} disabled={saving}>
              <Text style={styles.txtBtn}>Back</Text>
            </Pressable>
            <Pressable onPress={finish} disabled={saving}>
              {saving ? <ActivityIndicator color={YELLOW} /> : <Text style={[styles.txtBtn, { color: YELLOW, fontWeight: '600' }]}>Done</Text>}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 12 },
  icon: { color: '#fff', fontSize: 22, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  pill: { position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: 'rgba(30,30,32,.75)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  pillText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  bottom: { paddingTop: 12, backgroundColor: '#000' },
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
  tray: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 110 },
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
});
