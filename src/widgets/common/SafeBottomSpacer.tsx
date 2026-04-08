import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  height?: number;
  style?: ViewStyle;
}

/**
 * A reusable component that provides dynamic bottom padding based on the device's safe area insets.
 * Essential for Android's navigation bar (buttons vs. gestures) and iOS home indicators.
 */
export const SafeBottomSpacer: React.FC<Props> = ({ height = 16, style }) => {
  const insets = useSafeAreaInsets();

  return <View style={[{ height: Math.max(insets.bottom, height) }, style]} />;
};

export default SafeBottomSpacer;
