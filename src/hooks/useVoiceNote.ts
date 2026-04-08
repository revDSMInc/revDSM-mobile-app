import { useState, useRef, useCallback, useEffect } from 'react';
import AudioRecorderPlayer, {
  AudioSourceAndroidType,
  OutputFormatAndroidType,
  AudioEncoderAndroidType,
  AVEncoderAudioQualityIOSType,
} from 'react-native-audio-recorder-player';
import type { AudioSet, PlayBackType, RecordBackType } from 'react-native-audio-recorder-player';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import RNFS from 'react-native-fs';

// The library exports a pre-created singleton instance (not a class).
// We reference it directly — no instantiation needed.
const player = AudioRecorderPlayer;

export type RecordingState = 'idle' | 'recording' | 'recorded';
export type PlaybackState = 'idle' | 'playing' | 'paused';

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
  stopPlayback: () => Promise<void>;
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

  const requestMicPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Microphone Permission',
          message: 'revDSM needs the microphone to record voice notes.',
          buttonPositive: 'Allow',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true; // iOS prompts on first use via NSMicrophoneUsageDescription
  };

  // ─── Recording ───────────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Microphone access is required to record voice notes.');
      return;
    }

    setRecordingTime(0);
    setRecordingState('recording');

    // Use absolute path in Caches directory to ensure write permissions
    const extension = Platform.OS === 'ios' ? 'm4a' : 'mp4';
    const filename = `voice_${Date.now()}.${extension}`;
    const path = `${RNFS.CachesDirectoryPath}/${filename}`;

    const audioSet: AudioSet = {
      // Android
      AudioSourceAndroid: AudioSourceAndroidType.MIC,
      OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
      AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
      // iOS
      AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
      AVNumberOfChannelsKeyIOS: 2,
      AVFormatIDKeyIOS: 'aac',
    };

    await player.startRecorder(path, audioSet);

    timerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
  }, []);

  const stopRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const uri = await player.stopRecorder();
    player.removeRecordBackListener();
    setRecordedUri(uri);
    setRecordingState('recorded');
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
    setPlaybackState('playing');
    await player.startPlayer(uri);

    player.addPlayBackListener((e: PlayBackType) => {
      setPlaybackPos(e.currentPosition);
      setPlaybackDuration(e.duration);
    });

    player.addPlaybackEndListener(() => {
      setPlaybackState('idle');
      setPlaybackPos(0);
      player.removePlayBackListener();
      player.removePlaybackEndListener();
    });
  }, []);

  const pausePlayback = useCallback(async () => {
    await player.pausePlayer();
    setPlaybackState('paused');
  }, []);

  const stopPlayback = useCallback(async () => {
    await player.stopPlayer();
    player.removePlayBackListener();
    player.removePlaybackEndListener();
    setPlaybackState('idle');
    setPlaybackPos(0);
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
    stopPlayback,
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
