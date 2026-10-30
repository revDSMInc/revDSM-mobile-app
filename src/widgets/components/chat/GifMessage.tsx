import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, StatusBar, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { gifAspectRatio } from '../../../utils/gif-message';
import { freezeAfterMs, gifStillUrl, parseAnimationDurationMs } from '../../../utils/gif-playback';

// One play's length per url, measured once from the file's own frame delays.
const loopMsCache = new Map<string, number | null>();
const loopMsInFlight = new Map<string, Promise<number | null>>();

// ⚠️ XMLHttpRequest, not fetch().arrayBuffer(): React Native's FileReader has no reliable readAsArrayBuffer. Plain third-party
// request - never the axios wrapper, which would attach the revDSM bearer token.
const measureLoopMs = (url: string): Promise<number | null> => {
  if (loopMsCache.has(url)) return Promise.resolve(loopMsCache.get(url) ?? null);
  const pending = loopMsInFlight.get(url);
  if (pending) return pending;
  const p = new Promise<number | null>((resolve) => {
    const done = (v: number | null) => {
      loopMsCache.set(url, v);
      loopMsInFlight.delete(url);
      resolve(v);
    };
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        try {
          done(xhr.status === 200 && xhr.response ? parseAnimationDurationMs(new Uint8Array(xhr.response)) : null);
        } catch {
          done(null);
        }
      };
      xhr.onerror = () => done(null);
      xhr.ontimeout = () => done(null);
      xhr.timeout = 15000;
      xhr.send();
    } catch {
      done(null);
    }
  });
  loopMsInFlight.set(url, p);
  return p;
};

// Inline GIF for a message whose body is a GIPHY URL. Plays twice, then freezes under a GIF badge (tap to replay).
// While it is animating, a tap opens it full screen. Falls back to the plain link if it fails to load.
export const GifMessage = ({
  url,
  maxWidth,
  onLongPress,
}: {
  url: string;
  maxWidth: number;
  onLongPress?: () => void;
}) => {
  const [ratio, setRatio] = useState(1);
  const [failed, setFailed] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stillFailed, setStillFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [runId, setRunId] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loopMs, setLoopMs] = useState<number | null>(loopMsCache.get(url.trim()) ?? null);
  const width = Math.min(maxWidth, 240);
  const src = url.trim();
  const still = gifStillUrl(src);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    // Measured only when there is a still to freeze on: otherwise it is a second download of the whole file for a
    // deadline nothing uses (see the freeze effect below).
    if (still) {
      measureLoopMs(src).then((ms) => live && setLoopMs(ms));
      Image.prefetch(still).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [src, still]);

  // The clock starts when the frame actually shows (onLoad), not at mount, so a slow download cannot eat the two plays.
  // A late-arriving loop length just moves the deadline; it never restarts the clock.
  // ⚠️ No still ⇒ never freeze. Freezing without one leaves a dark box under the badge, and that is now the common
  // case: a GIF the server stored is served from S3/CloudFront, which has no `_s` rendition. Those keep animating, as
  // every GIF did before the freeze behaviour, until a still can be had for them.
  useEffect(() => {
    if (startedAt === null || stopped || fullscreen || !still) return;
    const remaining = Math.max(0, freezeAfterMs(loopMs) - (Date.now() - startedAt));
    const t = setTimeout(() => mounted.current && setStopped(true), remaining);
    return () => clearTimeout(t);
  }, [startedAt, loopMs, stopped, fullscreen, still]);

  if (failed) {
    return (
      <Pressable onPress={() => Linking.openURL(url).catch(() => {})} onLongPress={onLongPress}>
        <Text style={{ fontSize: 13, color: '#4DA3FF', textDecorationLine: 'underline' }}>{url}</Text>
      </Pressable>
    );
  }

  const replay = () => {
    setStillFailed(false);
    setStartedAt(null);
    setRunId((r) => r + 1); // remounts the <Image>, which restarts the animation from frame 1
    setStopped(false);
  };

  const onPress = () => (stopped ? replay() : setFullscreen(true));

  return (
    <>
      <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={250}>
        <View style={{ width, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.08)' }}>
          {stopped && still && !stillFailed ? (
            <Image
              source={{ uri: still }}
              style={{ width, aspectRatio: ratio }}
              resizeMode="cover"
              onError={() => setStillFailed(true)}
            />
          ) : stopped ? (
            // No still available: drop the animated view so nothing keeps playing behind the badge.
            <View style={{ width, aspectRatio: ratio, backgroundColor: '#1F2937' }} />
          ) : (
            <Image
              key={runId}
              source={{ uri: src }}
              style={{ width, aspectRatio: ratio }}
              resizeMode="cover"
              onLoad={(e) => {
                const { width: w, height: h } = e.nativeEvent.source || ({} as any);
                setRatio(gifAspectRatio(w, h));
                setStartedAt(Date.now());
              }}
              onError={() => setFailed(true)}
            />
          )}
          {stopped && (
            // WhatsApp's frozen-GIF badge: no scrim over the picture, just a translucent grey circle with a bold "GIF".
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  width: 62,
                  height: 62,
                  borderRadius: 31,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(110,110,110,0.82)',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 17, letterSpacing: 1 }}>GIF</Text>
              </View>
            </View>
          )}
        </View>
      </Pressable>
      {fullscreen && <GifFullscreen url={src} onClose={() => setFullscreen(false)} />}
    </>
  );
};

// ⚠️ A Modal is its own native tree: safe-area insets read 0/stale inside it (floor applied) and the StatusBar is set
// imperatively. Opened only from an animating bubble, so it never stacks on another Modal.
const GifFullscreen = ({ url, onClose }: { url: string; onClose: () => void }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [ratio, setRatio] = useState(1);
  const top = Math.max(insets.top, Platform.OS === 'ios' ? 47 : StatusBar.currentHeight || 24) + 8;

  useEffect(() => {
    StatusBar.setHidden(true, 'fade');
    return () => StatusBar.setHidden(false, 'fade');
  }, []);

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={{ uri: url }}
          style={{ width, height: Math.min(height, width / ratio) }}
          resizeMode="contain"
          onLoad={(e) => {
            const { width: w, height: h } = e.nativeEvent.source || ({} as any);
            setRatio(gifAspectRatio(w, h));
          }}
        />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={{
            position: 'absolute',
            top,
            right: 16,
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        >
          <Icon name="close" size={24} color="#fff" />
        </Pressable>
      </Pressable>
    </Modal>
  );
};
