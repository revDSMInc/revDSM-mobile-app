import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { DetailRow, DocumentItem } from './JobDocsUtils';

import type { ContractRefundSummary } from '../../../utils/contract-refund-summary';

interface ContractDetailsCardProps {
  lead: any;
  refundSummary?: ContractRefundSummary | null;
  outcomeData: any;
  leadDraft: any;
  isDark: boolean;
  colors: any;
  resolvedDocuments: { agreements: any[]; orderSheets: any[]; downPaymentReceipts: any[] };
  expandedDocs: { agreements: boolean; orderSheets: boolean; downPaymentReceipts: boolean };
  setExpandedDocs: React.Dispatch<React.SetStateAction<{ agreements: boolean; orderSheets: boolean; downPaymentReceipts: boolean }>>;
  setShowEditModal: (show: boolean) => void;
  onOpenPdf?: (url: string, title?: string) => void;
  onImagePreview: (uri: string) => void;
  getStatusLabel: () => string;
  hasContract: boolean;
  isResulted: boolean;
  onAddDocument: (type: 'agreement' | 'orderSheet' | 'downPaymentReceipt') => void;
}

const cleanNumber = (val: any): number => {
  if (val == null || val === '') return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isFinite(parsed) ? parsed : 0;
};

export const ContractDetailsCard = ({
  lead,
  refundSummary,
  outcomeData,
  leadDraft,
  isDark,
  colors,
  resolvedDocuments,
  expandedDocs,
  setExpandedDocs,
  setShowEditModal,
  onOpenPdf,
  onImagePreview,
  getStatusLabel,
  hasContract,
  isResulted,
  onAddDocument,
}: ContractDetailsCardProps) => {
  const navigation = useNavigation<any>();

  const showRefundBlock = !!refundSummary?.accepted && refundSummary.before !== null;

  if (!isResulted) return null;

  if (!hasContract) {
    return (
      <View
        className="bg-white rounded-2xl mb-6 shadow-sm border border-gray-100 items-center justify-center px-6 py-10"
        style={{ backgroundColor: isDark ? colors.card : '#FFFFFF' }}
      >
        <Icon name="file-remove-outline" size={48} color="#919EAB" />
        <Text className="text-[15px] font-semibold mt-3 text-center" style={{ color: '#637381' }}>
          No contract details available
        </Text>
      </View>
    );
  }

  const statusStr = (lead?.status || outcomeData?.status || outcomeData?.result || '').toLowerCase().replace(/[^a-z]/g, '');
  const isDemo = statusStr === 'demo' || statusStr === 'demonosale';

  const draftStatus = String(leadDraft?.status || '').toLowerCase();
  const showLeadDraftPending =
    draftStatus === 'pending' && (leadDraft?.showStatus === true || leadDraft?.showStatus === 'true');
  const showPendingDraft = showLeadDraftPending;

  return (
    <View
      className="bg-white rounded-2xl mb-6 shadow-sm border border-gray-100 overflow-hidden"
      style={{ backgroundColor: isDark ? colors.card : '#FFFFFF' }}
    >
      {showPendingDraft ? (
        <View className="bg-[#F4B400] py-2.5 items-center justify-center px-4">
          <Text className="text-[#1C252E] font-black text-xs tracking-widest uppercase text-center">
            SALE - PENDING CUSTOMER SIGNATURE
          </Text>
          <Text className="text-[#1C252E] font-semibold text-[10px] text-center mt-1">
            Awaiting Amendment Approval:{"\n"}• Contract Pricing
          </Text>
        </View>
      ) : (
        <View className="bg-[#4CBB17] py-2.5 flex-row items-center justify-center">
          <Icon name="check" size={16} color="white" />
          <Text className="text-white font-black text-xs ml-2 tracking-widest uppercase">
            {getStatusLabel().toUpperCase()} - LEAD RESULTED
          </Text>
        </View>
      )}

      <View className="p-5">
        <View className="flex-row justify-between items-center mb-6">
          <Text className="text-lg font-black text-[#1C252E]" style={{ color: colors.text }}>
            Contract Details
          </Text>
          <TouchableOpacity
            onPress={() => setShowEditModal(true)}
            className="p-1"
          >
            <Icon name="pencil" size={20} color="#637381" />
          </TouchableOpacity>
        </View>

        <View className="gap-4 mb-8">
          {(statusStr === 'demo' || statusStr === 'demonosale') ? (
            <>
              <DetailRow
                label="Last Price Quoted"
                value={`$${cleanNumber(outcomeData?.lastPriceQuoted || outcomeData?.leadData?.lastPriceQuoted).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                color="#4CBB17"
                isDark={isDark}
              />
              <DetailRow
                label="Reason"
                value={outcomeData?.reason || outcomeData?.leadData?.reason || outcomeData?.explain || outcomeData?.leadData?.explain || '-'}
                isDark={isDark}
              />
            </>
          ) : (
            <>
              {/* ⚠️ SUPPRESSED once the refund block below can tell the whole story.
                  The lead's `originalContractPrice` is REWRITTEN to the new figure when
                  the addendum is accepted, so on a refunded deal this row showed the
                  POST-refund price under a label reading "Original" — and sat directly
                  above the refund block's own original, giving two rows with the same
                  label and different values. That is the duplicate that was reported. */}
              {!showRefundBlock && (
                <DetailRow
                  label="Original Contract Price"
                  value={`$${cleanNumber(outcomeData?.originalContractPrice || outcomeData?.leadData?.originalContractPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  color="#4CBB17"
                  isDark={isDark}
                />
              )}
              {/* ── the refund ────────────────────────────────────────────────────
                  ⚠️ Shown only once the CUSTOMER has signed (`accepted`), not merely
                  when an approver has said yes. A request at `pendingApproval` or
                  `pendingCustomer` may still be declined or unsigned, so reducing the
                  contract value on the strength of one would misstate the job to
                  whoever reads this card next — the rep, or ops.

                  ⚠️ All three figures are reported INDEPENDENTLY: `before − after` is
                  NOT the refund, because the contract price can move for reasons that
                  have nothing to do with money going back. That is precisely why the
                  card spells them out instead of showing one and letting the reader
                  subtract.

                  The `before` row is omitted whenever no candidate can be trusted —
                  see `resolveBeforePrice`, which refuses anything not strictly above
                  the price now. */}
              {showRefundBlock && (
                <>
                  <DetailRow
                    label="Original Contract Value"
                    value={`$${refundSummary!.before!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    isDark={isDark}
                  />
                  <DetailRow
                    label="Refund Value"
                    value={`−$${refundSummary!.refunded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    color="#BE123C"
                    isDark={isDark}
                  />
                  {/* ⚠️ `after` IS the post-refund figure — the lead's price is rewritten
                      when the addendum is accepted — so it is printed AS IS. Subtracting
                      the refund from it takes the money off twice: the reported card read
                      $7,630 where $8,500 − $435 = $8,065. */}
                  <DetailRow
                    label="Contract After Refund"
                    value={`$${refundSummary!.after.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    color="#4CBB17"
                    isDark={isDark}
                  />
                </>
              )}
              <DetailRow
                label="Down Payment"
                value={(() => {
                  const v = outcomeData?.downPayment ?? outcomeData?.leadData?.downPayment;
                  return (v === null || v === undefined || v === '') ? '$0.00' : '$' + cleanNumber(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                })()}
                method={(() => {
                  const v = outcomeData?.downPayment ?? outcomeData?.leadData?.downPayment;
                  if (v === null || v === undefined || v === '' || cleanNumber(v) === 0) return undefined;
                  return outcomeData?.paymentMethod || outcomeData?.leadData?.paymentMethod;
                })()}
                isDark={isDark}
              />
              <DetailRow
                label="Remaining Balance"
                value={`$${cleanNumber(outcomeData?.balance || outcomeData?.leadData?.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                method={outcomeData?.balancePaymentMethod || outcomeData?.leadData?.balancePaymentMethod}
                isDark={isDark}
              />
              <DetailRow
                label="Install Date"
                value={(() => {
                  const schedule = outcomeData?.jobBuilder?.scheduleTime || outcomeData?.jobBuilderData?.scheduleTime || outcomeData?.jobState?.scheduleTime || outcomeData?.leadData?.scheduleTime;
                  const date = schedule?.date || outcomeData?.installDate || outcomeData?.leadData?.installDate || lead?.leadDate;
                  const timeWindow = schedule?.timeWindow || outcomeData?.timeWindow || outcomeData?.leadData?.timeWindow || 'N/A';

                  if (!date || date === 'Not Scheduled') return 'Not Scheduled';
                  if (date === 'TBD') return 'TBD';

                  let dateObj = new Date(date);

                  if (isNaN(dateObj.getTime()) && typeof date === 'string') {
                    const parts = date.split('/');
                    if (parts.length === 3) {
                      const m = parseInt(parts[0]) - 1;
                      const d = parseInt(parts[1]);
                      const y = parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
                      dateObj = new Date(y, m, d);
                    }
                  }

                  if (!isNaN(dateObj.getTime())) {
                    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    const weekday = weekdays[dateObj.getDay()];
                    const formatted = dateObj.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
                    return `${weekday}, ${formatted} • ${timeWindow}`;
                  }
                  return `${date} • ${timeWindow}`;
                })()}
                isDark={isDark}
              />
            </>
          )}
        </View>

        <View className="h-[1px] bg-gray-100 mb-6" />

        {/* Agreement Documents Section */}
        {!isDemo && (
          <View className="mb-6">
            <TouchableOpacity
              onPress={() => setExpandedDocs(prev => ({ ...prev, agreements: !prev.agreements }))}
              className="flex-row items-center justify-between mb-4"
            >
              <Text className="text-sm font-bold text-[#1C252E]" style={{ color: colors.text }}>Agreement Documents</Text>
              <View className="flex-row items-center gap-2">
                <View className="bg-[#1C252E] px-2 py-0.5 rounded-md">
                  <Text className="text-[10px] font-black text-white">{resolvedDocuments.agreements.length} Files</Text>
                </View>
                <Icon name={expandedDocs.agreements ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
              </View>
            </TouchableOpacity>

            {expandedDocs.agreements && (
              <View className="gap-3">
                {resolvedDocuments.agreements.map((doc, idx) => (
                  <DocumentItem
                    key={idx}
                    doc={doc}
                    isDark={isDark}
                    colors={colors}
                    onOpen={onOpenPdf}
                    onImagePreview={(uri: string) => onImagePreview(uri)}
                  />
                ))}
                <TouchableOpacity
                  onPress={() => onAddDocument('agreement')}
                  className="border-2 border-dashed border-gray-200 rounded-xl py-4 items-center justify-center flex-row gap-2"
                >
                  <Icon name="plus" size={20} color="#637381" />
                  <Text className="text-sm font-bold text-[#637381]">Add Document</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Order Sheets Section */}
        <View>
          <TouchableOpacity
            onPress={() => setExpandedDocs(prev => ({ ...prev, orderSheets: !prev.orderSheets }))}
            className="flex-row items-center justify-between mb-4"
          >
            <Text className="text-sm font-bold text-[#1C252E]" style={{ color: colors.text }}>Order Sheets</Text>
            <View className="flex-row items-center gap-2">
              <View className="bg-[#1C252E] px-2 py-0.5 rounded-md">
                <Text className="text-[10px] font-black text-white">{resolvedDocuments.orderSheets.length} Files</Text>
              </View>
              <Icon name={expandedDocs.orderSheets ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
            </View>
          </TouchableOpacity>

          {expandedDocs.orderSheets && (
            <View className="gap-3">
              {resolvedDocuments.orderSheets.map((doc, idx) => (
                <DocumentItem
                  key={idx}
                  doc={doc}
                  isDark={isDark}
                  colors={colors}
                  onOpen={onOpenPdf}
                  onImagePreview={(uri: string) => onImagePreview(uri)}
                />
              ))}
              <TouchableOpacity
                onPress={() => onAddDocument('orderSheet')}
                className="border-2 border-dashed border-gray-200 rounded-xl py-4 items-center justify-center flex-row gap-2"
              >
                <Icon name="plus" size={20} color="#637381" />
                <Text className="text-sm font-bold text-[#637381]">Add Document</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Down Payment Receipt(s) Section — Sale-only (web parity: contract-details.js) */}
        {!isDemo && (
          <View className="mt-6">
            <TouchableOpacity
              onPress={() => setExpandedDocs(prev => ({ ...prev, downPaymentReceipts: !prev.downPaymentReceipts }))}
              className="flex-row items-center justify-between mb-4"
            >
              <Text className="text-sm font-bold text-[#1C252E]" style={{ color: colors.text }}>Down Payment Receipt(s)</Text>
              <View className="flex-row items-center gap-2">
                <View className="bg-[#1C252E] px-2 py-0.5 rounded-md">
                  <Text className="text-[10px] font-black text-white">{resolvedDocuments.downPaymentReceipts.length} Files</Text>
                </View>
                <Icon name={expandedDocs.downPaymentReceipts ? "chevron-up" : "chevron-down"} size={20} color="#637381" />
              </View>
            </TouchableOpacity>

            {expandedDocs.downPaymentReceipts && (
              <View className="gap-3">
                {resolvedDocuments.downPaymentReceipts.map((doc, idx) => (
                  <DocumentItem
                    key={idx}
                    doc={doc}
                    isDark={isDark}
                    colors={colors}
                    onOpen={onOpenPdf}
                    onImagePreview={(uri: string) => onImagePreview(uri)}
                  />
                ))}
                <TouchableOpacity
                  onPress={() => onAddDocument('downPaymentReceipt')}
                  className="border-2 border-dashed border-gray-200 rounded-xl py-4 items-center justify-center flex-row gap-2"
                >
                  <Icon name="plus" size={20} color="#637381" />
                  <Text className="text-sm font-bold text-[#637381]">Add Document</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
};
