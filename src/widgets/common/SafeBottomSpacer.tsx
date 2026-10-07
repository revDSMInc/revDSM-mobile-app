import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  height?: number;
  style?: ViewStyle;
}

export const SafeBottomSpacer: React.FC<Props> = ({ height = 16, style }) => {
  const insets = useSafeAreaInsets();

  return <View style={[{ height: Math.max(insets.bottom, height) }, style]} />;
};

export default SafeBottomSpacer;
