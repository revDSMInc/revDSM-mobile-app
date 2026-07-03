import React from 'react';
import { View, Text, ScrollView } from 'react-native';

interface SummaryItem {
  id?: string;
  label?: string;
  value?: any;
  unit?: string;
  variant?: string;
}

interface DynamicCalculatorSummaryProps {
  items?: SummaryItem[];
  accentColor?: string;
}

export function DynamicCalculatorSummary({ items = [], accentColor = '#3b82f6' }: DynamicCalculatorSummaryProps) {
  return (
    <ScrollView className="p-4">
      <View className="mb-4">
        <Text className="text-lg font-bold" style={{ color: accentColor }}>Calculator Summary</Text>
      </View>

      {items.length === 0 ? (
        <View className="bg-gray-50 rounded-xl p-4">
          <Text className="text-sm text-gray-500 text-center">No data available</Text>
        </View>
      ) : (
        items.map((item, index) => {
          const valueColor = item.variant === 'missing' ? '#ef4444' : item.variant === 'total' ? accentColor : '#333';
          return (
            <View key={item.id || index} className="mb-3 p-3 bg-white rounded-lg border border-gray-100">
              {item.label && (
                <Text className="text-xs text-gray-500 mb-1">{item.label}</Text>
              )}
              <Text className="text-sm font-semibold" style={{ color: valueColor }}>
                {item.value ?? '—'}{item.unit ? ` ${item.unit}` : ''}
              </Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}
