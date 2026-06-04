import { useState, useRef, useCallback, useEffect } from 'react';
import Sound, {
  AudioSourceAndroidType,
  OutputFormatAndroidType,
  AudioEncoderAndroidType,
  AVEncoderAudioQualityIOSType,
} from 'react-native-nitro-sound';
import type { AudioSet, PlayBackType } from 'react-native-nitro-sound';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import RNFS from 'react-native-fs';

// The library exports a pre-created singleton instance (not a class).
// We reference it directly — no instantiation needed.
const player = Sound;

export type RecordingState = 'idle' | 'recording' | 'recorded';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface VoiceNoteHookResult {
  recordingState: RecordingState;
  recordingTime: number; // seconds elapsed
  recordedUri: string | null; // local file URI after recording
  playbackState: PlaybackState;
  playbackPos: number; // ms
  playbackDuration: number; // ms
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => void;
  startPlayback: (uri: string) => Promise<void>;
  pausePlayback: () => Promise<void>;
  resumePlayback: () => Promise<void>;
  stopPlayback: () => Promise<void>;
  setPlaybackSpeed: (speed: number) => Promise<void>;
  reset: () => void;
}

export function useVoiceNote(): VoiceNoteHookResult {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [playbackPos, setPlaybackPos] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const permissionGrantedRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      player.stopRecorder().catch(() => {});
      player.stopPlayer().catch(() => {});
      player.removeRecordBackListener();
      player.removePlayBackListener();
      player.removePlaybackEndListener();
    };
  }, []);

  // ─── Permissions ─────────────────────────────────────────────────────────────

  const ensureMicPermission = useCallback(async (): Promise<boolean> => {
    if (permissionGrantedRef.current) return true;
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'revDSM needs the microphone to record voice notes.',
            buttonPositive: 'Allow',
          }
        );
        const result = granted === PermissionsAndroid.RESULTS.GRANTED;
        permissionGrantedRef.current = result;
        return result;
      } catch {
        return false;
      }
    }
    // iOS prompts on first use via NSMicrophoneUsageDescription
    permissionGrantedRef.current = true;
    return true;
  }, []);

  // ─── Recording ───────────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    // Permission check only once per session — cached in ref after first call
    const hasPermission = await ensureMicPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Microphone access is required to record voice notes.');
      return;
    }

    setRecordingTime(0);
    setRecordingState('recording');

    // Use absolute path in Caches directory to ensure write permissions.
    // NOTE: Do NOT include file:// in the recorder path — the native recorder
    // expects a plain filesystem path. We add the prefix only after stopping.
    const extension = Platform.OS === 'ios' ? 'm4a' : 'mp4';
    const filename = `voice_${Date.now()}.${extension}`;
    const path = `${RNFS.CachesDirectoryPath}/${filename}`;

    const audioSet: AudioSet = {
      // Android
      AudioSourceAndroid: AudioSourceAndroidType.MIC,
      OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
      AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
      // iOS — mono channel, high quality AAC
      AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
      AVNumberOfChannelsKeyIOS: 1,
      AVFormatIDKeyIOS: 'aac',
    };

    currentPathRef.current = path;
    await player.startRecorder(path, audioSet);

    timerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
  }, [ensureMicPermission]);

  const stopRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // IMPORTANT: await stopRecorder() BEFORE updating state.
    // In production (Hermes), setting state optimistically and reading the file
    // immediately after caused crashes because the native layer hadn't finished
    // flushing the file to disk. The user could tap Send on an incomplete file.
    try {
      const nativeUri = await player.stopRecorder();
      player.removeRecordBackListener();

      // Determine the resolved path — prefer native return value if it includes a slash
      let resolved: string | null =
        nativeUri && nativeUri.includes('/') ? nativeUri : (currentPathRef.current ?? null);

      // On iOS production builds, React Native's networking stack (used by FormData)
      // requires a file:// prefix for local file URIs. Debug builds are more lenient.
      if (Platform.OS === 'ios' && resolved && !resolved.startsWith('file://')) {
        resolved = `file://${resolved}`;
      }

      console.log('[VoiceNote] Recording finalized:', resolved);
      setRecordedUri(resolved);
      setRecordingState('recorded');
    } catch (e) {
      console.warn('[VoiceNote] stopRecorder error:', e);
      // Revert to idle on failure so the user can try again
      setRecordingState('idle');
      setRecordingTime(0);
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    player.stopRecorder().catch(() => {});
    player.removeRecordBackListener();
    setRecordingState('idle');
    setRecordingTime(0);
    setRecordedUri(null);
  }, []);

  // ─── Playback ─────────────────────────────────────────────────────────────────

  const startPlayback = useCallback(async (uri: string) => {
    if (!uri) return;
    try {
      setPlaybackState('loading');

      // Normalize: nitro-sound on iOS requires a plain absolute path (no file:// prefix)
      let finalPath = uri;

      // Strip file:// prefix if present
      if (finalPath.startsWith('file://')) {
        finalPath = decodeURIComponent(finalPath.replace('file://', ''));
        // Ensure leading slash
        if (!finalPath.startsWith('/')) {
          finalPath = '/' + finalPath;
        }
      }

      // If it's a bare filename (no slashes), resolve to CacheDir
      if (!finalPath.includes('/')) {
        finalPath = `${RNFS.CachesDirectoryPath}/${finalPath}`;
      }

      console.log('[useVoiceNote] Playing local path:', finalPath);
      await player.startPlayer(finalPath);
      setPlaybackState('playing');

      player.addPlayBackListener((e: PlayBackType) => {
        setPlaybackPos(e.currentPosition);
        setPlaybackDuration(e.duration);
        if (e.currentPosition === e.duration) {
          stopPlayback();
        }
      });
    } catch (e) {
      console.warn('Playback start error:', e);
      setPlaybackState('idle'); // revert to idle if loading fails
    }
  }, []);

  const pausePlayback = useCallback(async () => {
    try {
      await player.pausePlayer();
      setPlaybackState('paused');
    } catch (e) {
      console.warn('Pause error:', e);
    }
  }, []);

  const resumePlayback = useCallback(async () => {
    try {
      await player.resumePlayer();
      setPlaybackState('playing');
    } catch (e) {
      console.warn('Resume error:', e);
    }
  }, []);

  const stopPlayback = useCallback(async () => {
    try {
      await player.stopPlayer();
      player.removePlayBackListener();
      setPlaybackState('idle');
      setPlaybackPos(0);
    } catch (e) {
      console.warn('Stop error:', e);
    }
  }, []);

  const setPlaybackSpeed = useCallback(async (speed: number) => {
    try {
      await player.setPlaybackSpeed(speed);
    } catch (e) {
      console.warn('Speed set failed', e);
    }
  }, []);

  // ─── Reset ────────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    player.stopRecorder().catch(() => {});
    player.stopPlayer().catch(() => {});
    player.removeRecordBackListener();
    player.removePlayBackListener();
    player.removePlaybackEndListener();
    setRecordingState('idle');
    setRecordingTime(0);
    setRecordedUri(null);
    setPlaybackState('idle');
    setPlaybackPos(0);
    setPlaybackDuration(0);
  }, []);

  return {
    recordingState,
    recordingTime,
    recordedUri,
    playbackState,
    playbackPos,
    playbackDuration,
    startRecording,
    stopRecording,
    cancelRecording,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    setPlaybackSpeed,
    reset,
  };
}

/** Seconds → M:SS */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Milliseconds → M:SS */
export function formatMs(ms: number): string {
  return formatTime(Math.floor(ms / 1000));
}
