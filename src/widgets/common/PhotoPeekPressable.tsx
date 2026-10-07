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
import { getWarmedLocalUri, isRemoteImageUrl, warmToLocalCache } from '../../utils/imageFileCache';

const { width: SW, height: SH } = Dimensions.get('window');
const PREVIEW_W = SW * 0.86;
const PREVIEW_H = SH * 0.6;

interface PhotoPeekPressableProps {
  uri?: string | null;
  label?: string;
  onPress?: (peekUri?: string | null) => void;
  disabled?: boolean;
  peekDisabled?: boolean;
  minDurationMs?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
  children: React.ReactNode;
}

function usePeekCachedUri(uri?: string | null): string | null {
  const [localUri, setLocalUri] = useState<string | null>(() => getWarmedLocalUri(uri));

  useEffect(() => {
    const known = getWarmedLocalUri(uri);
    setLocalUri(known);
    if (known || !isRemoteImageUrl(uri)) return undefined;
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

  const scrollLock = usePhotoPeekScrollLock();
  const lockedByThisRef = useRef(false);
  const releaseScrollLock = useCallback(() => {
    if (lockedByThisRef.current) {
      lockedByThisRef.current = false;
      scrollLock?.unlock();
    }
  }, [scrollLock]);
  const releaseRef = useRef(releaseScrollLock);
  releaseRef.current = releaseScrollLock;
  useEffect(() => () => releaseRef.current(), []);

  const canPeek = !!uri && !disabled && !peekDisabled;

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
