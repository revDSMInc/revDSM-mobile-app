import React from 'react';
import { View, Text } from 'react-native';

interface PremiumQuoteCardProps {
  premium?: number | string;
  monthly?: number | string;
  downPayment?: number | string;
  term?: string;
  status?: string;
  accentColor?: string;
}

export function PremiumQuoteCard({
  premium,
  monthly,
  downPayment,
  term,
  status = 'quoted',
  accentColor = '#3b82f6',
}: PremiumQuoteCardProps) {
  const statusColors: Record<string, string> = {
    quoted: '#3b82f6',
    accepted: '#22c55e',
    pending: '#f59e0b',
    rejected: '#ef4444',
  };

  const statusColor = statusColors[status] || accentColor;

  return (
    <View className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-sm font-bold text-gray-800">Premium Quote</Text>
        <View className="px-2 py-0.5 rounded" style={{ backgroundColor: `${statusColor}15` }}>
          <Text className="text-[10px] font-bold capitalize" style={{ color: statusColor }}>
            {status}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-4">
        <View className="flex-1">
          <Text className="text-[10px] text-gray-500">Premium</Text>
          <Text className="text-lg font-bold" style={{ color: accentColor }}>
            ${premium || '—'}
          </Text>
        </View>
        {monthly && (
          <View className="flex-1">
            <Text className="text-[10px] text-gray-500">Monthly</Text>
            <Text className="text-lg font-bold text-gray-800">${monthly}</Text>
          </View>
        )}
      </View>

      <View className="flex-row gap-4 mt-2">
        {downPayment && (
          <View className="flex-1">
            <Text className="text-[10px] text-gray-500">Down Payment</Text>
            <Text className="text-sm font-semibold text-gray-700">${downPayment}</Text>
          </View>
        )}
        {term && (
          <View className="flex-1">
            <Text className="text-[10px] text-gray-500">Term</Text>
            <Text className="text-sm font-semibold text-gray-700">{term}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
