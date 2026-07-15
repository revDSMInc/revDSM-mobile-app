import React from 'react';
import { View, Text, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface InputFieldProps {
  label?: string;
  placeholder?: string;
  value?: string | number;
  onChange?: (val: string) => void;
  unit?: string;
  editable?: boolean;
}

// Matches the normal Job Builder numeric inputs: h-12 rounded-2xl border-2
// slate, font-black. Shows a green "✓ value" confirmation once a value is entered
// so number fields (Miters, End Caps, …) get the same confirmation as the swatch
// / option / toggle widgets.
export function InputField({ label, placeholder, value, onChange, unit, editable = true }: InputFieldProps) {
  const filled = value != null && String(value) !== '' && Number(value) > 0;

  return (
    <View className="mb-3">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-1.5">{label}</Text>
      )}
      <View className="relative">
        <TextInput
          className="h-12 bg-white rounded-2xl border-2 border-slate-100 px-5 text-[12px] font-black text-black"
          keyboardType="number-pad"
          placeholder={placeholder || '0'}
          value={value != null ? String(value) : ''}
          onChangeText={onChange}
          editable={editable}
          placeholderTextColor="#CBD5E1"
        />
        {unit && (
          <Text className="absolute right-4 top-4 text-[11px] font-black text-slate-400">{unit}</Text>
        )}
      </View>
      {filled && (
        <View className="flex-row items-center mt-1">
          <Icon name="check" size={12} color="#22C55E" />
          <Text className="text-[11px] font-black ml-1" style={{ color: '#22C55E' }}>
            {String(value)}{unit ? ` ${unit}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}
