import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { WebView } from 'react-native-webview';
import ReactNativeBlobUtil from 'react-native-blob-util';

const WebViewComponent = WebView as any;
import { useTheme } from '../../../theme/ThemeProvider';
import { useVoiceNote, formatMs } from '../../../hooks/useVoiceNote';

// In-memory cache: signed URI → local path (for native formats)
const localFileCache: Record<string, string> = {};

/** Returns true if the URI or mimeType is WebM format */
function detectWebm(uri: string, mimeType?: string): boolean {
  if (mimeType && (mimeType.includes('webm') || mimeType.includes('ogg') || mimeType.includes('opus'))) return true;
  return uri.split('?')[0].toLowerCase().endsWith('.webm');
}

export function VoiceNotePlayer({
  uri,
  isMe,
  isPinned,
  maxBubbleWidth,
  mimeType,
}: {
  uri: string;
  isMe: boolean;
  isPinned: boolean;
  maxBubbleWidth: number;
  mimeType?: string;
}) {
  const { colors } = useTheme();
  const [speed, setSpeed] = useState(1);
  const [isDownloading, setIsDownloading] = useState(false);

  // ── nitro-sound (M4A, MP3, WAV, local files) ────────────────────────────────
  const {
    playbackState,
    playbackPos,
    playbackDuration,
    startPlayback,
    pausePlayback,
    setPlaybackSpeed,
  } = useVoiceNote();

  // ── react-native-webview (WebM / unsupported fallback) ──────────────────────
  const webviewRef = useRef<any>(null);
  const [videoUri, setVideoUri]         = useState<string | null>(null);
  const [videoPaused, setVideoPaused]   = useState(true);
  const [videoPos, setVideoPos]         = useState(0);          // ms
  const [videoDuration, setVideoDuration] = useState(0);        // ms
  const [videoError, setVideoError]     = useState<string | null>(null);

  // ── Derived state ────────────────────────────────────────────────────────────
  const isRemote   = typeof uri === 'string' && (uri.startsWith('http://') || uri.startsWith('https://'));
  const isWebm     = detectWebm(uri, mimeType);
  const usingVideo = !!videoUri;

  const isPlaying  = usingVideo ? !videoPaused : playbackState === 'playing';
  const isPaused   = usingVideo ? (videoPaused && videoPos > 0) : playbackState === 'paused';
  const currentPos = usingVideo ? videoPos : playbackPos;
  const totalDur   = usingVideo ? videoDuration : playbackDuration;
  const progress   = totalDur > 0 ? currentPos / totalDur : 0;

  // ── WebM: stream directly via WebView using the signed URL ───────────────────
  const playAsVideo = useCallback(() => {
    setVideoError(null);
    if (videoUri === uri) {
      // Toggle pause state
      const nextPaused = !videoPaused;
      setVideoPaused(nextPaused);
      webviewRef.current?.injectJavaScript(`
        var p = document.getElementById('player');
        if (p) { if (${nextPaused}) p.pause(); else p.play(); }
        true;
      `);
    } else {
      // Init stream
      setVideoUri(uri);
      setVideoPaused(false);
      setVideoPos(0);
      setVideoDuration(0);
    }
  }, [uri, videoUri, videoPaused]);

  // ── Native formats: download then play via nitro-sound ───────────────────────
  const downloadAndPlayNative = useCallback(async () => {
    try {
      if (localFileCache[uri]) {
        console.log('[VNP] Cache hit:', localFileCache[uri]);
        await startPlayback(localFileCache[uri]);
        return;
      }

      setIsDownloading(true);
      console.log('[VNP] ⬇️  Downloading native audio...');

      const tempPath = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/vnp_tmp_${Date.now()}`;
      const res = await ReactNativeBlobUtil.config({ path: tempPath, fileCache: false }).fetch('GET', uri, {
        'Accept-Encoding': 'identity',
      });

      const status  = res.info().status;
      const headers = res.info().headers ?? {};
      const ct      = String(headers['Content-Type'] ?? headers['content-type'] ?? '').toLowerCase();

      if (status !== 200) {
        await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
        throw new Error(`HTTP ${status}`);
      }

      const stat = await ReactNativeBlobUtil.fs.stat(tempPath);
      if (!stat || stat.size === 0) {
        await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
        throw new Error('Downloaded file is empty');
      }

      // If it turns out to be WebM from the content-type, switch to Webview player
      if (ct.includes('webm') || ct.includes('ogg') || ct.includes('opus')) {
        await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
        console.log('[VNP] WebM detected in Content-Type — switching to Webview player');
        playAsVideo();
        return;
      }

      // Determine file extension
      let ext = 'm4a';
      if (ct.includes('m4a') || ct.includes('x-m4a') || ct.includes('mp4') || ct.includes('aac')) {
        ext = 'm4a';
      } else if (ct.includes('mpeg') || ct.includes('mp3')) {
        ext = 'mp3';
      } else if (ct.includes('wav')) {
        ext = 'wav';
      } else {
        const mt = (mimeType ?? '').toLowerCase();
        if (mt.includes('m4a') || mt.includes('x-m4a') || mt.includes('mp4') || mt.includes('aac')) ext = 'm4a';
        else if (mt.includes('mp3') || mt.includes('mpeg')) ext = 'mp3';
        else if (mt.includes('wav')) ext = 'wav';
        else {
          const urlExt = uri.split('?')[0].toLowerCase().split('.').pop() ?? '';
          if (['m4a', 'aac', 'mp3', 'wav', 'caf'].includes(urlExt)) ext = urlExt;
        }
      }

      const finalPath = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/vnp_${Date.now()}.${ext}`;
      await ReactNativeBlobUtil.fs.mv(tempPath, finalPath);

      localFileCache[uri] = finalPath;
      await startPlayback(finalPath);
    } catch (err: any) {
      console.error('[VNP] ❌ Error:', err?.message ?? err);
    } finally {
      setIsDownloading(false);
    }
  }, [uri, mimeType, startPlayback, playAsVideo]);

  // ── Main press handler ───────────────────────────────────────────────────────
  const handlePress = useCallback(() => {
    if (isDownloading) return;

    if (usingVideo) {
      playAsVideo();
      return;
    }

    if (isPlaying) {
      pausePlayback();
      return;
    }

    if (!isRemote) {
      startPlayback(uri);
      return;
    }

    if (isWebm) {
      console.log('[VNP] WebM → streaming via WebView');
      playAsVideo();
    } else {
      console.log('[VNP] Native format → download + nitro-sound');
      downloadAndPlayNative();
    }
  }, [
    isDownloading, usingVideo, isPlaying, isRemote, isWebm,
    uri, playAsVideo, downloadAndPlayNative, pausePlayback, startPlayback,
  ]);

  const toggleSpeed = useCallback(() => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (!usingVideo) setPlaybackSpeed(next);
    else if (webviewRef.current) {
      webviewRef.current.injectJavaScript(`
        var p = document.getElementById('player');
        if (p) p.playbackRate = ${next};
        true;
      `);
    }
  }, [speed, usingVideo, setPlaybackSpeed]);

  const tintColor   = isPinned ? '#222' : isMe ? '#fff' : colors.primary.main;
  const showLoading = isDownloading || playbackState === 'loading';

  return (
    <View
      className="flex-row items-center p-2 rounded-xl"
      style={{
        backgroundColor: isPinned
          ? 'rgba(0,0,0,0.05)'
          : isMe
          ? 'rgba(255,255,255,0.1)'
          : 'rgba(0,0,0,0.05)',
        width: 240,
        maxWidth: '100%',
      }}
    >
      <View style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}>
        {videoUri && (
          <WebViewComponent
            ref={webviewRef}
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>body { background-color: transparent; margin: 0; padding: 0; }</style>
                </head>
                <body>
                  <audio id="player" src="${videoUri}" autoplay playsinline></audio>
                  <script>
                    var player = document.getElementById('player');
                    player.onplay = function() { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'play' })); };
                    player.onpause = function() { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pause' })); };
                    player.ontimeupdate = function() { 
                      window.ReactNativeWebView.postMessage(JSON.stringify({ 
                        type: 'progress', 
                        currentTime: player.currentTime, 
                        duration: player.duration 
                      })); 
                    };
                    player.onloadedmetadata = function() { 
                      window.ReactNativeWebView.postMessage(JSON.stringify({ 
                        type: 'loaded', 
                        duration: player.duration 
                      })); 
                    };
                    player.onended = function() { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'end' })); };
                    player.onerror = function() { 
                      window.ReactNativeWebView.postMessage(JSON.stringify({ 
                        type: 'error', 
                        code: player.error ? player.error.code : 'unknown' 
                      })); 
                    };
                  </script>
                </body>
                </html>
              `
            }}
            onMessage={(event: any) => {
              try {
                const data = JSON.parse(event.nativeEvent.data);
                if (data.type === 'progress') {
                  if (data.duration && !isNaN(data.duration)) setVideoDuration(data.duration * 1000);
                  if (data.currentTime) setVideoPos(data.currentTime * 1000);
                } else if (data.type === 'loaded') {
                  if (data.duration && !isNaN(data.duration)) setVideoDuration(data.duration * 1000);
                } else if (data.type === 'end') {
                  setVideoPaused(true);
                  setVideoPos(0);
                } else if (data.type === 'error') {
                  console.warn('[VNP] WebView audio error code:', data.code);
                  setVideoError('Cannot play this audio format');
                  setVideoUri(null);
                }
              } catch (e) {}
            }}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback={true}
            style={{ width: 1, height: 1 }}
          />
        )}
      </View>

      <TouchableOpacity 
        onPress={handlePress} 
        className="items-center justify-center"
        style={{ width: 40, marginRight: 8 }}
        disabled={showLoading}
      >
        {showLoading ? (
          <ActivityIndicator size="small" color={tintColor} />
        ) : (
          <Icon name={isPlaying ? 'pause' : 'play'} size={30} color={tintColor} />
        )}
      </TouchableOpacity>

      <View className="flex-1">
        <View
          className="h-1 rounded-full overflow-hidden"
          style={{
            backgroundColor: isPinned
              ? 'rgba(0,0,0,0.1)'
              : isMe
              ? 'rgba(255,255,255,0.2)'
              : '#D1D7DB',
          }}
        >
          <View
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              backgroundColor: videoError ? '#aaa' : tintColor,
            }}
          />
        </View>
        <View className="flex-row justify-between items-center mt-1">
          <Text
            className="text-[9px] font-bold"
            numberOfLines={1}
            style={{
              color: isPinned ? '#666' : isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary,
              minWidth: 55, // Prevent shifting when duration expands
            }}
          >
            {videoError
              ? videoError
              : isPlaying || isPaused
              ? `${formatMs(currentPos)} / ${formatMs(totalDur)}`
              : formatMs(totalDur || 0)}
          </Text>
          {!videoError && (
            <TouchableOpacity onPress={toggleSpeed} className="px-1.5 py-0.5 rounded-md bg-black/10">
              <Text className="text-[9px] font-bold" style={{ color: tintColor }}>
                {speed}x
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
