import React from 'react';
import { View, Text } from 'react-native';

interface AllocatorBarProps {
  label?: string;
  avail?: number;
  used?: number;
  unit?: string;
}

export function AllocatorBar({ label, avail = 0, used = 0, unit = '' }: AllocatorBarProps) {
  const left = avail - used;
  const complete = left === 0;
  const over = left < 0;
  const borderColor = over ? '#ef4444' : complete ? '#22c55e' : '#38bdf8';
  const accentColor = over ? '#ef4444' : complete ? '#22c55e' : '#0ea5e9';

  return (
    <View
      className="mx-3 mb-3 rounded-[14px] p-3 bg-white"
      style={{ borderWidth: 2, borderColor }}
    >
      {label && (
        <Text className="text-[13px] font-bold text-center mb-2" style={{ color: accentColor }}>
          {label}
        </Text>
      )}
      <View className="flex-row justify-around">
        {[
          ['Avail', avail, '#0ea5e9'],
          ['Used', used, '#f59e0b'],
          ['Left', left, over ? '#ef4444' : complete ? '#22c55e' : '#0ea5e9'],
        ].map(([l, v, c]) => (
          <View key={l as string} className="items-center">
            <Text className="text-[11px] text-gray-400">{l as string}</Text>
            <Text className="text-lg font-extrabold" style={{ color: c as string }}>
              {v as number}{unit}
            </Text>
          </View>
        ))}
      </View>
      {!complete && !over && (
        <Text className="mt-2 text-[11px] font-semibold text-center text-amber-500">
          ⚠️ INCOMPLETE — {left}{unit} remaining
        </Text>
      )}
      {over && (
        <Text className="mt-2 text-[11px] font-semibold text-center text-red-500">
          ⛔ OVER ALLOCATED — {Math.abs(left)}{unit} excess
        </Text>
      )}
    </View>
  );
}
