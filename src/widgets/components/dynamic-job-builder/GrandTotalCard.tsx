import React from 'react';
import { View, Text } from 'react-native';
import {
  resolveGrandTotalColumns,
  formatComboFieldSummaryValue,
  computeSectionCombinationsTotal,
  computeTabCombinationsGrandTotal,
  getTabGrandTotalUnit,
  buildSectionTotalLabel,
  buildTabTotalLabel,
  getSectionTotalUnit,
} from '../../../utils/dynamic-job-builder/engine/grand-total-utils';

interface GrandTotalCombo {
  [key: string]: any;
}

/** One row of the tab-level grand total: a combo tied to the section it came from. */
interface TabSummaryEntry {
  combo: GrandTotalCombo;
  section: any;
  summaryField?: any;
  displayNumber?: number;
}

interface GrandTotalCardProps {
  // Section-scoped path (single combination section).
  combinations?: GrandTotalCombo[];
  fields?: any[];
  summaryField?: any;
  sectionLabel?: string;
  // Tab-scoped path (web `TabCombinationsGrandTotalSummary`): aggregates combos
  // across EVERY combination section in the tab. When provided, takes precedence
  // over the section-scoped props — a Gutter+LeafFilter tab has two combination
  // sections and the grand total must sum both, not just the last one.
  entries?: TabSummaryEntry[];
  tabLabel?: string;
  accentColor?: string;
}

// Matches the normal LeafFilter "Grand Total - All Combinations" card:
// rounded-[32px], emerald border, per-combo slate cards, #22C55E totals.
export function GrandTotalCard({
  combinations = [],
  fields = [],
  summaryField,
  sectionLabel,
  entries,
  tabLabel,
  accentColor = '#22C55E',
}: GrandTotalCardProps) {
  // Tab-level aggregation (web parity) — render one row per entry, resolving
  // columns against each entry's OWN section, and total across all of them.
  if (entries && entries.length) {
    return (
      <TabGrandTotalCard
        entries={entries}
        tabLabel={tabLabel || sectionLabel}
        accentColor={accentColor}
      />
    );
  }

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
        <ComboSummaryRow
          key={index}
          combo={combo}
          columns={columns}
          displayNumber={index + 1}
          accentColor={accentColor}
        />
      ))}

      {columns.some((field: any) => field.type === 'locationGrid' && !field.unmapped) && (
        <View className="mt-4 pt-4 border-t-2 flex-row justify-between items-center px-1" style={{ borderColor: accentColor }}>
          <Text className="text-[14px] font-black" style={{ color: accentColor }}>{footerLabel}</Text>
          <Text className="text-[20px] font-black" style={{ color: accentColor }}>{total} {totalUnit}</Text>
        </View>
      )}
    </View>
  );
}

/** Tab-level grand total (port of web `TabCombinationsGrandTotalSummary`). */
function TabGrandTotalCard({
  entries,
  tabLabel,
  accentColor,
}: {
  entries: TabSummaryEntry[];
  tabLabel?: string;
  accentColor: string;
}) {
  const total = computeTabCombinationsGrandTotal(entries);
  const totalUnit = getTabGrandTotalUnit(entries);
  const footerLabel = buildTabTotalLabel(tabLabel || '', '');
  // Show a per-row section sub-label only when the entries span >1 section.
  const showSectionLabels =
    new Set(entries.map((entry) => entry.section?.id).filter(Boolean)).size > 1;
  const hasGridTotal = entries.some(({ section, summaryField }) =>
    resolveGrandTotalColumns(section?.fields || [], summaryField).some(
      (field: any) => field.type === 'locationGrid' && !field.unmapped,
    ),
  );

  if (!entries.length) return null;

  return (
    <View className="bg-white rounded-[32px] p-6 border border-emerald-100 mx-3 mb-6">
      <Text className="text-[12px] font-black mb-5" style={{ color: accentColor }}>
        Grand Total - All Combinations
      </Text>

      {entries.map((entry, index) => {
        const columns = resolveGrandTotalColumns(entry.section?.fields || [], entry.summaryField);
        if (!columns.length) return null;
        return (
          <ComboSummaryRow
            key={`${entry.section?.id}-${entry.displayNumber ?? index}`}
            combo={entry.combo}
            columns={columns}
            displayNumber={entry.displayNumber ?? index + 1}
            accentColor={accentColor}
            sectionLabel={showSectionLabels ? entry.section?.label : undefined}
          />
        );
      })}

      {hasGridTotal && (
        <View className="mt-4 pt-4 border-t-2 flex-row justify-between items-center px-1" style={{ borderColor: accentColor }}>
          <Text className="text-[14px] font-black" style={{ color: accentColor }}>{footerLabel}</Text>
          <Text className="text-[20px] font-black" style={{ color: accentColor }}>{total} {totalUnit}</Text>
        </View>
      )}
    </View>
  );
}

/** A single combo row — a #N chip, an optional section sub-label, then the columns. */
function ComboSummaryRow({
  combo,
  columns,
  displayNumber,
  accentColor,
  sectionLabel,
}: {
  combo: GrandTotalCombo;
  columns: any[];
  displayNumber: number;
  accentColor: string;
  sectionLabel?: string;
}) {
  return (
    <View className="mb-4 bg-slate-50/60 p-4 rounded-2xl border border-slate-100">
      <View className="self-start px-2 py-0.5 rounded-lg mb-3" style={{ backgroundColor: `${accentColor}20` }}>
        <Text className="text-[10px] font-black" style={{ color: accentColor }}>#{displayNumber}</Text>
      </View>
      {sectionLabel ? (
        <Text className="text-[10px] font-bold text-slate-500 mb-2">{sectionLabel}</Text>
      ) : null}
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
  );
}
