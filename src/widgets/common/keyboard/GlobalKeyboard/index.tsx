import React from 'react';
import { useNumPadActive } from '../NumPad';
import { KeyboardAvoidingView, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  behavior?: 'padding' | 'height' | 'position';
  isModal?: boolean;
  enabled?: boolean;
}

export const GlobalKeyboardAvoidingView: React.FC<Props> = ({
  children,
  style,
  behavior,
  isModal,
  enabled = true,
}) => {
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
