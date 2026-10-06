import React from 'react';
import { useNumPadActive } from '../NumPad';
import { KeyboardAvoidingView, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  behavior?: 'padding' | 'height' | 'position';
  isModal?: boolean;
  /** Off while an in-app pad is up, or the system keyboard's stale height leaves a gap under it. */
  enabled?: boolean;
}

export const GlobalKeyboardAvoidingView: React.FC<Props> = ({
  children,
  style,
  behavior,
  isModal,
  enabled = true,
}) => {
  // The in-app number pad is up: there is no system keyboard to avoid (iOS can still report a
  // stale height for the hidden one, which left a gap under the pad).
  const numPadActive = useNumPadActive();
  const getBehavior = () => {
    if (behavior) return behavior;
    if (Platform.OS === 'ios') return 'padding';
    if (isModal) return 'padding';
    return 'height'; // Consistent lift for full-screen Android forms
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={getBehavior()}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : isModal ? 24 : 0}
      enabled={enabled && !numPadActive}
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
