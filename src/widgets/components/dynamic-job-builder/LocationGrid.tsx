import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { computeGridTotal } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import { computeColumnTotal, resolveLocationGridConfig, resolveVisibleColumns } from '../../../utils/dynamic-job-builder/engine/location-grid-utils';

interface LocationGridProps {
  label?: string;
  value?: any;
  onChange?: (val: any) => void;
  field?: any;
  singleStory?: boolean;
  dealCenterData?: any;
  state?: any;
  applyConditions?: boolean;
}

// Removes any column not in the visible set so hidden-column data never leaks
// into totals or the persisted value (matches web stripHiddenColumns).
function stripToVisibleColumns(value: any, visibleKeys: Set<string>) {
  if (!value || typeof value !== 'object') return value;
  const next: any = {};
  Object.keys(value).forEach((rowKey) => {
    const row = value[rowKey];
    if (!row || typeof row !== 'object') {
      next[rowKey] = row;
      return;
    }
    const nextRow: any = {};
    Object.keys(row).forEach((colKey) => {
      if (visibleKeys.has(colKey)) nextRow[colKey] = row[colKey];
    });
    next[rowKey] = nextRow;
  });
  return next;
}

/**
 * The text shown in a grid cell. Web parity (`location-grid.js`): 0 / '0' / empty
 * render blank so the "0" placeholder shows through.
 *
 * The value MUST be stringified: `update()` stores cell values as numbers, and
 * React Native's TextInput only renders a `string` — passing the raw number left
 * the cell blank even though the row/column totals (which read state directly)
 * counted it. Web gets away with the raw value because an HTML input coerces it.
 */
function cellText(raw: any): string {
  if (raw === 0 || raw === '0' || raw == null || raw === '') return '';
  return String(raw);
}

// Styled to match the normal Job Builder measurement grid (GutterSection /
// LeafFilterSection): slate-50 rounded input cells, font-black, sky totals,
// #22C55E grand-total bar.
export function LocationGrid({ label = 'Measurements', value = {}, onChange, field, singleStory, dealCenterData = {}, state = {}, applyConditions = true }: LocationGridProps) {
  const config = resolveLocationGridConfig(field || { singleStory });
  const { rows, rowHeaderLabel, unit } = config;
  // Per-column visibleWhen gating (e.g. hide "3rd Story" unless the deal has 3 stories).
  const columns = resolveVisibleColumns({ columns: config.columns || [] }, dealCenterData, state, applyConditions);
  const visibleKeys = new Set<string>(columns.map((c: any) => c.key));

  const update = (rowKey: string, colKey: string, val: string) => {
    const next = { ...(value || {}) };
    if (!next[rowKey]) next[rowKey] = { ...(value?.[rowKey] || {}) };
    next[rowKey][colKey] = val === '' ? '' : Number(val) || 0;
    const stripped = stripToVisibleColumns(next, visibleKeys);
    onChange?.(computeGridTotal(stripped) > 0 ? stripped : null);
  };

  const grandTotal = computeGridTotal(stripToVisibleColumns(value, visibleKeys));

  return (
    <View className="mb-3">
      <Text className="text-[11px] font-black text-slate-500 mb-3">{label}</Text>

      <View className="min-w-[280px]">
        <View className="flex-row items-center mb-2">
          <View className="flex-[1.4] items-start pl-1">
            <Text className="text-[7px] font-black text-slate-400 uppercase">{rowHeaderLabel}</Text>
          </View>
          {columns.map((col: any) => (
            <View key={col.key} className="flex-1 items-center">
              <Text className="text-[7px] font-black text-slate-400 uppercase">{col.label}</Text>
            </View>
          ))}
        </View>

        {rows.map((row: any) => (
          <View key={row.key} className="flex-row items-center mb-2">
            <View className="flex-[1.4] pr-1">
              <Text className="text-[9px] font-black text-slate-600 uppercase">{row.label}</Text>
            </View>
            {columns.map((col: any) => (
              <View key={col.key} className="flex-1 px-1">
                <TextInput
                  className="h-10 bg-slate-50 rounded-xl border border-slate-200 text-center text-[12px] font-black text-black"
                  keyboardType="number-pad"
                  value={cellText(value?.[row.key]?.[col.key])}
                  onChangeText={(val) => update(row.key, col.key, val)}
                  placeholder="0"
                  placeholderTextColor="#CBD5E1"
                />
              </View>
            ))}
          </View>
        ))}

        <View className="flex-row items-center mt-2">
          <View className="flex-[1.4] pl-1">
            <Text className="text-[9px] font-black text-slate-900">TOTAL</Text>
          </View>
          {columns.map((col: any) => (
            <View key={col.key} className="flex-1 px-1">
              <View className="py-2 items-center rounded-xl bg-sky-50 border border-sky-100">
                <Text className="text-[13px] font-black text-sky-500">
                  {computeColumnTotal(value, rows, col.key)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View className="mt-4 bg-[#22C55E] h-12 rounded-2xl items-center justify-center">
          <Text className="text-white text-[12px] font-black">Grand Total: {grandTotal} {unit}</Text>
        </View>
      </View>
    </View>
  );
}
