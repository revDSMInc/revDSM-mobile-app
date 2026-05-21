import React from 'react';
import { View, Text } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const ICON_MAP: Record<string, string> = {
  'account-outline': 'account-outline',
  'tag-outline': 'tag-outline',
  'city-variant-outline': 'city',
  calendar: 'calendar',
  'clock-check-outline': 'clock-check-outline',
  'phone-outline': 'phone-outline',
  'calendar-clock': 'calendar-clock',
  'clock-outline': 'clock-outline',
  'format-list-checks': 'format-list-checks',
  'note-text-outline': 'note-text-outline',
};

type Props = {
  icon: string;
  label: string;
  value: string;
  isLast?: boolean;
};

export function PopupField({ icon, label, value, isLast }: Props) {
  const mciIcon = ICON_MAP[icon] || icon;
  return (
    <View className={`flex-row items-start gap-3 ${isLast ? 'mb-0' : 'mb-4'}`}>
      <View className="w-8 h-8 rounded-lg bg-slate-100 items-center justify-center">
        <MaterialCommunityIcons name={mciIcon} size={16} color="#64748b" />
      </View>
      <View className="flex-1">
        <Text className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</Text>
        <Text className="text-sm font-semibold text-slate-800 mt-0.5">{value}</Text>
      </View>
    </View>
  );
}
