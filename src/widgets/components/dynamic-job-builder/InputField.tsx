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

export function InputField({ label, placeholder, value, onChange, unit, editable = true }: InputFieldProps) {
  return (
    <View className="mb-3">
      {label && (
        <Text className="text-xs text-gray-500 mb-1.5 font-semibold">{label}</Text>
      )}
      <View className="relative">
        <TextInput
          className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-base"
          keyboardType="numeric"
          placeholder={placeholder || '0'}
          value={value != null ? String(value) : ''}
          onChangeText={onChange}
          editable={editable}
          placeholderTextColor="#999"
        />
        {unit && (
          <Text className="absolute right-3 top-3.5 text-xs text-gray-400">{unit}</Text>
        )}
      </View>
    </View>
  );
}
