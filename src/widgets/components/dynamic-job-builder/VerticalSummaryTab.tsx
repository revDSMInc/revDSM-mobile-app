import React, { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { buildVerticalSummarySections } from '../../../utils/dynamic-job-builder/engine/vertical-summary-utils';
import { formatComboFieldSummaryValue, resolveGrandTotalColumns } from '../../../utils/dynamic-job-builder/engine/grand-total-utils';

interface VerticalSummaryTabProps {
  vertical?: any;
  verticalState?: any;
  lockedTabIds?: string[];
  dealCenterData?: any;
  applyConditions?: boolean;
}

function SummaryFieldRow({ label, text, variant }: { label?: string; text: string; variant?: string }) {
  const valueColor = variant === 'missing' ? '#ef4444' : '#333';
  return (
    <View className="py-1.5">
      {label && (
        <Text className="text-[11px] text-gray-500 font-semibold">{label}</Text>
      )}
      <Text className="text-sm" style={{ color: valueColor }}>{text}</Text>
    </View>
  );
}

function CombinationSummaryItem({ entry, accentColor, isLast }: { entry: any; accentColor: string; isLast: boolean }) {
  return (
    <View className={isLast ? '' : 'mb-4 pb-4 border-b border-gray-100'}>
      <View className="flex-row items-center gap-2 mb-2">
        <View className="bg-blue-50 px-2 py-0.5 rounded">
          <Text className="text-[10px] font-bold" style={{ color: accentColor }}>
            Combination #{entry.displayNumber}
          </Text>
        </View>
      </View>
      {entry.summaryLine && (
        <Text className="text-sm mb-1">{entry.summaryLine}</Text>
      )}
      {entry.comboFieldRows?.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {entry.comboFieldRows.map((row: any, idx: number) => (
            <SummaryFieldRow key={idx} label={row.label} text={row.text} variant={row.variant} />
          ))}
        </View>
      )}
    </View>
  );
}

export function VerticalSummaryTab({
  vertical,
  verticalState = {},
  lockedTabIds = [],
  dealCenterData = {},
  applyConditions = true,
}: VerticalSummaryTabProps) {
  const summarySections = useMemo(
    () => buildVerticalSummarySections(vertical, verticalState, { lockedTabIds, dealCenterData, applyConditions }),
    [vertical, verticalState, lockedTabIds, dealCenterData, applyConditions]
  );

  return (
    <ScrollView className="p-4">
      <View className="mb-3">
        <Text className="text-xl font-extrabold">Job Builder Summary</Text>
        <Text className="text-sm text-gray-500">Review all configured job details before completing the job.</Text>
      </View>

      {summarySections.length === 0 ? (
        <View className="bg-gray-50 rounded-lg p-4 items-center">
          <Text className="text-sm text-gray-500">No tabs available to summarize.</Text>
        </View>
      ) : (
        summarySections.map((section: any) => (
          <View key={section.tabId} className="bg-white rounded-lg mb-3 overflow-hidden border border-gray-100">
            <View className="px-4 py-3" style={{ backgroundColor: section.accentColor }}>
              <Text className="text-sm font-bold text-white uppercase">{section.tabLabel}</Text>
            </View>
            <View className="px-4 py-4">
              {section.isEmpty ? (
                <Text className="text-sm text-gray-500 italic">No data entered</Text>
              ) : (
                <>
                  {section.combinationSections?.length > 0 && section.combinationSections.map((group: any) => (
                    <View key={group.sectionId} className="mb-3">
                      {group.combinations?.length > 0 && group.combinations.map((entry: any, idx: number) => (
                        <CombinationSummaryItem
                          key={idx}
                          entry={entry}
                          accentColor={section.accentColor}
                          isLast={idx === group.combinations.length - 1}
                        />
                      ))}
                    </View>
                  ))}
                  {section.tabFields?.length > 0 && section.tabFields.map((field: any, idx: number) => (
                    <SummaryFieldRow key={idx} label={field.label} text={field.text} variant={field.variant} />
                  ))}
                </>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
