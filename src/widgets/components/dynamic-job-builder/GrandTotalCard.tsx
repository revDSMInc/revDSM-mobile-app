import React from 'react';
import { View, Text } from 'react-native';
import { resolveGrandTotalColumns, formatComboFieldSummaryValue, computeSectionCombinationsTotal, buildSectionTotalLabel, getSectionTotalUnit } from '../../../utils/dynamic-job-builder/engine/grand-total-utils';

interface GrandTotalCombo {
  [key: string]: any;
}

interface GrandTotalCardProps {
  combinations?: GrandTotalCombo[];
  fields?: any[];
  summaryField?: any;
  sectionLabel?: string;
  accentColor?: string;
}

export function GrandTotalCard({
  combinations = [],
  fields = [],
  summaryField,
  sectionLabel,
  accentColor = '#22c55e',
}: GrandTotalCardProps) {
  const columns = resolveGrandTotalColumns(fields, summaryField);
  const total = computeSectionCombinationsTotal(fields, combinations, summaryField);
  const totalUnit = getSectionTotalUnit(fields, summaryField);
  const title = summaryField?.label || 'GRAND TOTAL - ALL COMBINATIONS';
  const footerLabel = buildSectionTotalLabel(sectionLabel, summaryField?.footerLabel);

  if (!columns.length || !combinations.length) return null;

  return (
    <View
      className="rounded-lg p-4"
      style={{ backgroundColor: `${accentColor}08`, borderWidth: 2, borderColor: `${accentColor}30` }}
    >
      <Text
        className="text-sm font-bold mb-3 tracking-wide uppercase"
        style={{ color: accentColor }}
      >
        {title}
      </Text>

      {combinations.map((combo, index) => (
        <View
          key={index}
          className="p-3 rounded mb-2 border"
          style={{ borderColor: `${accentColor}20`, backgroundColor: 'rgba(255,255,255,0.5)' }}
        >
          <View className="flex-row items-center gap-2 mb-2">
            <View className="bg-blue-50 px-2 py-0.5 rounded">
              <Text className="text-[10px] font-bold text-blue-500">#{index + 1}</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {columns.map((field, colIndex) => {
              const { text, variant } = formatComboFieldSummaryValue(field, combo, {
                emptyMessage: field.emptyMessage,
              });
              return (
                <View key={field.id || colIndex} className="min-w-[80px]">
                  <Text className="text-[10px] text-gray-500">{field.label || field.key}</Text>
                  <Text
                    className="text-[11px]"
                    style={{
                      color: variant === 'missing' ? '#ef4444' : variant === 'total' ? accentColor : '#333',
                      fontWeight: variant === 'total' ? '700' : '600',
                    }}
                  >
                    {text}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {columns.some((field) => field.type === 'locationGrid' && !field.unmapped) && (
        <View className="mt-3 pt-3 border-t border-gray-200">
          <Text className="text-base font-bold" style={{ color: accentColor }}>
            {footerLabel}: {total} {totalUnit}
          </Text>
        </View>
      )}
    </View>
  );
}
