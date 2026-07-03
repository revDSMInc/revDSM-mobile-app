import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface ToggleGroupProps {
  label?: string;
  options?: string[];
  value?: string;
  onChange?: (val: string) => void;
  color?: string;
}

export function ToggleGroup({ label, options = [], value, onChange, color = '#22c55e' }: ToggleGroupProps) {
  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[13px] font-bold text-gray-500 mb-2">{label}</Text>
      )}
      <View className="flex-row gap-2">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange?.(opt)}
              className="flex-1 py-3.5 px-2 rounded-xl items-center"
              style={{
                borderWidth: selected ? 2 : 1.5,
                borderColor: selected ? color : '#e5e5ea',
                backgroundColor: selected ? color : '#fff',
              }}
            >
              <Text
                className="text-[13px] font-bold text-center"
                style={{ color: selected ? '#fff' : '#333' }}
              >
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value && (
        <Text className="mt-1.5 text-[11px] font-bold" style={{ color }}>
          ✓ {value}
        </Text>
      )}
    </View>
  );
}
