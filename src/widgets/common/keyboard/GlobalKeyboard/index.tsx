import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  behavior?: 'padding' | 'height' | 'position';
  isModal?: boolean; // New prop to handle modal-specific flickering
}

/**
 * Standardized KeyboardAvoidingView wrapper
 * Consistent behavior across Android/iOS.
 */
export const GlobalKeyboardAvoidingView: React.FC<Props> = ({
  children,
  style,
  behavior,
  isModal,
}) => {
  // On iOS, 'padding' is the gold standard for everything.
  // On Android Modals, they often don't respect adjustResize automatically,
  // so we use 'padding' which is smoother and less prone to flickering than 'height'.
  // For standard screens, we leave it undefined to trust adjustResize.
  const getBehavior = () => {
    if (behavior) return behavior;
    if (Platform.OS === 'ios') return 'padding';
    if (isModal) return 'padding'; // Padding is less jumpy than height on Android
    return undefined;
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={getBehavior()}
      // Offset by 24 on Android to prevent input from being too close to the keyboard
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : isModal ? 24 : 0}
      // This is crucial for Android to avoid flickering during layout transitions
      enabled
    >
      {children}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
