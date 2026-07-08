import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ToggleGroupProps {
  label?: string;
  options?: string[];
  value?: string;
  onChange?: (val: string) => void;
  color?: string;
}

// Matches the normal Job Builder toggle/selector buttons (GutterSection size /
// partial, LeafFilter profile): #22C55E selected, slate idle, h-11 rounded-xl
// border-2, font-black, and a "✓ value" confirmation line.
export function ToggleGroup({ label, options = [], value, onChange, color = '#22C55E' }: ToggleGroupProps) {
  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      <View className="flex-row gap-2">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange?.(opt)}
              className="flex-1 h-11 rounded-xl items-center justify-center border-2"
              style={{
                borderColor: selected ? color : '#F1F5F9',
                backgroundColor: selected ? color : '#fff',
              }}
            >
              <Text
                className="text-[11px] font-black text-center"
                style={{ color: selected ? '#fff' : '#64748B' }}
              >
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value && (
        <View
          className="rounded-full py-2 px-4 self-start flex-row items-center mt-2"
          style={{ backgroundColor: color }}
        >
          <Icon name="check" size={12} color="#fff" />
          <Text className="text-white text-[10px] font-black ml-1">{value}</Text>
        </View>
      )}
    </View>
  );
}
