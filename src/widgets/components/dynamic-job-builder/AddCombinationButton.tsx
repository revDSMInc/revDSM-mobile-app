import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface AddCombinationButtonProps {
  onClick?: () => void;
  label?: string;
}

export function AddCombinationButton({ onClick, label = 'Add Combination' }: AddCombinationButtonProps) {
  return (
    <TouchableOpacity
      onPress={onClick}
      className="mx-3 mb-6 h-14 rounded-2xl border border-slate-200 items-center justify-center flex-row bg-white"
    >
      <Icon name="plus" size={16} color="#94A3B8" />
      <Text className="text-slate-400 font-black text-[11px] ml-2">{label}</Text>
    </TouchableOpacity>
  );
}
