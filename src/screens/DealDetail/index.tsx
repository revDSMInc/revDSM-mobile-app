import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format, isValid } from 'date-fns';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LeadService } from '../../services/api/leads';
import { PdfPreviewModal } from '../../widgets/modals/PdfPreviewModal';
import { FlashMessage } from '../../config/message';

/**
 * Deal Detail — web parity with `DealDetailsView`
 * (`src/sections/deal/view/deal-details-view.js`) + `ContractDetails`. Reached
 * from the My Deals list. Shows the resulted-deal summary (contract price, down
 * payment, balance, install date), Agreement Documents, Order Sheets, and any
 * pending addendum drafts, with a "Msg Ops/IM" action and an **Edit** pencil that
 * launches the 4-step dynamic deal-edit wizard (`DynamicDealCenter` `mode:'edit'`).
 *
 * Self-contained (does NOT reuse the LeadCenter JobDocsSection / ContractDetailsCard,
 * per the requirement to leave the Lead Center tools untouched).
 */

interface DealDetailProps {
  navigation?: NativeStackNavigationProp<any>;
  route?: { params?: { lead?: any; leadId?: string } };
}

const NON_RESULTED_STATUSES = ['lfLead', 'selfGenerated', 'scheduled'];

function formatMoney(value: any): string {
  if (value === null || value === undefined || value === '') return '-';
  if (String(value).includes('$')) return String(value);
  const num = parseFloat(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  return isNaN(num)
    ? String(value)
    : `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fileSize(bytes: any): string {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function DealDetail({ navigation, route }: DealDetailProps) {
  const initialLead = route?.params?.lead || {};
  const leadId = route?.params?.leadId || initialLead?._id || initialLead?.id || initialLead?.leadId;

  const [lead, setLead] = useState<any>(initialLead);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openSections, setOpenSections] = useState({ agreements: true, orderSheets: true });
  const [pdf, setPdf] = useState<{ visible: boolean; uri: string; title: string }>({
    visible: false,
    uri: '',
    title: '',
  });
  // Addendum drill-in (web `handleDraftClick` → getDraftSummary → DraftComparison).
  const [selectedDraft, setSelectedDraft] = useState<any>(null);
  const [draftSummary, setDraftSummary] = useState<any>(null);
  const [draftSummaryLoading, setDraftSummaryLoading] = useState(false);

  const loadDeal = useCallback(async () => {
    if (!leadId) {
      setLoading(false);
      return;
    }
    try {
      const [dealRes, draftsRes] = await Promise.allSettled([
        LeadService.getSalesDealById(leadId),
        LeadService.getJobBuilderDrafts(leadId),
      ]);
      if (dealRes.status === 'fulfilled') {
        const body = dealRes.value?.data;
        const fetched = body?.data?.lead || body?.data || body?.lead || body;
        if (fetched && typeof fetched === 'object') setLead((prev: any) => ({ ...prev, ...fetched }));
      }
      if (draftsRes.status === 'fulfilled') {
        const body = draftsRes.value?.data;
        const list = body?.data?.drafts || body?.data || body?.drafts || [];
        setDrafts(Array.isArray(list) ? list : []);
      }
    } catch (err) {
      console.warn('[DealDetail] load failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadDeal();
  }, [loadDeal]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDeal();
  }, [loadDeal]);

  // ── derived ──────────────────────────────────────────────────────────────
  const status = String(lead?.result || lead?.status || '');
  const isSale = status.toLowerCase() === 'sale';
  const isDemo = status.toLowerCase() === 'demo';
  const isCancelled = status.toLowerCase() === 'cancelled';
  const isResulted = !NON_RESULTED_STATUSES.includes(status || lead?.status);
  const hasDetails = isSale || isDemo || isCancelled;
  // Web parity (`deal-details-view.js` isDynamicDeal): only dynamic deals open the
  // dynamic edit wizard; web sends legacy deals to JobBuilderEditModal, which has
  // no mobile equivalent (dynamic is the shipping path).
  const isDynamicDeal = Boolean(
    lead?.jobBuilder?.isDynamic || lead?.jobBuilder?.dynamicJobState || lead?.isDynamic
  );

  const customerName =
    `${lead?.customerDetails?.firstName || ''} ${lead?.customerDetails?.lastName || ''}`.trim() ||
    'Customer';

  const scheduleData = lead?.jobBuilder?.scheduleTime || lead?.jobBuilderData?.scheduleTime;
  const scheduleDate = scheduleData?.date || lead?.leadDate;
  const timeWindow = scheduleData?.timeWindow || '';
  const installDate = useMemo(() => {
    if (!scheduleDate || scheduleDate === 'TBD' || scheduleDate === 'Invalid date') return 'Not Scheduled';
    const d = new Date(scheduleDate);
    if (!isValid(d)) return 'Not Scheduled';
    const dateStr = format(d, 'EEEE, M/d/yy');
    return timeWindow ? `${dateStr} • ${timeWindow}` : dateStr;
  }, [scheduleDate, timeWindow]);

  const agreements: any[] = lead?.jobBuilderDocuments?.agreements || [];
  const orderSheets: any[] = lead?.jobBuilderDocuments?.orderSheets || [];
  const primaryDocs = isSale ? agreements : orderSheets;
  const primaryTitle = isSale ? 'Agreement Documents' : 'Order Sheets';

  const pendingDraft = useMemo(
    () => drafts.find((d) => String(d?.status || '').toLowerCase() === 'pending'),
    [drafts]
  );

  const pendingDraftsArr = drafts.filter((d) => String(d?.status || '').toLowerCase() === 'pending');
  const pendingCount = pendingDraftsArr.length;
  const bannerText = isCancelled
    ? 'JOB CANCELLED'
    : pendingDraft
    ? `PENDING ADDENDUM${pendingCount > 1 ? 'S' : ''} - AWAITING CUSTOMER SIGNATURE`
    : isSale
    ? 'SALE - LEAD RESULTED'
    : 'DEMO - LEAD RESULTED';
  const bannerSubtitle = pendingDraft
    ? `${pendingCount} addendum${pendingCount > 1 ? 's' : ''} awaiting customer approval`
    : '';
  const bannerBg = isCancelled ? '#B91C1C' : pendingDraft ? '#F59E0B' : '#22C55E';

  const openDoc = useCallback(async (doc: any) => {
    try {
      if (!doc?.filePath) return;
      const res = await LeadService.getSecureUrls([
        { bucketName: doc.bucketName, filePath: doc.filePath },
      ]);
      const arr = res?.data?.data || res?.data || [];
      const secureUrl = arr?.[0]?.secureUrl || arr?.[0]?.url;
      if (secureUrl) {
        setPdf({ visible: true, uri: secureUrl, title: doc?.name || 'Document' });
      } else {
        FlashMessage.error('Unavailable', 'Could not open this document');
      }
    } catch (err) {
      console.warn('[DealDetail] openDoc failed:', err);
      FlashMessage.error('Error', 'Could not open this document');
    }
  }, []);

  const onEdit = useCallback(() => {
    if (!leadId) return;
    // Web parity: ContractDetails pencil → isDynamicDeal ? DynamicDealEditModal :
    // JobBuilderEditModal. Mobile ships only the dynamic editor, so a legacy deal
    // can't be edited on device — tell the rep instead of dropping them on the
    // dynamic wizard's not-configured fallback.
    if (!isDynamicDeal) {
      FlashMessage.show(
        'Edit on web',
        'This deal uses the legacy job builder. Please edit it from the web app.',
        'info'
      );
      return;
    }
    // Launches the 4-step dynamic edit wizard (Install Date → Job Build → Job
    // Price → Review & Submit).
    navigation?.navigate('DynamicDealCenter', {
      lead,
      mode: 'edit',
      calculatorResultData: {
        calculatorId: lead?.selectedCalculatorId || lead?.jobBuilder?.calculatorId || null,
        appointmentId: lead?.selectedAppointmentId || lead?.jobBuilder?.appointmentId || null,
      },
    });
  }, [navigation, lead, leadId, isDynamicDeal]);

  const handleDraftClick = useCallback(async (draft: any) => {
    const id = draft?._id || draft?.id;
    setSelectedDraft(draft);
    setDraftSummary(null);
    if (!id) return;
    setDraftSummaryLoading(true);
    try {
      const res = await LeadService.getDraftSummary(id);
      const body = res?.data;
      setDraftSummary(body?.data || body || null);
    } catch (err) {
      console.warn('[DealDetail] draft summary failed:', err);
      setDraftSummary(null);
    } finally {
      setDraftSummaryLoading(false);
    }
  }, []);

  const closeDraft = useCallback(() => {
    setSelectedDraft(null);
    setDraftSummary(null);
  }, []);

  const onMsgOps = useCallback(() => {
    navigation?.navigate('ChatDetail', {
      leadId: lead?._id || leadId,
      chatId: lead?.chatId || '',
      customerName: `${lead?.office || ''} Lead - ${lead?.leadId || 'N/A'}`.trim() || 'Discussion',
    });
  }, [navigation, lead, leadId]);

  const toggle = (key: 'agreements' | 'orderSheets') =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── render ───────────────────────────────────────────────────────────────
  const Header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
      }}
    >
      <TouchableOpacity
        onPress={() => navigation?.goBack()}
        style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <Ionicons name="arrow-back" size={16} color="#637381" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A' }} numberOfLines={1}>
          {customerName}
        </Text>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 1 }}>
          {lead?.leadId ? `#${lead.leadId}` : 'Deal'}
        </Text>
      </View>
      {!isCancelled && (
        <TouchableOpacity
          onPress={onEdit}
          style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="pencil" size={18} color="#22C55E" />
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        {Header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#22C55E" />
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Loading deal…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isResulted || !hasDetails) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        {Header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Icon name="file-document-remove-outline" size={44} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            No contract details available
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {Header}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22C55E" />}
      >
        {/* Status banner */}
        <View style={{ backgroundColor: bannerBg, borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name={pendingDraft ? 'clock-outline' : isCancelled ? 'close-circle-outline' : 'check'} size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 0.3 }}>{bannerText}</Text>
          </View>
          {bannerSubtitle ? (
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 11, marginTop: 2, opacity: 0.9 }}>{bannerSubtitle}</Text>
          ) : null}
        </View>

        {/* Contract Details */}
        <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>Contract Details</Text>
            {isResulted && !isCancelled && (
              <TouchableOpacity onPress={onEdit}>
                <Icon name="pencil-outline" size={20} color="#22C55E" />
              </TouchableOpacity>
            )}
          </View>

          {isSale && (
            <>
              <Row label="Original Contract Price" value={formatMoney(lead?.originalContractPrice)} valueColor="#15803D" bold />
              <Row label="Down Payment" value={formatMoney(lead?.downPayment)} chip={lead?.paymentMethod} />
              <Row label="Remaining Balance" value={formatMoney(lead?.balance)} chip={lead?.balancePaymentMethod} />
              <Row label="Install Date" value={installDate} />
            </>
          )}
          {isDemo && (
            <>
              <Row label="Last Price Quoted" value={formatMoney(lead?.lastPriceQuoted)} valueColor="#15803D" bold />
              <Row label="Reason" value={lead?.reason || '-'} />
            </>
          )}
          {isCancelled && <Row label="Status" value="Cancelled" valueColor="#B91C1C" bold />}
        </View>

        {/* Primary documents (Agreements for Sale, Order Sheets for Demo) */}
        <DocSection
          title={primaryTitle}
          docs={primaryDocs}
          open={openSections.agreements}
          onToggle={() => toggle('agreements')}
          onOpenDoc={openDoc}
          icon="file-pdf-box"
          iconColor="#DC2626"
        />

        {/* Order Sheets (Sale only — Demo already shows order sheets as primary) */}
        {isSale && (
          <DocSection
            title="Order Sheets"
            docs={orderSheets}
            open={openSections.orderSheets}
            onToggle={() => toggle('orderSheets')}
            onOpenDoc={openDoc}
            icon="file-document-outline"
            iconColor="#0EA5E9"
          />
        )}

        {/* Addendums */}
        {drafts.length > 0 && (
          <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginBottom: 14 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#0F172A', marginBottom: 10 }}>
              Addendum{drafts.length > 1 ? 's' : ''} ({drafts.length})
            </Text>
            {drafts.map((d, idx) => {
              const st = String(d?.status || 'draft').toLowerCase();
              const stColor = st === 'pending' ? '#A16207' : st === 'declined' ? '#B91C1C' : st === 'signed' || st === 'accepted' ? '#15803D' : '#64748B';
              const stBg = st === 'pending' ? '#FEF9C3' : st === 'declined' ? '#FEE2E2' : st === 'signed' || st === 'accepted' ? '#DCFCE7' : '#F1F5F9';
              const created = d?.createdAt && isValid(new Date(d.createdAt)) ? format(new Date(d.createdAt), 'MM/dd/yyyy') : '';
              return (
                <TouchableOpacity
                  key={d?._id || idx}
                  onPress={() => handleDraftClick(d)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: '#F1F5F9' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <View style={{ backgroundColor: stBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: stColor, textTransform: 'capitalize' }}>{d?.status || 'Draft'}</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>Addendum #{idx + 1}</Text>
                    {created ? <Text style={{ fontSize: 11, color: '#94A3B8' }}>{created}</Text> : null}
                  </View>
                  <Icon name="chevron-right" size={20} color="#94A3B8" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Msg Ops/IM sticky */}
      <View style={{ padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0' }}>
        <TouchableOpacity
          onPress={onMsgOps}
          activeOpacity={0.85}
          style={{ backgroundColor: '#2169f3', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Icon name="chat-processing-outline" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Msg Ops/IM</Text>
        </TouchableOpacity>
      </View>

      {/* Addendum detail — web `DraftComparison` (pricing / schedule / build diff) */}
      <Modal visible={Boolean(selectedDraft)} transparent animationType="slide" onRequestClose={closeDraft}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '82%', paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>Addendum Details</Text>
                {selectedDraft?.status ? (
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#64748B', textTransform: 'capitalize' }}>· {selectedDraft.status}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={closeDraft} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
              {draftSummaryLoading ? (
                <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color="#22C55E" />
                </View>
              ) : draftSummary ? (
                <DraftComparison data={draftSummary} declinedAt={selectedDraft?.status === 'declined' ? selectedDraft?.updatedAt || selectedDraft?.declinedAt : null} />
              ) : (
                <Text style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, paddingVertical: 24 }}>Failed to load addendum details</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PdfPreviewModal
        visible={pdf.visible}
        uri={pdf.uri}
        title={pdf.title}
        onClose={() => setPdf({ visible: false, uri: '', title: '' })}
      />
    </SafeAreaView>
  );
}

// ── subcomponents ────────────────────────────────────────────────────────────
function Row({
  label,
  value,
  valueColor,
  bold,
  chip,
}: {
  label: string;
  value: string;
  valueColor?: string;
  bold?: boolean;
  chip?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, justifyContent: 'flex-end' }}>
        <Text style={{ fontSize: 14, fontWeight: bold ? '900' : '700', color: valueColor || '#1C252E' }} numberOfLines={1}>
          {value}
        </Text>
        {chip ? (
          <View style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#64748B', textTransform: 'uppercase' }}>{chip}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DocSection({
  title,
  docs,
  open,
  onToggle,
  onOpenDoc,
  icon,
  iconColor,
}: {
  title: string;
  docs: any[];
  open: boolean;
  onToggle: () => void;
  onOpenDoc: (doc: any) => void;
  icon: string;
  iconColor: string;
}) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginBottom: 14 }}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 14, fontWeight: '900', color: '#0F172A' }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {docs.length > 0 && (
            <View style={{ backgroundColor: '#0F172A', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>{docs.length} Files</Text>
            </View>
          )}
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#94A3B8" />
        </View>
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 12 }}>
          {docs.length === 0 ? (
            <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#94A3B8' }}>No {title.toLowerCase()} available</Text>
            </View>
          ) : (
            docs.map((doc, idx) => (
              <TouchableOpacity
                key={doc?._id || idx}
                onPress={() => onOpenDoc(doc)}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginBottom: idx === docs.length - 1 ? 0 : 8 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <Icon name={icon} size={24} color={iconColor} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }} numberOfLines={1}>
                      {doc?.name || 'Document'}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
                      {(doc?.fileData?.contentType?.split('/')[1] || 'PDF').toUpperCase()}
                      {doc?.fileData?.size ? ` • ${fileSize(doc.fileData.size)}` : ''}
                    </Text>
                  </View>
                </View>
                <Icon name="open-in-new" size={18} color="#94A3B8" />
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ── Addendum diff (web `DraftComparison`) ────────────────────────────────────
const PRICING_LABELS: Record<string, string> = {
  originalContractPrice: 'Contract Price',
  downPayment: 'Down Payment',
  paymentMethod: 'Payment Method',
  balance: 'Balance',
  balancePaymentMethod: 'Balance Method',
};
const MONEY_KEYS = new Set(['originalContractPrice', 'downPayment', 'balance']);

function DiffRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
      <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '600', flex: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 }}>
        <Text style={{ fontSize: 12, color: '#DC2626', textDecorationLine: 'line-through' }}>{from || '—'}</Text>
        <Text style={{ fontSize: 12, color: '#94A3B8' }}>→</Text>
        <Text style={{ fontSize: 12, color: '#15803D', fontWeight: '800' }}>{to || '—'}</Text>
      </View>
    </View>
  );
}

function DraftComparison({ data, declinedAt }: { data: any; declinedAt?: any }) {
  const current = data?.current;
  const proposed = data?.proposed;

  const pricingRows = Object.keys(PRICING_LABELS)
    .map((key) => ({ key, label: PRICING_LABELS[key], oldVal: current?.pricing?.[key], newVal: proposed?.pricing?.[key] }))
    .filter((r) => String(r.oldVal ?? '') !== String(r.newVal ?? ''));

  const cs = current?.jobBuilder?.scheduleTime;
  const ps = proposed?.jobBuilder?.scheduleTime;
  const dateChanged = Boolean(ps?.date && cs?.date !== ps.date);
  const timeChanged = Boolean(ps?.timeWindow && cs?.timeWindow !== ps.timeWindow);
  const scheduleChanged = Boolean(ps) && (dateChanged || timeChanged || !cs);

  const buildGroups = (Array.isArray(proposed?.buildChangeSummary) ? proposed.buildChangeSummary : []).filter(
    (g: any) => Array.isArray(g?.changes) && g.changes.length
  );

  const hasAny = pricingRows.length > 0 || scheduleChanged || buildGroups.length > 0;
  const fmt = (key: string, v: any) => (MONEY_KEYS.has(key) ? formatMoney(v) : String(v ?? '—') || '—');
  const declined = declinedAt && isValid(new Date(declinedAt)) ? format(new Date(declinedAt), 'MM/dd/yyyy') : null;

  return (
    <View style={{ gap: 16 }}>
      {declined ? (
        <View style={{ backgroundColor: '#FEE2E2', borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#B91C1C' }}>Declined by customer on {declined}</Text>
        </View>
      ) : null}

      {pricingRows.length > 0 && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#0F172A', marginBottom: 4 }}>Pricing Changes</Text>
          {pricingRows.map((r) => (
            <DiffRow key={r.key} label={r.label} from={fmt(r.key, r.oldVal)} to={fmt(r.key, r.newVal)} />
          ))}
        </View>
      )}

      {scheduleChanged && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#0F172A', marginBottom: 4 }}>Schedule Changes</Text>
          {dateChanged && <DiffRow label="Date" from={cs?.date || '—'} to={ps?.date || '—'} />}
          {timeChanged && <DiffRow label="Time" from={cs?.timeWindow || '—'} to={ps?.timeWindow || '—'} />}
        </View>
      )}

      {buildGroups.length > 0 && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#0F172A', marginBottom: 4 }}>Job Builder Changes</Text>
          {buildGroups.map((g: any, gi: number) => (
            <View key={`${g.vertical || g.section || 'grp'}-${gi}`} style={{ marginTop: gi === 0 ? 0 : 10 }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: '#475569', marginBottom: 2, textTransform: 'uppercase' }}>
                {g.vertical || g.section || 'Job Build'}
              </Text>
              {g.changes.map((ch: any, ci: number) => (
                <DiffRow key={`${ch.field}-${ci}`} label={ch.field} from={ch.from} to={ch.to} />
              ))}
            </View>
          ))}
        </View>
      )}

      {!hasAny && (
        <Text style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, paddingVertical: 16 }}>No changes detected</Text>
      )}
    </View>
  );
}
