import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

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
  borderColor = '#e5e5ea',
  badge,
}: AccordionSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const badgeColor =
    badge?.type === 'error' ? '#ef4444' :
    badge?.type === 'warning' ? '#f59e0b' :
    badge?.type === 'success' ? '#22c55e' : '#3b82f6';

  return (
    <View className="mb-3 rounded-2xl overflow-hidden" style={{ borderWidth: 1.5, borderColor }}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between px-4 py-3"
        style={{ backgroundColor: badge ? `${badgeColor}10` : '#fafafa' }}
      >
        <View className="flex-row items-center gap-2 flex-1">
          {icon && <Text className="text-base">{icon}</Text>}
          <Text className="text-sm font-bold text-gray-800 flex-1" numberOfLines={1}>
            {label}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {badge && (
            <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${badgeColor}20` }}>
              <Text className="text-[10px] font-bold" style={{ color: badgeColor }}>
                {badge.message}
              </Text>
            </View>
          )}
          <Text className="text-gray-400 text-sm">{expanded ? '▾' : '▸'}</Text>
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
