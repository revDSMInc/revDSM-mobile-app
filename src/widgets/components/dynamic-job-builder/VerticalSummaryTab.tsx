import React, { useMemo } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { buildVerticalSummarySections } from '../../../utils/dynamic-job-builder/engine/vertical-summary-utils';
import { SummaryFinalizeCards } from './agreement/SummaryFinalizeCards';

interface VerticalSummaryTabProps {
  vertical?: any;
  verticalState?: any;
  lockedTabIds?: string[];
  dealCenterData?: any;
  applyConditions?: boolean;
  // Finalize extras (appointment / agreement / order-sheet). Provided only when
  // rendered inside the live Job Builder; absent in preview/config contexts.
  products?: any[];
  /** Calculator form schemas — supply the per-tab category colour (web parity). */
  schemas?: any[];
  repDetails?: any;
  /** Web `useDealEditMode()` — editing an already-resulted deal. */
  editMode?: boolean;
  leadId?: string;
  calculatorResultData?: any;
  customerName?: string;
  isSale?: boolean;
  isDemo?: boolean;
  scheduleTime?: any;
  agreements?: any[];
  orderSheets?: any[];
  rootJobState?: any;
  onUpdateRootState?: (key: string, value: any) => void;
  resolvedDocuments?: { agreements: any[]; orderSheets: any[] };
  setResolvedDocuments?: React.Dispatch<React.SetStateAction<{ agreements: any[]; orderSheets: any[] }>>;
  isDocUploadingRef?: React.MutableRefObject<boolean>;
  /** Resolves to the category's server documents (signed URLs), or null on failure. */
  onUploadDocs?: (cat: 'agreement' | 'orderSheet', payloads: any[]) => Promise<any[] | null>;
}

function SummaryFieldRow({ label, text, variant, showLabel = true }: { label?: string; text: string; variant?: string; showLabel?: boolean }) {
  const valueColor = variant === 'missing' ? '#ef4444' : '#1e293b';
  // Labels come verbatim from the portal-authored schema (`field.label`), which
  // can carry stray whitespace — e.g. " LeafFilter Profile" renders indented
  // while its sibling rows sit flush. Trim for display only; the underlying
  // field data is untouched.
  const labelText = label?.trim();

  // No label → value spans the full width (web `SummaryFieldRow` early return).
  if (!showLabel || !labelText) {
    return (
      <View className="py-1">
        <Text className="text-sm font-medium" style={{ color: valueColor }}>{text}</Text>
      </View>
    );
  }

  // Web parity (`SummaryFieldRow` Grid: label md={4} + value md={8}): the label
  // sits in a left column and the value to its right, instead of stacked — this is
  // the summary layout the web reference shows.
  return (
    <View className="flex-row items-start py-1">
      <Text
        className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider"
        style={{ width: '40%', paddingRight: 8, paddingTop: 2 }}
      >
        {labelText}
      </Text>
      <Text className="text-sm font-medium flex-1" style={{ color: valueColor }}>{text}</Text>
    </View>
  );
}

function LocationRowsDisplay({ locationRows }: { locationRows: any[] }) {
  if (!locationRows?.length) return null;

  const storyMap: Record<string, any[]> = {};
  locationRows.forEach((row) => {
    row.entries.forEach((entry: any) => {
      if (!storyMap[entry.story]) storyMap[entry.story] = [];
      storyMap[entry.story].push({
        location: row.location,
        value: entry.value,
        unit: entry.unit || 'ft',
      });
    });
  });

  const storyOrder = Object.keys(storyMap);

  return (
    <View className="mt-1 pl-1">
      {storyOrder.map((story) => (
        <View key={story} className="flex-row mb-0.5">
          <Text className="text-[10px] text-slate-400 font-semibold w-16">{story}</Text>
          <Text className="text-[10px] text-slate-600 flex-1">
            {storyMap[story]
              .map((item) => `${item.location}: ${item.value}${item.unit}`)
              .join(', ')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ExtrasList({ label, items }: { label?: string; items: any[] }) {
  if (!items?.length) return null;

  return (
    <View className="mt-2.5">
      {label && (
        <Text className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{label}</Text>
      )}
      <View className="space-y-1">
        {items.map((item, index) => (
          <SummaryFieldRow
            key={index}
            label={item.label}
            text={item.text}
            variant={item.variant}
            showLabel={Boolean(item.label)}
          />
        ))}
      </View>
    </View>
  );
}

function CombinationSummaryItem({ entry, accentColor, isLast }: { entry: any; accentColor: string; isLast: boolean }) {
  // Web parity (`CombinationSummaryItem` Grid: label md={4} + body md={8}): the
  // "Combination #N" chip sits in a left column with the combo's summary line to
  // its right; the per-field rows below keep the same label/value column split so
  // labels align under the chip — matching the web summary reference layout.
  return (
    <View className={isLast ? '' : 'mb-3 pb-3 border-b border-slate-100'}>
      <View className="flex-row items-start">
        <View style={{ width: '40%', paddingRight: 8 }}>
          <View className="self-start px-2 py-0.5 rounded" style={{ backgroundColor: `${accentColor}1A` }}>
            <Text className="text-[9px] font-bold" style={{ color: accentColor }}>
              Combination #{entry.displayNumber}
            </Text>
          </View>
        </View>
        <View className="flex-1">
          {entry.summaryLine && (
            <Text className="text-sm font-semibold text-slate-800">{entry.summaryLine}</Text>
          )}
          <LocationRowsDisplay locationRows={entry.locationRows} />
        </View>
      </View>
      {entry.comboFieldRows?.length > 0 && (
        <View className="mt-1 space-y-1">
          {entry.comboFieldRows.map((row: any, idx: number) => (
            <SummaryFieldRow key={idx} label={row.label} text={row.text} variant={row.variant} />
          ))}
        </View>
      )}
      <ExtrasList items={entry.comboExtras} />
    </View>
  );
}

export function VerticalSummaryTab({
  vertical,
  verticalState = {},
  lockedTabIds = [],
  dealCenterData = {},
  applyConditions = true,
  products,
  schemas,
  repDetails,
  editMode,
  leadId,
  calculatorResultData,
  customerName,
  isSale,
  isDemo,
  scheduleTime,
  agreements,
  orderSheets,
  rootJobState,
  onUpdateRootState,
  resolvedDocuments,
  setResolvedDocuments,
  isDocUploadingRef,
  onUploadDocs,
}: VerticalSummaryTabProps) {
  // `products` + `schemas` feed `resolveTabAccentColor` (web parity): they carry the
  // per-tab category colour that gives each summary card its own header colour.
  // They were previously omitted, so every card fell through to `vertical.color`
  // — one colour shared by every tab, which is why all headers rendered the same.
  const summarySections = useMemo(
    () =>
      buildVerticalSummarySections(vertical, verticalState, {
        lockedTabIds,
        dealCenterData,
        applyConditions,
        products,
        schemas,
        // Deal-edit: drives the "no rep content → empty summary" gate AND lets
        // formatFieldSummaryValue prefer the rep's live value over the deal-center
        // one for editable locked fields (web parity). Was never threaded, so the
        // summary always fell back to the calculator value.
        editMode,
      }),
    [vertical, verticalState, lockedTabIds, dealCenterData, applyConditions, products, schemas, editMode]
  );

  // Only show the finalize cards inside the live builder (a root-state setter is
  // present); preview/config renders pass none of these and skip the section.
  const showFinalize = Boolean(onUpdateRootState);
  const productKey = vertical?.productId || vertical?.id;

  return (
    <ScrollView
      style={{ flex: 1 }}
      className="p-4"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 160 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // Keep a focused input (appointment / agreement fields) above the keyboard —
      // the screen no longer wraps this in a padding KeyboardAvoidingView.
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
    >
      <View className="mb-4">
        <Text className="text-xl font-extrabold text-slate-850">Job Builder Summary</Text>
        <Text className="text-xs text-slate-500 mt-0.5">Review all configured job details before completing the job.</Text>
      </View>

      {summarySections.length === 0 ? (
        <View className="bg-slate-50 rounded-lg p-5 items-center justify-center border border-slate-100">
          <Text className="text-sm text-slate-400 italic">No tabs available to summarize.</Text>
        </View>
      ) : (
        summarySections.map((section: any) => {
          const hasCombinations = section.combinationSections?.some((g: any) => g.combinations?.length > 0 || g.extras?.length > 0);
          const hasSimple = section.simpleSections?.length > 0;
          const hasTabFields = section.tabFields?.length > 0;

          return (
            <View key={section.tabId} className="bg-white rounded-xl mb-4 overflow-hidden border border-slate-100 shadow-sm">
              <View className="px-4 py-3" style={{ backgroundColor: section.accentColor }}>
                <Text className="text-xs font-bold text-white uppercase tracking-wider">{section.tabLabel}</Text>
              </View>
              <View className="p-4">
                {section.isEmpty ? (
                  <Text className="text-xs text-slate-400 italic">No data entered</Text>
                ) : (
                  <View className="space-y-4">
                    {hasCombinations && section.combinationSections.map((group: any) => (
                      <View key={group.sectionId}>
                        {group.sectionLabel && (
                          <Text className="text-xs font-bold text-slate-700 mb-2">{group.sectionLabel}</Text>
                        )}
                        {group.combinations?.length > 0 && group.combinations.map((entry: any, idx: number) => (
                          <CombinationSummaryItem
                            key={idx}
                            entry={entry}
                            accentColor={section.accentColor}
                            isLast={idx === group.combinations.length - 1 && !group.extras?.length}
                          />
                        ))}
                        <ExtrasList label={group.extrasLabel} items={group.extras} />
                      </View>
                    ))}

                    {hasSimple && section.simpleSections.map((group: any) => (
                      <View key={group.sectionId} className="pt-2 border-t border-slate-50">
                        {group.sectionLabel && (
                          <Text className="text-xs font-bold text-slate-700 mb-2">{group.sectionLabel}</Text>
                        )}
                        <View className="space-y-2">
                          {group.fields.map((field: any, idx: number) => (
                            <SummaryFieldRow key={idx} label={field.label} text={field.text} variant={field.variant} />
                          ))}
                        </View>
                      </View>
                    ))}

                    {hasTabFields && (
                      <View className="pt-2 border-t border-slate-50 space-y-2">
                        {section.tabFields.map((field: any, idx: number) => (
                          <SummaryFieldRow key={idx} label={field.label} text={field.text} variant={field.variant} />
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })
      )}

      {showFinalize && (
        <SummaryFinalizeCards
          leadId={leadId}
          isSale={isSale}
          isDemo={isDemo}
          customerName={customerName}
          scheduleTime={scheduleTime}
          agreements={agreements}
          orderSheets={orderSheets}
          onUpdateRootState={onUpdateRootState}
          resolvedDocuments={resolvedDocuments}
          setResolvedDocuments={setResolvedDocuments}
          isDocUploadingRef={isDocUploadingRef}
          onUploadDocs={onUploadDocs}
          // SummaryFinalizeCards declares + destructures repDetails and hands it to
          // DynamicAgreementDialog, but nothing was passing it — generated
          // agreements got `repDetails={undefined}`.
          repDetails={repDetails}
          editMode={editMode}
          productKey={productKey}
          verticalState={verticalState}
          jobState={rootJobState}
          calculatorResultData={calculatorResultData}
        />
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
