import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';

export function DownloadProgressRing({ progress, color }: { progress: number; color: string }) {
  return (
    <View className="items-center justify-center">
      <ActivityIndicator size="small" color={color} />
      {progress > 0 && (
        <Text className="text-[8px] font-bold mt-1" style={{ color }}>
          {Math.round(progress * 100)}%
        </Text>
      )}
    </View>
  );
}
