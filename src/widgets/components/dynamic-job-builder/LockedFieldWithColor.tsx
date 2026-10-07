import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
  colors = [],
}: LockedFieldWithColorProps) {
  return (
    <View className="border-b border-slate-50 pb-4 mb-4">
      <View className="flex-row justify-between items-center">
        <View className="flex-1 pr-3">
          {label && <Text className="text-[10px] font-black text-slate-400 mb-1">{label}</Text>}
          <Text className="text-xs font-black text-slate-800">{value ?? '—'}</Text>
        </View>
        <Icon name="lock" size={18} color="#CBD5E1" />
      </View>
      {colors.length > 0 && (
        <View className="flex-row flex-wrap gap-2 mt-2">
          {colors.slice(0, 6).map((c) => (
            <View
              key={c.name}
              className="w-6 h-6 rounded-lg"
              style={{
                backgroundColor: c.hex,
                borderWidth: colorValue === c.name ? 3 : 1,
                borderColor: colorValue === c.name ? '#22C55E' : '#E2E8F0',
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
