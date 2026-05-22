import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';

type Props = {
  visible: boolean;
  message?: string;
};

export function LoadingOverlay({ visible, message = 'Processing...' }: Props) {
  if (!visible) return null;
  return (
    <View className="absolute inset-0 bg-black/40 justify-center items-center z-[9999]">
      <ActivityIndicator size="large" color="#4CBB17" />
      <Text className="text-white font-semibold mt-2">{message}</Text>
    </View>
  );
}
