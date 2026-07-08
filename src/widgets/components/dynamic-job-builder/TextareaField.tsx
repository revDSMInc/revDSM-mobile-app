import React from 'react';
import { View, Text, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface TextareaFieldProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (val: string) => void;
  rows?: number;
  incomplete?: boolean;
  incompleteMessage?: string;
}

// Matches the normal Job Builder textarea: rounded-2xl border-2 slate, font-black,
// amber-400 border when incomplete.
export function TextareaField({ label, placeholder, value, onChange, rows = 3, incomplete, incompleteMessage }: TextareaFieldProps) {
  return (
    <View className="mb-3">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-1.5">{label}</Text>
      )}
      <TextInput
        className={`bg-white rounded-2xl border-2 px-5 py-3 text-[12px] font-black text-black ${incomplete ? 'border-amber-400' : 'border-slate-100'}`}
        placeholder={placeholder || ''}
        value={value || ''}
        onChangeText={onChange}
        multiline
        numberOfLines={rows}
        textAlignVertical="top"
        placeholderTextColor="#CBD5E1"
      />
      {incomplete && incompleteMessage && (
        <View className="bg-amber-50 border border-amber-300 rounded-lg p-3 mt-2 flex-row items-center">
          <Icon name="alert-circle" size={14} color="#F59E0B" />
          <Text className="text-[11px] font-black text-amber-600 ml-2">{incompleteMessage}</Text>
        </View>
      )}
    </View>
  );
}
