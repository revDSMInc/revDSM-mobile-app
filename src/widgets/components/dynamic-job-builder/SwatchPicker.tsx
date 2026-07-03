import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
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

export function SwatchPicker({
  label,
  value,
  onChange,
  colors,
  showMoreColors = true,
  accentColor = '#22c55e',
}: SwatchPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const palette = colors || GUTTER_COLORS;
  const shown = expanded ? palette : palette.slice(0, 4);

  return (
    <View className="mb-5">
      {label && (
        <Text className="text-[15px] font-bold text-gray-900 mb-2">{label}</Text>
      )}
      {showMoreColors && !expanded && palette.length > 4 && (
        <View className="items-end mb-2">
          <TouchableOpacity onPress={() => setExpanded(true)}>
            <Text className="text-[13px] font-semibold text-gray-600">More Colors →</Text>
          </TouchableOpacity>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {shown.map((c) => {
          const selected = value === c.name;
          return (
            <TouchableOpacity
              key={c.name}
              onPress={() => onChange?.(c.name)}
              className="w-16 h-11 rounded-[10px] relative"
              style={{
                backgroundColor: c.hex,
                borderWidth: selected ? 3 : 2,
                borderColor: selected ? accentColor : '#e5e5ea',
              }}
            >
              {selected && (
                <View
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full items-center justify-center"
                  style={{ backgroundColor: accentColor }}
                >
                  <Text className="text-white text-[9px] font-black">✓</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      {value && (
        <View
          className="mt-2 self-start flex-row items-center gap-2 px-3 py-1 rounded-full"
          style={{ backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: accentColor }}
        >
          <Text className="text-[11px] font-bold" style={{ color: accentColor }}>✓ {value}</Text>
        </View>
      )}
    </View>
  );
}
