import React, { useMemo } from 'react';
import { View, Text, Platform } from 'react-native';
import Reanimated from 'react-native-reanimated';
import {
  buildVerticalSummarySections,
  formatStoryMeasurementLine,
} from '../../../utils/dynamic-job-builder/engine/vertical-summary-utils';
import { SummaryFinalizeCards } from './agreement/SummaryFinalizeCards';
import { useGetAgreementConfig } from '../../../screens/DynamicDealCenter/hooks/useAgreementConfig';
import { useGetDescriptionSchema } from '../../../screens/DynamicDealCenter/hooks/useDescriptionSchema';
import { useCompanyLogoBase64 } from '../../../hooks/useCompanyLogoBase64';

interface VerticalSummaryTabProps {
  vertical?: any;
  verticalState?: any;
  lockedTabIds?: string[];
  dealCenterData?: any;
  applyConditions?: boolean;
  products?: any[];
  schemas?: any[];
  repDetails?: any;
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
  onUploadDocs?: (cat: 'agreement' | 'orderSheet', payloads: any[]) => Promise<any[] | null>;
  onRefreshDocs?: (cat: 'agreement' | 'orderSheet') => Promise<any[] | null>;
  collapsingScrollProps?: Record<string, any>;
  collapsingTopInset?: number;
}

function SummaryFieldRow({ label, text, variant, showLabel = true }: { label?: string; text: string; variant?: string; showLabel?: boolean }) {
  const valueColor = variant === 'missing' ? '#ef4444' : '#1e293b';
  const labelText = label?.trim();

  if (!showLabel || !labelText) {
    return (
      <View className="py-1">
        <Text className="text-base font-medium" style={{ color: valueColor }}>{text}</Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-start py-1">
      <Text
        className="text-xs text-slate-500 font-semibold uppercase tracking-wider"
        style={{ width: '40%', paddingRight: 8, paddingTop: 2 }}
      >
        {labelText}
      </Text>
      <Text className="text-base font-medium flex-1" style={{ color: valueColor }}>{text}</Text>
    </View>
  );
}

function LocationSummaryRows({ locationRows }: { locationRows: any[] }) {
  if (!locationRows?.length) return null;

  const storyMap: Record<string, any[]> = {};
  locationRows.forEach((row) => {
    (row.entries || []).forEach((entry: any) => {
      if (!storyMap[entry.story]) storyMap[entry.story] = [];
      storyMap[entry.story].push({
        location: row.location,
        value: entry.value,
        unit: entry.unit || 'ft',
      });
    });
  });

  return (
    <>
      {Object.keys(storyMap).map((story) => {
        const text = formatStoryMeasurementLine(storyMap[story]);
        return <SummaryFieldRow key={story} label={story} text={text} />;
      })}
    </>
  );
}

function ExtrasList({ label, items }: { label?: string; items: any[] }) {
  if (!items?.length) return null;

  return (
    <View className="mt-2.5">
      {label && (
        <Text className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{label}</Text>
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

const DIVIDER_STRONG = '#CBD5E1'; // ≈ alpha(divider, 0.4)
const DIVIDER_HAIRLINE = '#F1F5F9'; // ≈ alpha(divider, 0.12)

function CombinationSummaryItem({ entry, accentColor, isLast }: { entry: any; accentColor: string; isLast: boolean }) {
  return (
    <View
      style={
        isLast
          ? undefined
          : {
              borderBottomWidth: 1,
              borderBottomColor: DIVIDER_STRONG,
              paddingBottom: 16,
              marginBottom: 22,
            }
      }
    >
      <View className="flex-row items-start">
        <View style={{ width: '40%', paddingRight: 8 }}>
          <View className="self-start px-2 py-0.5 rounded" style={{ backgroundColor: `${accentColor}1A` }}>
            <Text className="text-xs font-bold" style={{ color: accentColor }}>
              Combination #{entry.displayNumber}
            </Text>
          </View>
        </View>
        <View className="flex-1">
          {entry.summaryLine && (
            <Text className="text-base font-semibold text-slate-800">{entry.summaryLine}</Text>
          )}
        </View>
      </View>
      {/* The field rows and the measurement rows are ONE list: the stories are ordinary rows and
          belong at the end of it, after Color, as the portal's table has them. */}
      {(entry.comboFieldRows?.length > 0 || entry.locationRows?.length > 0) && (
        <View className="mt-1 space-y-1">
          {entry.comboFieldRows?.map((row: any, idx: number) => (
            <SummaryFieldRow key={idx} label={row.label} text={row.text} variant={row.variant} />
          ))}
          <LocationSummaryRows locationRows={entry.locationRows} />
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
  onRefreshDocs,
  collapsingScrollProps,
  collapsingTopInset = 0,
}: VerticalSummaryTabProps) {
  const summarySections = useMemo(
    () =>
      buildVerticalSummarySections(vertical, verticalState, {
        lockedTabIds,
        dealCenterData,
        applyConditions,
        products,
        schemas,
        editMode,
      }),
    [vertical, verticalState, lockedTabIds, dealCenterData, applyConditions, products, schemas, editMode]
  );

  const showFinalize = Boolean(onUpdateRootState);
  const productKey = vertical?.productId || vertical?.id;

  useGetAgreementConfig(showFinalize);
  useGetDescriptionSchema(showFinalize ? productKey : undefined);
  useCompanyLogoBase64(showFinalize);

  return (
    <Reanimated.ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16, paddingTop: 16 + collapsingTopInset, paddingBottom: 160 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      {...collapsingScrollProps}
    >
      <View className="mb-4">
        <Text className="text-xl font-extrabold text-slate-850">Job Builder Summary</Text>
        <Text className="text-sm text-slate-500 mt-0.5">Review all configured job details before completing the job.</Text>
      </View>

      {summarySections.length === 0 ? (
        <View className="bg-slate-50 rounded-lg p-5 items-center justify-center border border-slate-100">
          <Text className="text-base text-slate-400 italic">No tabs available to summarize.</Text>
        </View>
      ) : (
        summarySections.map((section: any) => {
          const hasCombinations = section.combinationSections?.some((g: any) => g.combinations?.length > 0 || g.extras?.length > 0);
          const hasSimple = section.simpleSections?.length > 0;
          const hasTabFields = section.tabFields?.length > 0;

          return (
            <View key={section.tabId} className="bg-white rounded-xl mb-4 overflow-hidden border border-slate-100 shadow-sm">
              <View className="px-4 py-3" style={{ backgroundColor: section.accentColor }}>
                <Text className="text-sm font-bold text-white uppercase tracking-wider">{section.tabLabel}</Text>
              </View>
              <View className="p-4">
                {section.isEmpty ? (
                  <Text className="text-sm text-slate-400 italic">No data entered</Text>
                ) : (
                  <View className="space-y-4">
                    {hasCombinations && section.combinationSections.map((group: any, groupIdx: number) => (
                      <View key={group.sectionId}>
                        {group.sectionLabel && (
                          <Text className="text-sm font-bold text-slate-700 mb-2">{group.sectionLabel}</Text>
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
                        {/* Web parity: a rule closes every combination group except the
                            last — e.g. the line above "Downspout & Accessories". */}
                        {groupIdx < section.combinationSections.length - 1 && (
                          <View
                            style={{
                              borderTopWidth: 1,
                              borderTopColor: DIVIDER_STRONG,
                              marginTop: 16,
                              marginBottom: 6,
                            }}
                          />
                        )}
                      </View>
                    ))}

                    {hasSimple && section.simpleSections.map((group: any) => (
                      <View
                        key={group.sectionId}
                        className="pt-2"
                        style={{ borderTopWidth: 1, borderTopColor: DIVIDER_HAIRLINE }}
                      >
                        {group.sectionLabel && (
                          <Text className="text-sm font-bold text-slate-700 mb-2">{group.sectionLabel}</Text>
                        )}
                        <View className="space-y-2">
                          {group.fields.map((field: any, idx: number) => (
                            <SummaryFieldRow key={idx} label={field.label} text={field.text} variant={field.variant} />
                          ))}
                        </View>
                      </View>
                    ))}

                    {hasTabFields && (
                      <View
                        className="pt-2 space-y-2"
                        style={{ borderTopWidth: 1, borderTopColor: DIVIDER_HAIRLINE }}
                      >
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
          onRefreshDocs={onRefreshDocs}
          repDetails={repDetails}
          editMode={editMode}
          productKey={productKey}
          verticalState={verticalState}
          jobState={rootJobState}
          calculatorResultData={calculatorResultData}
        />
      )}

      <View style={{ height: 24 }} />
    </Reanimated.ScrollView>
  );
}
