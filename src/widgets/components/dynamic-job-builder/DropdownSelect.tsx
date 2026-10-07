import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface DropdownSelectProps {
  label?: string;
  options: string[];
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  accentColor?: string;
}

const ACCENT = '#22C55E';

export function DropdownSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  accentColor = ACCENT,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = typeof value === 'string' ? value : '';
  const hasValue = !!selected && options.includes(selected);

  return (
    <View className="mb-3">
      {!!label && (
        <Text className="text-[11px] font-black text-slate-400 mb-1.5">{label}</Text>
      )}

      <TouchableOpacity
        onPress={() => setOpen((prev) => !prev)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="rounded-2xl border-2 px-4"
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderColor: open ? accentColor : '#F1F5F9',
          backgroundColor: '#fff',
        }}
      >
        <Text
          numberOfLines={1}
          className="text-[12px] font-black"
          style={{ flex: 1, color: hasValue ? '#1C252E' : '#CBD5E1' }}
        >
          {hasValue ? selected : placeholder}
        </Text>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={open ? accentColor : '#94A3B8'}
        />
      </TouchableOpacity>

      {open && (
        <View
          className="mt-1.5 rounded-2xl border-2 overflow-hidden"
          style={{ borderColor: '#F1F5F9', backgroundColor: '#fff' }}
        >
          {options.map((opt, index) => {
            const isSelected = opt === selected;
            return (
              <TouchableOpacity
                key={opt}
                onPress={() => {
                  onChange?.(isSelected ? '' : opt);
                  setOpen(false);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                className="px-4 py-3.5"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: '#F1F5F9',
                  backgroundColor: isSelected ? `${accentColor}12` : '#fff',
                }}
              >
                <Text
                  numberOfLines={2}
                  className="text-[12px] font-black"
                  style={{ flex: 1, color: isSelected ? accentColor : '#64748B' }}
                >
                  {opt}
                </Text>
                {isSelected && <Icon name="check" size={16} color={accentColor} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}
