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

// Matches the normal LeafFilter "Grand Total - All Combinations" card:
// rounded-[32px], emerald border, per-combo slate cards, #22C55E totals.
export function GrandTotalCard({
  combinations = [],
  fields = [],
  summaryField,
  sectionLabel,
  accentColor = '#22C55E',
}: GrandTotalCardProps) {
  const columns = resolveGrandTotalColumns(fields, summaryField);
  const total = computeSectionCombinationsTotal(fields, combinations, summaryField);
  const totalUnit = getSectionTotalUnit(fields, summaryField);
  const title = summaryField?.label || 'Grand Total - All Combinations';
  const footerLabel = buildSectionTotalLabel(sectionLabel, summaryField?.footerLabel);

  if (!columns.length || !combinations.length) return null;

  return (
    <View className="bg-white rounded-[32px] p-6 border border-emerald-100 mx-3 mb-6">
      <Text className="text-[12px] font-black mb-5" style={{ color: accentColor }}>
        {title}
      </Text>

      {combinations.map((combo, index) => (
        <View
          key={index}
          className="mb-4 bg-slate-50/60 p-4 rounded-2xl border border-slate-100"
        >
          <View className="self-start px-2 py-0.5 rounded-lg mb-3" style={{ backgroundColor: `${accentColor}20` }}>
            <Text className="text-[10px] font-black" style={{ color: accentColor }}>#{index + 1}</Text>
          </View>
          <View className="flex-row flex-wrap gap-3">
            {columns.map((field, colIndex) => {
              const { text, variant } = formatComboFieldSummaryValue(field, combo, {
                emptyMessage: field.emptyMessage,
              });
              return (
                <View key={field.id || colIndex} className="min-w-[80px]">
                  <Text className="text-[8px] font-bold text-slate-400 mb-0.5">{field.label || field.key}</Text>
                  <Text
                    className="text-[10px] font-black"
                    style={{ color: variant === 'missing' ? '#EF4444' : variant === 'total' ? accentColor : '#1E293B' }}
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
        <View className="mt-4 pt-4 border-t-2 flex-row justify-between items-center px-1" style={{ borderColor: accentColor }}>
          <Text className="text-[14px] font-black" style={{ color: accentColor }}>{footerLabel}</Text>
          <Text className="text-[20px] font-black" style={{ color: accentColor }}>{total} {totalUnit}</Text>
        </View>
      )}
    </View>
  );
}
