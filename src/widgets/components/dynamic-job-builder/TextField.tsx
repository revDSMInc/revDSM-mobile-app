import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface TextFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (val: string) => void;
  editable?: boolean;
}

// Matches the normal Job Builder text inputs: h-12 rounded-2xl border-2 slate,
// font-black.
export function TextField({ label, placeholder, value, onChange, editable = true }: TextFieldProps) {
  return (
    <View className="mb-3">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-1.5">{label}</Text>
      )}
      <TextInput
        className="h-12 bg-white rounded-2xl border-2 border-slate-100 px-5 text-[12px] font-black text-black"
        placeholder={placeholder || ''}
        value={value || ''}
        onChangeText={onChange}
        editable={editable}
        placeholderTextColor="#CBD5E1"
      />
    </View>
  );
}
