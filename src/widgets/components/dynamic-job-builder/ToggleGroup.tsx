import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ToggleGroupProps {
  label?: string;
  options?: string[];
  value?: string | string[];
  onChange?: (val: string | string[]) => void;
  color?: string;
  isMulti?: boolean;
}

const GAP = 8; // matches gap-2, aligns with OptionList/SwatchPicker spacing

const TOGGLE_COLS = 2;

export function ToggleGroup({ label, options = [], value, onChange, color = '#22C55E', isMulti = false }: ToggleGroupProps) {
  const cols = TOGGLE_COLS;
  const selectedValues = isMulti ? (Array.isArray(value) ? value : []) : [];
  const isSelected = (opt: string) =>
    isMulti ? selectedValues.includes(opt) : value === opt;

  const handlePress = (opt: string) => {
    if (isMulti) {
      const next = selectedValues.includes(opt)
        ? selectedValues.filter((v) => v !== opt)
        : [...selectedValues, opt];
      onChange?.(next);
      return;
    }
    onChange?.(value === opt ? '' : opt);
  };

  const summaryText = isMulti ? selectedValues.join(', ') : (value as string);

  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -GAP / 2 }}>
        {options.map((opt) => {
          const selected = isSelected(opt);
          return (
            <View key={opt} style={{ width: `${100 / cols}%`, padding: GAP / 2 }}>
              <TouchableOpacity
                onPress={() => handlePress(opt)}
                className="h-11 rounded-xl items-center justify-center border-2"
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
            </View>
          );
        })}
      </View>
      {!!summaryText && (
        <View className="flex-row items-center mt-1">
          <Icon name="check" size={12} color={color} />
          <Text className="text-[11px] font-black ml-1" style={{ color }}>{summaryText}</Text>
        </View>
      )}
    </View>
  );
}
