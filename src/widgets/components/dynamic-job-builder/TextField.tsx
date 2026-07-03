import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface TextFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (val: string) => void;
  editable?: boolean;
}

export function TextField({ label, placeholder, value, onChange, editable = true }: TextFieldProps) {
  return (
    <View className="mb-3">
      {label && (
        <Text className="text-xs text-gray-500 mb-1.5 font-semibold">{label}</Text>
      )}
      <TextInput
        className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-base"
        placeholder={placeholder || ''}
        value={value || ''}
        onChangeText={onChange}
        editable={editable}
        placeholderTextColor="#999"
      />
    </View>
  );
}
