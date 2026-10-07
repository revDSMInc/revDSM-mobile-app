import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface OptionListProps {
  label?: string;
  options?: string[];
  value?: string | string[];
  onChange?: (val: string | string[]) => void;
  color?: string;
  columns?: number;
  isMulti?: boolean;
  disabled?: boolean;
}

const GAP = 8; // matches gap-2 used by SwatchPicker/RoomPicker

function autoColumns(options: string[]): number {
  const hasLongText = options.some((o) => (o || '').length > 10);
  if (options.length === 2) return 2;
  if (options.length === 3) return hasLongText ? 1 : 3;
  if (options.length === 4) return hasLongText ? 2 : 4;
  return 2;
}

export function OptionList({
  label,
  options = [],
  value,
  onChange,
  color = '#22C55E',
  columns,
  isMulti = false,
  disabled = false,
}: OptionListProps) {
  const requestedCols = columns && columns > 0 ? Math.max(1, Math.round(columns)) : autoColumns(options);
  const longestOption = options.reduce((max, o) => Math.max(max, (o || '').length), 0);
  const columnCap = longestOption > 10 ? 2 : requestedCols;
  const cols = Math.min(requestedCols, columnCap);
  const selectedValues = isMulti ? (Array.isArray(value) ? value : []) : [];

  const isSelected = (opt: string) =>
    isMulti ? selectedValues.includes(opt) : value === opt;

  const handlePress = (opt: string) => {
    if (disabled) return;
    if (isMulti) {
      const next = selectedValues.includes(opt)
        ? selectedValues.filter((v) => v !== opt)
        : [...selectedValues, opt];
      onChange?.(next);
      return;
    }
    onChange?.(value === opt ? '' : opt);
  };

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
                disabled={disabled}
                accessibilityState={{ disabled, selected }}
                className="py-3.5 rounded-xl border-2"
                style={{
                  alignItems: cols > 1 ? 'center' : 'flex-start',
                  paddingHorizontal: cols > 1 ? 4 : 20,
                  borderColor: disabled ? (selected ? '#CBD5E1' : '#F1F5F9') : selected ? color : '#F1F5F9',
                  backgroundColor: disabled ? '#F8FAFC' : selected ? `${color}12` : '#fff',
                }}
              >
                <Text
                  numberOfLines={3}
                  className="text-[12px] font-black"
                  style={{
                    color: disabled ? (selected ? '#64748B' : '#94A3B8') : selected ? color : '#64748B',
                    textAlign: cols > 1 ? 'center' : 'left',
                  }}
                >
                  {opt}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}
