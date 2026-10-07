import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface AccordionSectionProps {
  label?: string;
  icon?: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  borderColor?: string;
  badge?: { type: string; message: string } | null;
}

export function AccordionSection({
  label,
  icon,
  children,
  defaultExpanded = true,
  borderColor = '#A5E1ED',
  badge,
}: AccordionSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const badgeColor =
    badge?.type === 'error' ? '#f97316' :
    badge?.type === 'warning' ? '#FFAB00' :
    badge?.type === 'success' ? '#22C55E' : '#00B8D9';

  const badgeIcon =
    badge?.type === 'success' ? 'check-circle' :
    badge?.type === 'warning' ? 'alert-circle-outline' : 'alert';

  return (
    <View className="mx-3 mb-3 rounded-2xl overflow-hidden shadow-sm" style={{ borderWidth: 1, borderColor }}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between p-3"
        style={{ backgroundColor: '#F0F9FF' }}
      >
        <View className="flex-row items-center gap-2 flex-1">
          {icon && <Icon name={icon} size={18} color="#0EA5E9" />}
          <Text className="text-[13px] font-black text-[#0EA5E9] flex-1 tracking-tight" numberOfLines={1}>
            {label}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {!!badge?.message && (
            <View
              className="flex-row items-center px-2 py-0.5 rounded-full"
              style={{ backgroundColor: badgeColor }}
            >
              <Icon name={badgeIcon} size={12} color="#fff" />
              <Text className="text-[10px] font-black text-white ml-1">{badge.message}</Text>
            </View>
          )}
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="#0EA5E9" />
        </View>
      </TouchableOpacity>
      {expanded && (
        <ScrollView className="px-4 py-3 bg-white" style={{ maxHeight: 220 }} nestedScrollEnabled>
          {children}
        </ScrollView>
      )}
    </View>
  );
}
