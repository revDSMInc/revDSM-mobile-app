import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  Dimensions,
  Platform,
  StatusBar,
  StyleProp,
  ViewStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { triggerHaptic } from '../../utils/haptics';
import { usePhotoPeekScrollLock } from './PhotoPeekScrollLock';
import { isRemoteImageUrl, warmToLocalCache } from '../../utils/imageFileCache';

const { width: SW, height: SH } = Dimensions.get('window');
const PREVIEW_W = SW * 0.86;
const PREVIEW_H = SH * 0.6;

interface PhotoPeekPressableProps {
  /** Image URI to peek. If empty/null the peek is disabled but onPress still fires. */
  uri?: string | null;
  /** Optional caption shown under the peek preview. */
  label?: string;
  /**
   * Normal tap handler (opens gallery / annotation etc.).
   *
   * Receives the WARMED uri — the local `file://` copy once cached, else the
   * original url — so a full-screen viewer opened by tapping is instant for the
   * same reason the peek is. Existing callers that take no argument are unaffected.
   */
  onPress?: (peekUri?: string | null) => void;
  /** Disables both the tap and the peek. */
  disabled?: boolean;
  /** Disables only the hold-to-peek, while leaving `onPress` (tap) active. */
  peekDisabled?: boolean;
  /** Hold duration before the peek opens (ms). Defaults to 260. */
  minDurationMs?: number;
  style?: StyleProp<ViewStyle>;
  /** NativeWind class string forwarded to the wrapper (auto-interop'd View). */
  className?: string;
  children: React.ReactNode;
}

/**
 * Resolve the uri the enlarged preview should render: a local `file://` copy once
 * it has been downloaded, else the original url.
 *
 * Our photo urls are pre-signed S3 links with no cache headers, so the OS image
 * cache refuses to store them. The thumbnail being on screen therefore does NOT
 * mean the peek is free — the full-size decode misses and re-downloads, leaving
 * the preview blank for 2–3 seconds. Warming a real file in CacheDir and handing
 * the peek `file://…` makes it open instantly.
 *
 * Warming lives HERE rather than in each screen so every consumer gets it (and no
 * new one can forget it). It is capped to a few concurrent downloads inside
 * `imageFileCache`, so a 20+ thumbnail grid doesn't starve the visible images.
 */
function usePeekCachedUri(uri?: string | null): string | null {
  const [localUri, setLocalUri] = useState<string | null>(null);

  useEffect(() => {
    setLocalUri(null);
    if (!isRemoteImageUrl(uri)) return undefined;
    let cancelled = false;
    warmToLocalCache(uri)
      .then((file) => {
        if (!cancelled && file) setLocalUri(file);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return localUri;
}

// iMessage-style "peek": hold a photo to pop up an enlarged preview with haptic
// feedback; release to dismiss. A quick tap still fires `onPress`. Reusable
// anywhere a thumbnail is shown (manage photos, rev render, etc.).
//
// Implemented with a plain <Pressable> (onLongPress opens the peek, onPressOut
// dismisses it) rather than gesture-handler composition — the RN press system
// keeps the normal tap 100% reliable inside ScrollViews / nested modals, which
// a Tap+LongPress GestureDetector did not.
export const PhotoPeekPressable: React.FC<PhotoPeekPressableProps> = ({
  uri,
  label,
  onPress,
  disabled,
  peekDisabled,
  minDurationMs = 260,
  style,
  className,
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const progress = useSharedValue(0);
  const peekedRef = useRef(false);

  // Freeze the surrounding scroll while peeking so finger movement can't turn into a
  // scroll — a scroll steals the touch, terminates this Pressable, and would dismiss
  // the peek mid-hold. No-op when there's no PhotoPeekScrollLockProvider above us.
  const scrollLock = usePhotoPeekScrollLock();
  const lockedByThisRef = useRef(false);
  const releaseScrollLock = useCallback(() => {
    if (lockedByThisRef.current) {
      lockedByThisRef.current = false;
      scrollLock?.unlock();
    }
  }, [scrollLock]);
  // Safety net: if this thumbnail unmounts mid-peek, drop its lock. Runs ONLY on real
  // unmount (empty deps) via a ref — a deps array would re-run every time the lock
  // toggles the provider and prematurely release the lock mid-peek.
  const releaseRef = useRef(releaseScrollLock);
  releaseRef.current = releaseScrollLock;
  useEffect(() => () => releaseRef.current(), []);

  const canPeek = !!uri && !disabled && !peekDisabled;

  // The enlarged preview reads the cached file the moment it's ready; until then
  // it falls back to the network url, so the peek is never worse than before.
  const cachedUri = usePeekCachedUri(canPeek ? uri : null);
  const peekUri = cachedUri || uri;

  const openPeek = useCallback(() => {
    peekedRef.current = true;
    if (scrollLock && !lockedByThisRef.current) {
      lockedByThisRef.current = true;
      scrollLock.lock();
    }
    triggerHaptic('threshold');
    setVisible(true);
    progress.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
  }, [progress, scrollLock]);

  const closePeek = useCallback(() => {
    releaseScrollLock();
    if (!peekedRef.current) return;
    peekedRef.current = false;
    progress.value = withTiming(0, { duration: 160 }, (finished) => {
      if (finished) runOnJS(setVisible)(false);
    });
  }, [progress, releaseScrollLock]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const imgStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      {
        scale: interpolate(
          progress.value,
          [0, 1],
          [0.72, 1],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={onPress ? () => onPress(peekUri) : undefined}
        onLongPress={canPeek ? openPeek : undefined}
        onPressOut={closePeek}
        delayLongPress={minDurationMs}
        // While peeking, the finger slides around over the enlarged preview.
        // By default RN cancels the press (firing onPressOut) as soon as the
        // finger leaves the thumbnail's small bounds, which would dismiss the
        // peek mid-hold. A screen-sized retention offset keeps the press alive
        // no matter how far the finger moves, so the peek only closes on a
        // real finger-lift ("hold off").
        pressRetentionOffset={{ top: SH, bottom: SH, left: SW, right: SW }}
        style={style}
        className={className}
      >
        {children}
      </Pressable>

      <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
        {visible && (
          <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        )}
        {/* pointerEvents none so the underlying Pressable keeps tracking the
            finger — releasing anywhere fires onPressOut and dismisses the peek. */}
        <View
          pointerEvents="none"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.72)',
              },
              backdropStyle,
            ]}
          />
          <Animated.View
            style={[
              {
                width: PREVIEW_W,
                height: PREVIEW_H,
                borderRadius: 24,
                overflow: 'hidden',
                backgroundColor: '#111',
                shadowColor: '#000',
                shadowOpacity: 0.5,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 12 },
                elevation: 24,
              },
              imgStyle,
            ]}
          >
            {!!peekUri && (
              <Animated.Image
                // Keyed on the uri so swapping the network url for the cached
                // file remounts the image instead of leaving the old decode up.
                key={peekUri}
                source={{ uri: peekUri, cache: 'force-cache' }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            )}
          </Animated.View>
          {!!label && (
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  bottom: Platform.OS === 'ios' ? SH * 0.12 : SH * 0.1,
                  paddingHorizontal: 18,
                  paddingVertical: 8,
                  borderRadius: 16,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  maxWidth: SW * 0.86,
                },
                backdropStyle,
              ]}
            >
              <Text
                numberOfLines={1}
                style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}
              >
                {label}
              </Text>
            </Animated.View>
          )}
        </View>
      </Modal>
    </>
  );
};

export default PhotoPeekPressable;
