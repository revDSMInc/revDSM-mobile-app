import React from 'react';
import { View, Text } from 'react-native';

type Props = {
  label: string;
  value: string;
  fullWidth?: boolean;
};

export function DetailItem({ label, value, fullWidth }: Props) {
  return (
    <View className={fullWidth ? 'w-full mb-3' : 'w-[47%] mb-3'}>
      <Text className="text-[13px] text-slate-400 mb-1">{label}</Text>
      <Text className="text-[15px] font-semibold text-slate-800">{value}</Text>
    </View>
  );
}
