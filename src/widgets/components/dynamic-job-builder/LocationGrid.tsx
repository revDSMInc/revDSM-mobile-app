import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { computeGridTotal } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import { computeColumnTotal, resolveLocationGridConfig } from '../../../utils/dynamic-job-builder/engine/location-grid-utils';

interface LocationGridProps {
  label?: string;
  value?: any;
  onChange?: (val: any) => void;
  field?: any;
  singleStory?: boolean;
}

export function LocationGrid({ label = 'Measurements', value = {}, onChange, field, singleStory }: LocationGridProps) {
  const config = resolveLocationGridConfig(field || { singleStory });
  const { rows, rowHeaderLabel, unit } = config;
  const columns = config.columns || [];

  const update = (rowKey: string, colKey: string, val: string) => {
    const next = { ...(value || {}) };
    if (!next[rowKey]) next[rowKey] = {};
    next[rowKey][colKey] = val === '' ? '' : Number(val) || 0;
    onChange?.(computeGridTotal(next) > 0 ? next : null);
  };

  const grandTotal = computeGridTotal(value);

  return (
    <View className="mb-2">
      <Text className="text-sm font-bold text-gray-500 mb-3">{label}</Text>

      <View className="min-w-[280px]">
        <View className="flex-row gap-1 mb-2">
          <View className="flex-[1.15] min-w-0">
            <Text className="text-[10px] font-bold text-gray-500 uppercase">{rowHeaderLabel}</Text>
          </View>
          {columns.map((col: any) => (
            <View key={col.key} className="flex-1 min-w-0 items-center">
              <Text className="text-[10px] font-bold text-gray-500 uppercase">{col.label}</Text>
            </View>
          ))}
        </View>

        {rows.map((row: any) => (
          <View key={row.key} className="flex-row gap-1 items-center mb-1">
            <View className="flex-[1.15] min-w-0">
              <Text className="text-[10px] font-semibold text-gray-700 uppercase">{row.label}</Text>
            </View>
            {columns.map((col: any) => (
              <View key={col.key} className="flex-1 min-w-0">
                <TextInput
                  className="bg-gray-50 rounded p-2 text-center text-sm border border-gray-100"
                  keyboardType="numeric"
                  value={
                    value?.[row.key]?.[col.key] === 0 || value?.[row.key]?.[col.key] === '0'
                      ? ''
                      : value?.[row.key]?.[col.key] || ''
                  }
                  onChangeText={(val) => update(row.key, col.key, val)}
                  placeholder="0"
                  placeholderTextColor="#999"
                />
              </View>
            ))}
          </View>
        ))}

        <View className="flex-row gap-1 items-center mt-2">
          <View className="flex-[1.15] min-w-0">
            <Text className="text-[11px] font-black text-gray-900">TOTAL</Text>
          </View>
          {columns.map((col: any) => (
            <View key={col.key} className="flex-1 min-w-0">
              <View className="py-2.5 items-center rounded bg-blue-50 border border-blue-100">
                <Text className="text-sm font-extrabold text-blue-500">
                  {computeColumnTotal(value, rows, col.key)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View className="mt-2 bg-green-500 rounded-lg py-2.5 items-center">
          <Text className="text-white text-sm font-bold">Grand Total: {grandTotal} {unit}</Text>
        </View>
      </View>
    </View>
  );
}
