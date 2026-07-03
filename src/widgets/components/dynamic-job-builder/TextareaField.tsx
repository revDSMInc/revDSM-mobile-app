import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface TextareaFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (val: string) => void;
  rows?: number;
  incomplete?: boolean;
  incompleteMessage?: string;
}

export function TextareaField({ label, placeholder, value, onChange, rows = 3, incomplete, incompleteMessage }: TextareaFieldProps) {
  return (
    <View className="mb-3">
      {label && (
        <Text className="text-xs text-gray-500 mb-1.5 font-semibold">{label}</Text>
      )}
      <TextInput
        className={`bg-white border rounded-xl px-4 py-3 text-base ${incomplete ? 'border-amber-400' : 'border-gray-200'}`}
        placeholder={placeholder || ''}
        value={value || ''}
        onChangeText={onChange}
        multiline
        numberOfLines={rows}
        textAlignVertical="top"
        placeholderTextColor="#999"
      />
      {incomplete && incompleteMessage && (
        <View className="bg-amber-50 border border-amber-300 rounded-lg p-3 mt-2">
          <Text className="text-xs font-bold text-amber-600">⚠️ {incompleteMessage}</Text>
        </View>
      )}
    </View>
  );
}
