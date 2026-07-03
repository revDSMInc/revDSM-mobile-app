import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface PriceItem {
  label: string;
  original?: number;
  confirmed?: number;
  adjusted?: number;
  currency?: string;
}

interface ConfirmRolloutPricesProps {
  prices?: PriceItem[];
  onConfirm?: () => void;
  onAdjust?: (index: number, value: number) => void;
  accentColor?: string;
}

export function ConfirmRolloutPrices({
  prices = [],
  onConfirm,
  onAdjust,
  accentColor = '#22c55e',
}: ConfirmRolloutPricesProps) {
  return (
    <View className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <Text className="text-sm font-bold text-gray-800 mb-3">Confirm Rollout Prices</Text>

      {prices.length === 0 ? (
        <Text className="text-sm text-gray-500 text-center py-4">No prices to confirm</Text>
      ) : (
        prices.map((item, index) => (
          <View key={index} className="mb-3 p-3 bg-gray-50 rounded-lg">
            <Text className="text-xs text-gray-500 mb-1">{item.label}</Text>
            <View className="flex-row items-center gap-3">
              {item.original !== undefined && (
                <View className="flex-1">
                  <Text className="text-[10px] text-gray-400">Original</Text>
                  <Text className="text-sm font-semibold text-gray-600">
                    {item.currency || '$'}{item.original}
                  </Text>
                </View>
              )}
              {item.confirmed !== undefined && (
                <View className="flex-1">
                  <Text className="text-[10px] text-gray-400">Confirmed</Text>
                  <Text className="text-sm font-semibold" style={{ color: accentColor }}>
                    {item.currency || '$'}{item.confirmed}
                  </Text>
                </View>
              )}
              {item.adjusted !== undefined && (
                <View className="flex-1">
                  <Text className="text-[10px] text-gray-400">Adjusted</Text>
                  <Text className="text-sm font-semibold text-blue-500">
                    {item.currency || '$'}{item.adjusted}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ))
      )}

      <TouchableOpacity
        onPress={onConfirm}
        className="mt-2 py-3 rounded-xl"
        style={{ backgroundColor: accentColor }}
      >
        <Text className="text-white text-center font-bold">Confirm Prices</Text>
      </TouchableOpacity>
    </View>
  );
}
