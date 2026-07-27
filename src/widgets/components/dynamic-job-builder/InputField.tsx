import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface InputFieldProps {
  label?: string;
  placeholder?: string;
  value?: string | number;
  onChange?: (val: string) => void;
  unit?: string;
  editable?: boolean;
}

// Matches the normal Job Builder numeric inputs: h-12 rounded-2xl border-2
// slate, font-black. Renders label + input + optional inline unit ONLY — web's
// `input-field.js` echoes no "✓ value" line below (the entered value is already
// visible in the input, so repeating it just duplicated it). The ✓ confirmation
// belongs to the option/toggle/swatch widgets, where the value isn't otherwise shown.
export function InputField({ label, placeholder, value, onChange, unit, editable = true }: InputFieldProps) {
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
    </View>
  );
}
