import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface OptionListProps {
  label?: string;
  options?: string[];
  value?: string;
  onChange?: (val: string) => void;
  color?: string;
}

export function OptionList({ label, options = [], value, onChange, color = '#22c55e' }: OptionListProps) {
  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[13px] font-bold text-gray-500 mb-2">{label}</Text>
      )}
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange?.(opt)}
            className="w-full py-3.5 px-7 rounded-xl mb-2 items-start"
            style={{
              borderWidth: selected ? 2 : 1.5,
              borderColor: selected ? color : '#e5e5ea',
              backgroundColor: selected ? `${color}12` : '#fff',
            }}
          >
            <Text
              className="text-[13px]"
              style={{ color: selected ? color : '#333', fontWeight: selected ? '700' : '400' }}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
      {value && (
        <Text className="text-[11px] font-bold mt-1" style={{ color }}>
          ✓ {value}
        </Text>
      )}
    </View>
  );
}
