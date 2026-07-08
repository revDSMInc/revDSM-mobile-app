import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface AccordionSectionProps {
  label?: string;
  icon?: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
  borderColor?: string;
  badge?: { type: string; message: string } | null;
}

// Matches the normal Job Builder collapsible tracker (LeafFilter): #A5E1ED border,
// #F0F9FF header, font-black, MCIcon chevrons + status badge.
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
    badge?.type === 'error' ? '#EF4444' :
    badge?.type === 'warning' ? '#F59E0B' :
    badge?.type === 'success' ? '#22C55E' : '#0EA5E9';

  return (
    <View className="mx-3 mb-3 rounded-2xl overflow-hidden shadow-sm" style={{ borderWidth: 1, borderColor }}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between p-3"
        style={{ backgroundColor: badge ? `${badgeColor}12` : '#F0F9FF' }}
      >
        <View className="flex-row items-center gap-2 flex-1">
          {icon && <Icon name={icon} size={18} color="#0EA5E9" />}
          <Text className="text-[13px] font-black text-[#0EA5E9] flex-1 tracking-tight" numberOfLines={1}>
            {label}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {badge && (
            <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${badgeColor}22` }}>
              <Text className="text-[10px] font-black" style={{ color: badgeColor }}>
                {badge.message}
              </Text>
            </View>
          )}
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="#0EA5E9" />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View className="px-4 py-3 bg-white">
          {children}
        </View>
      )}
    </View>
  );
}
