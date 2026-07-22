import React, { useCallback, useRef, useState } from 'react';
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

const { width: SW, height: SH } = Dimensions.get('window');
const PREVIEW_W = SW * 0.86;
const PREVIEW_H = SH * 0.6;

interface PhotoPeekPressableProps {
  /** Image URI to peek. If empty/null the peek is disabled but onPress still fires. */
  uri?: string | null;
  /** Optional caption shown under the peek preview. */
  label?: string;
  /** Normal tap handler (opens gallery / annotation etc.). */
  onPress?: () => void;
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

  const canPeek = !!uri && !disabled && !peekDisabled;

  const openPeek = useCallback(() => {
    peekedRef.current = true;
    triggerHaptic('threshold');
    setVisible(true);
    progress.value = withSpring(1, { damping: 18, stiffness: 220, mass: 0.6 });
  }, [progress]);

  const closePeek = useCallback(() => {
    if (!peekedRef.current) return;
    peekedRef.current = false;
    progress.value = withTiming(0, { duration: 160 }, (finished) => {
      if (finished) runOnJS(setVisible)(false);
    });
  }, [progress]);

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
        onPress={onPress}
        onLongPress={canPeek ? openPeek : undefined}
        onPressOut={closePeek}
        delayLongPress={minDurationMs}
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
            {!!uri && (
              <Animated.Image
                source={{ uri, cache: 'force-cache' }}
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
