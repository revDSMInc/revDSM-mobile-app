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

const GAP = 8; // matches gap-2, aligns with OptionList/SwatchPicker spacing

// Toggle options always lay out in a fixed 2-column grid — so a single option is
// full-width-in-a-column, three wrap 2 + 1, and four render as a clean 2×2 (e.g.
// Soffit Type's four long-labelled options) instead of being crammed into one row.
const TOGGLE_COLS = 2;

// Matches the normal Job Builder toggle/selector buttons (GutterSection size /
// partial, LeafFilter profile): #22C55E selected, slate idle, h-11 rounded-xl
// border-2, font-black. The selected value is echoed below as a PLAIN "✓ value"
// text line (web `option-selector.js` renders it as a success-colored caption) —
// never a filled chip, which read as a second selection. When `isMulti`, value
// is an array and multiple toggles stay selected (web `option-selector.js`).
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
    // Web parity (useCanDeselectSelection): re-tapping the selected toggle clears it.
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
