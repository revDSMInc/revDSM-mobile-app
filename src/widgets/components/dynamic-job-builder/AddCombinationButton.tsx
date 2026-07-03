import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface AddCombinationButtonProps {
  onClick?: () => void;
  label?: string;
}

export function AddCombinationButton({ onClick, label = '+ Add Combination' }: AddCombinationButtonProps) {
  return (
    <TouchableOpacity
      onPress={onClick}
      className="mx-3 mb-4 py-4 rounded-2xl items-center justify-center flex-row gap-2"
      style={{
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167,139,250,0.04)',
      }}
    >
      <Text className="text-sm font-bold text-purple-600">{label}</Text>
    </TouchableOpacity>
  );
}
