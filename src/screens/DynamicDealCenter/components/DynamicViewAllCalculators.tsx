import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDynamicCalculatorSchemas } from '../hooks/useDynamicCalculatorSchemas';

interface DynamicViewAllCalculatorsProps {
  navigation?: NativeStackNavigationProp<any>;
  onSelect?: (verticalId: string) => void;
}

export function DynamicViewAllCalculators({
  navigation,
  onSelect,
}: DynamicViewAllCalculatorsProps) {
  const { verticals, isLoading } = useDynamicCalculatorSchemas();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation?.goBack()}>
          <Text className="text-blue-500 text-sm">← Back</Text>
        </TouchableOpacity>
        <Text className="text-sm font-bold flex-1 text-center">All Calculators</Text>
      </View>

      <ScrollView className="flex-1 p-4">
        {isLoading ? (
          <View className="items-center py-8">
            <Text className="text-gray-400">Loading calculators...</Text>
          </View>
        ) : verticals.length === 0 ? (
          <View className="items-center py-8">
            <Text className="text-gray-400">No calculators found</Text>
          </View>
        ) : (
          verticals.map((vertical) => (
            <TouchableOpacity
              key={vertical.id}
              onPress={() => onSelect?.(vertical.id)}
              className="mb-3 p-4 bg-white rounded-xl border border-gray-100"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-sm font-bold text-gray-800">
                    {vertical.label || vertical.id}
                  </Text>
                  {vertical.tabs && (
                    <Text className="text-xs text-gray-500 mt-1">
                      {vertical.tabs.length} tab{vertical.tabs.length !== 1 ? 's' : ''}
                    </Text>
                  )}
                </View>
                <Text className="text-blue-500 text-sm">→</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
