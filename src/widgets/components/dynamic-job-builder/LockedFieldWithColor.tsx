import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface LockedFieldWithColorProps {
  label?: string;
  value?: string | number;
  colorValue?: string;
  onColorChange?: (val: string) => void;
  colors?: Array<{ name: string; hex: string }>;
}

export function LockedFieldWithColor({
  label,
  value,
  colorValue,
  onColorChange,
  colors = [],
}: LockedFieldWithColorProps) {
  return (
    <View className="flex-row gap-2 mb-4">
      <View className="flex-1">
        {label && (
          <Text className="text-xs text-gray-400 mb-1">{label}</Text>
        )}
        <View className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-gray-400">{value ?? '—'}</Text>
          <Text className="text-sm text-gray-300">🔒</Text>
        </View>
      </View>
      <View className="w-24">
        <Text className="text-xs text-gray-400 mb-1">Color</Text>
        {colors.length > 0 ? (
          <View className="flex-row flex-wrap gap-1">
            {colors.slice(0, 4).map((c) => (
              <View
                key={c.name}
                className="w-5 h-5 rounded"
                style={{
                  backgroundColor: c.hex,
                  borderWidth: colorValue === c.name ? 2 : 1,
                  borderColor: colorValue === c.name ? '#22c55e' : '#e5e5ea',
                }}
              />
            ))}
          </View>
        ) : (
          <View className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            <Text className="text-sm text-gray-400">—</Text>
          </View>
        )}
      </View>
    </View>
  );
}
