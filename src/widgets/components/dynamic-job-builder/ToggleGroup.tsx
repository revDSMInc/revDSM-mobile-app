import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ToggleGroupProps {
  label?: string;
  options?: string[];
  value?: string | string[];
  onChange?: (val: string | string[]) => void;
  color?: string;
  /** Multi-select (web `field.multiSelect`) — value is an array, toggles stay lit. */
  isMulti?: boolean;
}

// Matches the normal Job Builder toggle/selector buttons (GutterSection size /
// partial, LeafFilter profile): #22C55E selected, slate idle, h-11 rounded-xl
// border-2, font-black, and a "✓ value" confirmation line. When `isMulti`, value
// is an array and multiple toggles stay selected (web `option-selector.js`).
export function ToggleGroup({ label, options = [], value, onChange, color = '#22C55E', isMulti = false }: ToggleGroupProps) {
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
    // Web parity (useCanDeselectSelection): re-tapping the selected toggle clears it.
    onChange?.(value === opt ? '' : opt);
  };

  const summaryText = isMulti ? selectedValues.join(', ') : (value as string);

  return (
    <View className="mb-4">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const selected = isSelected(opt);
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => handlePress(opt)}
              className="flex-1 h-11 rounded-xl items-center justify-center border-2"
              style={{
                borderColor: selected ? color : '#F1F5F9',
                backgroundColor: selected ? color : '#fff',
                minWidth: 80,
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
      {!!summaryText && (
        <View
          className="rounded-full py-2 px-4 self-start flex-row items-center mt-2"
          style={{ backgroundColor: color }}
        >
          <Icon name="check" size={12} color="#fff" />
          <Text className="text-white text-[10px] font-black ml-1">{summaryText}</Text>
        </View>
      )}
    </View>
  );
}
