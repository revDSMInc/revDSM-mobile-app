import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface OptionListProps {
  label?: string;
  options?: string[];
  value?: string | string[];
  onChange?: (val: string | string[]) => void;
  color?: string;
  /** Columns per row (web `getOptionGridSize(field.columns)` → 12/span). Defaults to 1 (stacked). */
  columns?: number;
  /** Multi-select (web `field.multiSelect`) — value is an array, boxes toggle in/out. */
  isMulti?: boolean;
}

const GAP = 8; // matches gap-2 used by SwatchPicker/RoomPicker

// Matches the normal Job Builder selector styling: #22C55E selected, slate idle,
// rounded-xl border-2, font-black, MCIcon "✓ value" confirmation. When `columns`
// > 1 the options wrap into a grid (web parity — MUI `<Grid item xs>` wrapping),
// so soffit/fascia "size" / "board type" render 2-up and rows grow with options.
// When `isMulti`, value is an array and multiple boxes stay selected (web parity —
// `option-selector.js` handleSelection: e.g. gutter modify-height locations).
export function OptionList({
  label,
  options = [],
  value,
  onChange,
  color = '#22C55E',
  columns = 1,
  isMulti = false,
}: OptionListProps) {
  const cols = Math.max(1, Math.round(columns));
  const selectedValues = isMulti ? (Array.isArray(value) ? value : []) : [];

  const isSelected = (opt: string) =>
    isMulti ? selectedValues.includes(opt) : value === opt;

  const handlePress = (opt: string) => {
    if (isMulti) {
      // Web parity (option-selector.js): toggle membership in the array.
      const next = selectedValues.includes(opt)
        ? selectedValues.filter((v) => v !== opt)
        : [...selectedValues, opt];
      onChange?.(next);
      return;
    }
    // Web parity (useCanDeselectSelection): tapping the selected option clears it.
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
                className="py-3.5 px-5 rounded-xl items-start border-2"
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
