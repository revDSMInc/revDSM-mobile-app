import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface LockedFieldProps {
  label?: string;
  value?: string | number;
  caption?: string;
}

// Matches the normal Job Builder locked extras row (GutterSection/LeafFilter):
// label + value stacked left, #CBD5E1 lock icon right, slate + font-black.
export function LockedField({ label, value }: LockedFieldProps) {
  return (
    <View className="flex-row justify-between items-center border-b border-slate-50 pb-4 mb-4">
      <View className="flex-1 pr-3">
        {label && <Text className="text-[10px] font-black text-slate-400 mb-1">{label}</Text>}
        <Text className="text-xs font-black text-slate-800">{value ?? '—'}</Text>
      </View>
      <Icon name="lock" size={18} color="#CBD5E1" />
    </View>
  );
}
