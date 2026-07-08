import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { GUTTER_COLORS } from '../../../utils/dynamic-job-builder/constants/color-palettes';

interface SwatchColor {
  name: string;
  hex: string;
}

interface SwatchPickerProps {
  label?: string;
  value?: string;
  onChange?: (val: string) => void;
  colors?: SwatchColor[];
  showMoreColors?: boolean;
  accentColor?: string;
}

// Matches the normal Job Builder swatch grid (GutterSection): 4-up w-[23%] h-14
// border-4 swatches, #22C55E selected ring + check, "More Colors" expander, and
// the #22C55E "✓ value" confirmation chip.
export function SwatchPicker({
  label,
  value,
  onChange,
  colors,
  showMoreColors = true,
  accentColor = '#22C55E',
}: SwatchPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const palette = colors || GUTTER_COLORS;
  const shown = expanded ? palette : palette.slice(0, 4);
  const selectedHex = palette.find((c) => c.name === value)?.hex;

  return (
    <View className="mb-5">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-2">{label}</Text>
      )}
      {showMoreColors && !expanded && palette.length > 4 && (
        <View className="items-end mb-2">
          <TouchableOpacity onPress={() => setExpanded(true)} className="flex-row items-center">
            <Text className="text-[10px] font-black text-slate-500 mr-1">More Colors</Text>
            <Icon name="arrow-right" size={12} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {shown.map((c) => {
          const selected = value === c.name;
          const isLight = c.name?.toLowerCase() === 'white';
          return (
            <TouchableOpacity
              key={c.name}
              onPress={() => onChange?.(c.name)}
              className="w-[23%] h-14 rounded-xl items-center justify-center"
              style={{
                backgroundColor: c.hex,
                borderWidth: 4,
                borderColor: selected ? accentColor : '#E2E8F0',
              }}
            >
              {selected && <Icon name="check" size={22} color={isLight ? accentColor : '#fff'} />}
            </TouchableOpacity>
          );
        })}
      </View>
      {value && (
        <View
          className="mt-2 self-start flex-row items-center rounded-full py-2 px-4"
          style={{ backgroundColor: accentColor }}
        >
          {selectedHex && (
            <View
              className="w-4 h-4 rounded-full border border-white/20 mr-2"
              style={{ backgroundColor: selectedHex }}
            />
          )}
          <Icon name="check" size={12} color="#fff" />
          <Text className="text-white text-[10px] font-black ml-1">{value}</Text>
        </View>
      )}
    </View>
  );
}
