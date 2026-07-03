import React from 'react';
import { View, Text } from 'react-native';

interface LockedFieldProps {
  label?: string;
  value?: string | number;
  caption?: string;
}

export function LockedField({ label, value, caption = 'Locked from Job Summary' }: LockedFieldProps) {
  return (
    <View className="mb-4">
      <View className="relative">
        {label && (
          <Text className="text-xs text-gray-400 absolute top-2 left-3.5 z-10">{label}</Text>
        )}
        <View className="pt-7 pb-2.5 px-3.5 rounded-xl border border-gray-200 bg-gray-50 flex-row items-center justify-between">
          <Text className="text-base font-semibold text-gray-400">{value ?? '—'}</Text>
          <Text className="text-base text-gray-300">🔒</Text>
        </View>
      </View>
      <Text className="text-[11px] text-gray-400 italic mt-1 pl-1">{caption}</Text>
    </View>
  );
}
