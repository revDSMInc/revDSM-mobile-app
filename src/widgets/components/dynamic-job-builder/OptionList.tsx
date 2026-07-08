import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface OptionListProps {
  label?: string;
  options?: string[];
  value?: string;
  onChange?: (val: string) => void;
  color?: string;
}

// Matches the normal Job Builder selector styling: #22C55E selected, slate idle,
// rounded-xl border-2, font-black, MCIcon "✓ value" confirmation.
export function OptionList({ label, options = [], value, onChange, color = '#22C55E' }: OptionListProps) {
  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange?.(opt)}
            className="w-full py-3.5 px-5 rounded-xl mb-2 items-start border-2"
            style={{
              borderColor: selected ? color : '#F1F5F9',
              backgroundColor: selected ? `${color}12` : '#fff',
            }}
          >
            <Text
              className="text-[12px] font-black"
              style={{ color: selected ? color : '#64748B' }}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
      {value && (
        <View className="flex-row items-center mt-1">
          <Icon name="check" size={12} color={color} />
          <Text className="text-[11px] font-black ml-1" style={{ color }}>{value}</Text>
        </View>
      )}
    </View>
  );
}
