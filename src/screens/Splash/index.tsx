import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';

// Loaded defensively (same pattern as MediaViewerModal / chat-utils) so a missing
// or unlinked native video module degrades to "no splash" instead of a boot crash.
const getVideo = () => {
  try {
    return require('react-native-video').default;
  } catch {
    return null;
  }
};

// Background behind the animation. The logo animation is exported on a dark
// green canvas, so this matches its edge tone — otherwise the letterbox/pillar
// bars (and the pre-reveal blank frame) flash white on screens whose aspect
// ratio differs from the video (e.g. thin white lines on the sides on iOS).
const SPLASH_BG = '#10261A';

// Playback speed for the logo animation. The source clip plays too fast at 1x,
// so it's slowed down here (0.5 = half speed) instead of re-exporting the mp4.
const SPLASH_PLAYBACK_RATE = 0.5;

// Failsafe: never hold the app hostage if the video never reports onEnd
// (codec issue, muted autoplay blocked, etc.). Generous enough to cover the
// clip at the slowed-down rate.
const MAX_SPLASH_MS = 12000;

// How often the player reports progress. Kept tight so we can tell "actually
// playing" from "first frame decoded" within a frame or two.
const PROGRESS_INTERVAL_MS = 50;

// Backstop for revealing the video: if the player never reports a moving
// currentTime (some Android decoders report 0 for the first ticks), show it
// anyway shortly after load rather than sitting on a blank screen.
const REVEAL_AFTER_LOAD_MS = 400;

type Props = {
  /** Called once, when the animation finishes (or the failsafe fires). */
  onFinish: () => void;
};

export default function SplashScreen({ onFinish }: Props) {
  const Video = useRef(getVideo()).current;
  const finished = useRef(false);

  // The player decodes and holds frame 0 while it prepares, which reads as a
  // static image before the animation starts. So the video stays invisible
  // (plain background only) until playback has actually begun.
  const [playing, setPlaying] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => setPlaying(true), []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    // No native video module → skip the splash entirely.
    if (!Video) {
      finish();
      return;
    }
    const timer = setTimeout(finish, MAX_SPLASH_MS);
    return () => {
      clearTimeout(timer);
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, [Video, finish]);

  const handleLoad = useCallback(() => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(reveal, REVEAL_AFTER_LOAD_MS);
  }, [reveal]);

  const handleProgress = useCallback(
    ({ currentTime }: { currentTime: number }) => {
      // Playback has genuinely moved past the first frame — safe to show.
      if (currentTime > 0) reveal();
    },
    [reveal]
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={SPLASH_BG} />
      {!!Video && (
        <Video
          source={require('../../assets/gif/logo_animation.mp4')}
          style={[StyleSheet.absoluteFill, playing ? styles.visible : styles.hidden]}
          // "cover" fills the screen edge-to-edge so no white/background bars
          // show when the video's aspect ratio differs from the device's. The
          // logo is centred, so the small top/bottom crop is never visible.
          resizeMode="cover"
          repeat={false}
          muted
          rate={SPLASH_PLAYBACK_RATE}
          paused={false}
          controls={false}
          playInBackground={false}
          ignoreSilentSwitch="ignore"
          progressUpdateInterval={PROGRESS_INTERVAL_MS}
          onLoad={handleLoad}
          onProgress={handleProgress}
          onEnd={finish}
          onError={finish}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
    // Sits above the app (including App.tsx's status-bar inset strip at 9999).
    zIndex: 10000,
    elevation: 10000,
  },
  // Frame 0 is kept off-screen until playback actually starts, so the splash
  // never shows a frozen still before the animation.
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
});
