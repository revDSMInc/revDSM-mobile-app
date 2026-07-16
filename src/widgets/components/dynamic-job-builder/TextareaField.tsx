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

// Matches the normal Job Builder textarea. Two looks:
//  • Complete/optional → a plain slate label + rounded-2xl bordered input.
//  • Required-but-empty → the amber "INCOMPLETE" card (web IncompleteWarning + the
//    legacy MiscSection reason card): an amber-bordered / amber-tinted wrapper with
//    the ⚠️ warning on top, the field label, then a neutral input box.
export function TextareaField({ label, placeholder, value, onChange, rows = 3, incomplete, incompleteMessage }: TextareaFieldProps) {
  if (incomplete) {
    return (
      <View className="mb-4 rounded-2xl border-2 border-amber-400 bg-amber-50/40 p-4">
        <Text className="text-[13px] font-black text-amber-500 mb-3 leading-5">
          ⚠️ INCOMPLETE - {incompleteMessage || 'Reason Required'}
        </Text>
        {label && (
          <Text className="text-[15px] font-black text-slate-900 mb-3">{label}</Text>
        )}
        <View className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 min-h-[100px]">
          <TextInput
            className="text-[13px] font-black text-black p-0"
            placeholder={placeholder || ''}
            value={value || ''}
            onChangeText={onChange}
            multiline
            numberOfLines={rows}
            textAlignVertical="top"
            placeholderTextColor="#94A3B8"
          />
        </View>
      </View>
    );
  }

  return (
    <View className="mb-3">
      {label && (
        <Text className="text-[11px] font-black text-slate-400 mb-1.5">{label}</Text>
      )}
      <TextInput
        className="bg-white rounded-2xl border-2 border-slate-100 px-5 py-3 text-[12px] font-black text-black"
        placeholder={placeholder || ''}
        value={value || ''}
        onChangeText={onChange}
        multiline
        numberOfLines={rows}
        textAlignVertical="top"
        placeholderTextColor="#CBD5E1"
      />
    </View>
  );
}
