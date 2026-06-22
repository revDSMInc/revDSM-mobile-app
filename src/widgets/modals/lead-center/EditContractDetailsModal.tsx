import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { paymentPlans } from '../../../utils/calculator/payment-plans';
import { AppointmentSchedulerModal } from '../../modals/job-builder/AppointmentSchedulerModal';
import { demoReasons } from '../../components/dealcenter/ResultViews';
import { LeadService } from '../../../services/api/leads';
import { ContractAmendmentModal, AmendmentChange } from './ContractAmendmentModal';
import JobService from '../../../services/api/JobService';
import { parseSafeISO } from '../../../utils/date-util';


// ─── Types ────────────────────────────────────────────────────────────────────

interface EditContractDetailsModalProps {
  visible: boolean;
  onClose: () => void;
  outcomeData: any;
  onUpdate: (payload: any) => Promise<void>;
  lead: any;
  onSendSuccess?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const downPaymentMethods = [
  { label: 'Check (0% Fee)', value: 'check' },
  { label: 'MC/VISA/DSCVR (3.00% Fee)', value: 'card' },
  { label: 'AMEX (5.00% Fee)', value: 'amex' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: any): string {
  if (val == null || val === '') return '';
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? String(val) : n.toLocaleString();
}

function normalise(v: any): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : null;
}

function moneyChanged(a: any, b: any): boolean {
  const an = normalise(a);
  const bn = normalise(b);
  if (an == null && bn == null) return false;
  if (an == null || bn == null) return true;
  return an !== bn;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const EditContractDetailsModal: React.FC<EditContractDetailsModalProps> = ({
  visible,
  onClose,
  outcomeData,
  onUpdate,
  lead,
  onSendSuccess,
}) => {
  const { colors, isDark } = useTheme();

  // ── View state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<'menu' | 'pricing'>('menu');
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ── Lead meta ──────────────────────────────────────────────────────────────
  const rawStatus = (lead?.status || outcomeData?.status || outcomeData?.result || '').toLowerCase().replace(/[^a-z]/g, '');
  const isSale = rawStatus === 'sale';
  const isDemo = rawStatus === 'demo' || rawStatus === 'demonosale';

  // ── Form state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    originalContractPrice: '0',
    downPayment: '0',
    downPaymentMethod: 'check',
    balance: '0',
    balancePaymentMethod: 'check',
    lastPriceQuoted: '0',
    reason: '',
  });

  // ── Amendment state ────────────────────────────────────────────────────────
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentChanges, setAmendmentChanges] = useState<AmendmentChange[]>([]);
  const [amendmentSubmitting, setAmendmentSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const pendingSubmitRef = useRef<{
    leadId: string;
    editedLeadData: any;
    existingJobState: any;
  } | null>(null);

  // ── Sync form with fresh data whenever modal opens ─────────────────────────
  React.useEffect(() => {
    if (visible) {
      const price = outcomeData?.originalContractPrice || outcomeData?.leadData?.originalContractPrice || lead?.originalContractPrice || 0;
      const dp = outcomeData?.downPayment || outcomeData?.leadData?.downPayment || lead?.downPayment || 0;
      const dpMethod = outcomeData?.paymentMethod || outcomeData?.leadData?.paymentMethod || lead?.paymentMethod || 'check';
      const bal = outcomeData?.balance || outcomeData?.leadData?.balance || lead?.balance || 0;
      const balMethod = outcomeData?.balancePaymentMethod || outcomeData?.leadData?.balancePaymentMethod || lead?.balancePaymentMethod || 'check';
      const lastPrice = outcomeData?.lastPriceQuoted || outcomeData?.leadData?.lastPriceQuoted || lead?.lastPriceQuoted || price || 0;
      const reason = outcomeData?.reason || outcomeData?.leadData?.reason || lead?.reason || '';

      setFormData({
        originalContractPrice: String(price),
        downPayment: String(dp),
        downPaymentMethod: dpMethod,
        balance: String(bal),
        balancePaymentMethod: balMethod,
        lastPriceQuoted: String(lastPrice),
        reason,
      });
      setView('menu');
      setAmendmentOpen(false);
      setAmendmentChanges([]);
      setDraftId(null);


    }
  }, [visible, outcomeData, lead]);

  // ── Auto-compute balance ────────────────────────────────────────────────────
  React.useEffect(() => {
    const price = normalise(formData.originalContractPrice) || 0;
    const dp = normalise(formData.downPayment) || 0;
    const newBalance = Math.max(0, price - dp);
    const currentBalance = normalise(formData.balance) || 0;
    if (newBalance !== currentBalance) {
      setFormData((prev) => ({ ...prev, balance: fmt(newBalance) }));
    }
  }, [formData.originalContractPrice, formData.downPayment]);

  // ── Save pricing ────────────────────────────────────────────────────────────
  const handleSavePricing = async () => {
    const leadId = lead?._id || lead?.id;
    if (!leadId) return;
    setLoading(true);
    try {
      // 1. Fetch existing job state so we preserve all other fields
      let existingJobState: any = {};
      let existingLeadData: any = {};
      try {
        const current = await LeadService.getJobBuilder(leadId);
        const inner = current?.data?.data || current?.data || current || {};
        existingJobState = inner?.jobBuilder || inner?.jobState || {};
        existingLeadData = inner?.leadData || {};
      } catch {
        // non-fatal – proceed with empty base
      }

      // 2. Build final leadData
      const editedLeadData = {
        ...existingLeadData,
        result: lead?.result || lead?.status || outcomeData?.result || outcomeData?.status || '',
        reason: formData.reason || existingLeadData.reason || '',
        explain: existingLeadData.explain || '',
        lastPriceQuoted: isDemo
          ? formData.lastPriceQuoted
          : (existingLeadData.lastPriceQuoted || ''),
        originalContractPrice: isSale
          ? formData.originalContractPrice
          : (existingLeadData.originalContractPrice || ''),
        downPayment: formData.downPayment,
        paymentMethod: formData.downPaymentMethod,
        balancePaymentMethod: formData.balancePaymentMethod,
        balance: formData.balance,
        selectedCalculatorId:
          existingLeadData.selectedCalculatorId ?? lead?.selectedCalculatorId ?? null,
        selectedAppointmentId:
          existingLeadData.selectedAppointmentId ?? lead?.selectedAppointmentId ?? null,
      };

      // 3. Non-sale: save directly (no amendment required)
      if (!isSale) {
        await LeadService.submitJobBuilder(leadId, {
          leadData: editedLeadData,
          jobState: existingJobState,
        });
        await onUpdate(editedLeadData);
        onClose();
        return;
      }

      // 4. Sale: detect changes vs current lead data
      const oldLead = lead || {};
      const changes: AmendmentChange[] = [];
      const addChange = (key: string, label: string, oldVal: any, newVal: any) => {
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
          changes.push({ key, label, oldValue: oldVal ?? '', newValue: newVal ?? '' });
        }
      };

      addChange('originalContractPrice', 'Contract Price',
        oldLead.originalContractPrice || outcomeData?.originalContractPrice || '',
        editedLeadData.originalContractPrice);
      addChange('downPayment', 'Down Payment',
        oldLead.downPayment || outcomeData?.downPayment || '',
        editedLeadData.downPayment);
      addChange('paymentMethod', 'Down Payment Method',
        oldLead.paymentMethod || outcomeData?.paymentMethod || '',
        editedLeadData.paymentMethod);
      addChange('balance', 'Balance',
        oldLead.balance || outcomeData?.balance || '',
        editedLeadData.balance);
      addChange('balancePaymentMethod', 'Balance Method',
        oldLead.balancePaymentMethod || outcomeData?.balancePaymentMethod || '',
        editedLeadData.balancePaymentMethod);

      // 5. Create/update leadDraft so the customer can sign remotely if needed
      try {
        const draftRes = await LeadService.upsertLeadDraft(leadId, {
          originalContractPrice: editedLeadData.originalContractPrice,
          downPayment: editedLeadData.downPayment,
          downPaymentMethod: editedLeadData.paymentMethod,
          balance: editedLeadData.balance,
          balancePaymentMethod: editedLeadData.balancePaymentMethod,
        });
        const newDraftId =
          draftRes?.data?._id ||
          draftRes?.data?.data?._id ||
          draftRes?.data?.id ||
          null;
        setDraftId(newDraftId);
      } catch {
        // draft creation is non-fatal; proceed to amendment modal
      }

      // 6. Store pending data & open amendment modal
      pendingSubmitRef.current = { leadId, editedLeadData, existingJobState };
      setAmendmentChanges(changes);
      setAmendmentOpen(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save contract details.');
    } finally {
      setLoading(false);
    }
  };

  // ── Amendment submit (after signature) ────────────────────────────────────
  const handleAmendmentSubmit = async ({ signature }: { signature: string }) => {
    const pending = pendingSubmitRef.current;
    if (!pending?.leadId) return;
    setAmendmentSubmitting(true);
    try {
      await LeadService.submitJobBuilder(pending.leadId, {
        leadData: pending.editedLeadData,
        jobState: pending.existingJobState,
      });
      if (draftId) {
        try {
          await LeadService.updateLeadDraft(draftId, {
            status: 'accepted',
            customerSignature: signature || null,
          });
        } catch {
          // non-fatal
        }
      }
      await onUpdate(pending.editedLeadData);
      setAmendmentOpen(false);
      setAmendmentChanges([]);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to submit amendment.');
    } finally {
      setAmendmentSubmitting(false);
    }
  };

  // ── Schedule confirm ───────────────────────────────────────────────────────
  const handleScheduleConfirm = async (data: any) => {
    setLoading(true);
    const leadId = lead?._id || lead?.id;
    if (!leadId) return;

    try {
      let apiDate = data.date;
      if (data.date && data.date !== 'TBD') {
        const [m, d, y] = data.date.split('/');
        const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
        if (!isNaN(dateObj.getTime())) {
          apiDate = `${m}/${d}/${y}`;
        }
      }

      // Fetch existing job state to preserve other fields
      let existingJobState: any = {};
      let existingLeadData: any = {};
      try {
        const current = await LeadService.getJobBuilder(leadId);
        const inner = current?.data?.data || current?.data || current || {};
        existingJobState = inner?.jobBuilder || inner?.jobState || {};
        existingLeadData = inner?.leadData || {};
      } catch (err) {
        console.warn('Could not fetch existing job builder state:', err);
      }

      const editedLeadData = {
        ...existingLeadData,
        installDate: apiDate,
        timeWindow: data.timeWindow,
      };

      const editedJobState = {
        ...existingJobState,
        scheduleTime: {
          customerName: `${lead?.customerDetails?.firstName} ${lead?.customerDetails?.lastName}`,
          date: apiDate,
          timeWindow: data.timeWindow,
          reason: data.reason || '',
        },
      };

      // Non-sale or no change: save directly
      await LeadService.submitJobBuilder(leadId, {
        leadData: editedLeadData,
        jobState: editedJobState,
      });

      const outcomePayload = {
        installDate: apiDate,
        timeWindow: data.timeWindow,
        leadData: editedLeadData,
        jobBuilder: editedJobState,
        result: lead?.result || lead?.status || outcomeData?.result || '',
        status: lead?.status || lead?.result || outcomeData?.status || '',
      };
      await onUpdate(outcomePayload);

      // Sync with JobTracker if it exists
      try {
        const jobs = await JobService.getJobs();
        const apptId = lead?.appointmentId || outcomeData?.appointmentId || leadId;
        const calcId = lead?.calculatorId || outcomeData?.calculatorId || outcomeData?.selectedCalculatorId;
        const jobNum = lead?.jobNumber || outcomeData?.jobNumber || lead?.leadData?.jobNumber || outcomeData?.leadData?.jobNumber;

        const existingJob = jobs.find(
          (j) =>
            (apptId && j.appointmentId === apptId) ||
            (calcId && j.calculatorId === calcId) ||
            (jobNum && j.jobNumber === jobNum)
        );

        if (existingJob) {
          const isTBD = !apiDate || apiDate === 'TBD';
          let formattedInstallDate: string | null = null;
          if (!isTBD && apiDate) {
            const parsedDate = parseSafeISO(apiDate);
            if (parsedDate && !isNaN(parsedDate.getTime())) {
              formattedInstallDate = parsedDate.toISOString();
            }
          }
          await JobService.updateJob((existingJob._id || existingJob.id)!, {
            installDate: formattedInstallDate,
            toBeDetermined: isTBD,
          });
        }
      } catch (jobTrackerError) {
        console.warn('[EditContractDetailsModal] Job tracker sync failed:', jobTrackerError);
      }

      setSchedulerOpen(false);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save schedule.');
    } finally {
      setLoading(false);
    }
  };

  // ── Dropdown helpers ───────────────────────────────────────────────────────
  const handleToggleExpand = (field: string) => {
    const isExpanding = expanded !== field;
    setExpanded(isExpanding ? field : null);
    if (isExpanding) {
      setTimeout(() => {
        const positions: Record<string, number> = {
          downPaymentMethod: 150,
          balancePaymentMethod: 380,
        };
        if (positions[field] !== undefined) {
          scrollRef.current?.scrollTo({ y: positions[field], animated: true });
        }
      }, 150);
    }
  };

  const renderDropdown = (
    label: string,
    value: string,
    items: { label: string; value: string }[],
    field: string,
    zIndex: number
  ) => {
    const isExpanded = expanded === field;
    return (
      <View style={{ marginBottom: 16, zIndex }}>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            color: '#637381',
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          {label}
        </Text>
        <TouchableOpacity
          onPress={() => handleToggleExpand(field)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: isDark ? '#1C252E' : '#FFFFFF',
            borderWidth: 1,
            borderColor: isDark ? '#FFFFFF20' : '#919EAB33',
            borderRadius: 12,
            height: 48,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#FFF' : '#1C252E' }}>
            {value}
          </Text>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#637381" />
        </TouchableOpacity>
        {isExpanded && (
          <View
            style={{
              zIndex: 100,
              marginTop: 4,
              backgroundColor: isDark ? '#1C252E' : '#FFFFFF',
              borderWidth: 1,
              borderColor: isDark ? '#FFFFFF30' : '#1C252E',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
              {items.map((item) => {
                const isSelected = (formData as any)[field] === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    onPress={() => {
                      setFormData({ ...formData, [field]: item.value });
                      setExpanded(null);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: isDark ? '#FFFFFF10' : '#F4F6F8',
                      backgroundColor: isSelected
                        ? isDark
                          ? '#FFFFFF10'
                          : '#F4F6F8'
                        : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '600',
                        color: isSelected
                          ? isDark
                            ? '#FFFFFF'
                            : '#1C252E'
                          : '#637381',
                      }}
                    >
                      {item.label}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={16} color={isDark ? '#FFF' : '#1C252E'} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  const renderBalanceDropdown = (zIndex: number) => {
    const isExpanded = expanded === 'balancePaymentMethod';
    const currentValue =
      paymentPlans[formData.balancePaymentMethod]?.label ||
      downPaymentMethods.find((m) => m.value === formData.balancePaymentMethod)?.label ||
      'Select';

    const categories = [
      { title: 'Standard Methods', keys: ['check', 'mcVisaDscvr', 'amex'] as string[] },
      {
        title: 'GreenSky Plans',
        keys: Object.keys(paymentPlans).filter((k) => k.startsWith('greensky')),
      },
      {
        title: 'Wells Fargo Plans',
        keys: Object.keys(paymentPlans).filter((k) => k.startsWith('wf')),
      },
      {
        title: 'Other Plans',
        keys: Object.keys(paymentPlans).filter(
          (k) => !k.startsWith('greensky') && !k.startsWith('wf') && !['check', 'mcVisaDscvr', 'amex'].includes(k)
        ),
      },
    ];

    return (
      <View style={{ marginBottom: 16, zIndex }}>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            color: '#637381',
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          Payment Method (Balance)
        </Text>
        <TouchableOpacity
          onPress={() => handleToggleExpand('balancePaymentMethod')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: isDark ? '#1C252E' : '#FFFFFF',
            borderWidth: 1,
            borderColor: isDark ? '#FFFFFF20' : '#919EAB33',
            borderRadius: 12,
            height: 48,
            paddingHorizontal: 14,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '600',
              flex: 1,
              color: isDark ? '#FFF' : '#1C252E',
            }}
            numberOfLines={1}
          >
            {currentValue}
          </Text>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#637381" />
        </TouchableOpacity>
        {isExpanded && (
          <View
            style={{
              zIndex: 100,
              marginTop: 4,
              backgroundColor: isDark ? '#1C252E' : '#FFFFFF',
              borderWidth: 1,
              borderColor: isDark ? '#FFFFFF30' : '#1C252E',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
              {categories.map((cat, catIdx) => {
                if (cat.keys.length === 0) return null;
                return (
                  <View key={catIdx}>
                    <View
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        backgroundColor: catIdx % 2 === 0 ? '#d9ead3' : '#f4cccc',
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#000', textTransform: 'uppercase' }}>
                        {cat.title}
                      </Text>
                    </View>
                    {cat.keys.map((key) => {
                      const plan = paymentPlans[key];
                      if (!plan) return null;
                      const isSelected = formData.balancePaymentMethod === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => {
                            setFormData({ ...formData, balancePaymentMethod: key });
                            setExpanded(null);
                          }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingHorizontal: 16,
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: isDark ? '#FFFFFF10' : '#F4F6F8',
                            backgroundColor: isSelected
                              ? isDark
                                ? '#FFFFFF10'
                                : '#F4F6F8'
                              : 'transparent',
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: '600',
                                color: isSelected ? (isDark ? '#FFF' : '#1C252E') : '#637381',
                              }}
                            >
                              {plan.label}
                            </Text>
                            {plan.displayMonths && (
                              <Text style={{ fontSize: 10, color: '#919EAB' }}>
                                {plan.displayMonths}
                              </Text>
                            )}
                          </View>
                          {isSelected && (
                            <Ionicons name="checkmark" size={16} color={isDark ? '#FFF' : '#1C252E'} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Modal visible={visible && !schedulerOpen && !amendmentOpen} transparent animationType="slide" onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.60)', justifyContent: 'center', paddingHorizontal: 16 }}>
            <View
              style={{
                backgroundColor: isDark ? colors.card : '#FFFFFF',
                borderRadius: 20,
                overflow: 'hidden',
                maxHeight: '85%',
              }}
            >
                <>
                  {/* ─── Menu View ──────────────────────────────────────────── */}
                  {view === 'menu' && (
                    <View style={{ padding: 32 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                        <View>
                          <Text style={{ fontSize: 20, fontWeight: '900', color: isDark ? '#FFF' : '#1C252E' }}>
                            Edit Contract Details
                          </Text>
                          <Text style={{ fontSize: 14, color: '#637381', fontWeight: '500', marginTop: 2 }}>
                            Select what to edit
                          </Text>
                        </View>
                        <TouchableOpacity onPress={onClose}>
                          <Icon name="close" size={24} color="#637381" />
                        </TouchableOpacity>
                      </View>

                      {/* Contract Pricing row */}
                      <TouchableOpacity
                        onPress={() => setView('pricing')}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 20,
                          borderBottomWidth: 1,
                          borderBottomColor: isDark ? '#FFFFFF10' : '#F4F6F8',
                        }}
                      >
                        <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#FFF' : '#1C252E' }}>
                          Contract Pricing
                        </Text>
                        <Icon name="chevron-right" size={24} color="#637381" />
                      </TouchableOpacity>

                      {/* Schedule Date row — only for Sale */}
                      {isSale && (
                        <TouchableOpacity
                          onPress={() => setSchedulerOpen(true)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingVertical: 20,
                          }}
                        >
                          <View>
                            <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#FFF' : '#1C252E' }}>
                              Schedule Date
                            </Text>
                            <Text style={{ fontSize: 12, color: '#637381', marginTop: 2 }}>
                              {(() => {
                                const schedule =
                                  outcomeData?.jobBuilder?.scheduleTime ||
                                  outcomeData?.jobState?.scheduleTime ||
                                  outcomeData?.leadData?.scheduleTime;
                                const date =
                                  schedule?.date ||
                                  outcomeData?.installDate ||
                                  outcomeData?.leadData?.installDate;
                                const time =
                                  schedule?.timeWindow ||
                                  outcomeData?.timeWindow ||
                                  outcomeData?.leadData?.timeWindow;
                                if (!date) return 'Not Scheduled';
                                if (date === 'TBD') return 'TBD';
                                const dateObj = new Date(date);
                                if (!isNaN(dateObj.getTime())) {
                                  const formatted = dateObj.toLocaleDateString('en-US', {
                                    month: 'numeric',
                                    day: 'numeric',
                                    year: 'numeric',
                                  });
                                  return `${formatted}${time ? ` • ${time}` : ''}`;
                                }
                                return `${date}${time ? ` • ${time}` : ''}`;
                              })()}
                            </Text>
                          </View>
                          <Icon name="chevron-right" size={24} color="#637381" />
                        </TouchableOpacity>
                      )}

                      {/* Close button */}
                      <TouchableOpacity
                        onPress={onClose}
                        style={{
                          marginTop: 24,
                          height: 56,
                          backgroundColor: '#4CBB17',
                          borderRadius: 16,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* ─── Pricing View ────────────────────────────────────────── */}
                  {view === 'pricing' && (
                    <ScrollView
                      ref={scrollRef}
                      contentContainerStyle={{ padding: 32, paddingBottom: 40 }}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {/* Header */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 20, fontWeight: '900', color: isDark ? '#FFF' : '#1C252E' }}>
                          Edit Contract Pricing
                        </Text>
                        <TouchableOpacity onPress={() => setView('menu')}>
                          <Icon name="close" size={24} color="#637381" />
                        </TouchableOpacity>
                      </View>
                      <Text style={{ fontSize: 14, color: '#637381', fontWeight: '500', marginBottom: 28 }}>
                        All financial terms
                      </Text>

                      {/* ── Demo fields ─────────────────────────────────────── */}
                      {isDemo && (
                        <>
                          {/* Last Price Quoted */}
                          <View style={{ marginBottom: 20 }}>
                            <Text style={{ fontSize: 11, fontWeight: '900', color: '#637381', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                              Last Price Quoted
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#FFFFFF10' : '#E5E7EB', paddingHorizontal: 16, height: 56 }}>
                              <Text style={{ color: '#637381', marginRight: 8, fontSize: 18 }}>$</Text>
                              <TextInput
                                value={formData.lastPriceQuoted}
                                onChangeText={(t) => setFormData({ ...formData, lastPriceQuoted: t })}
                                keyboardType="numeric"
                                style={{ flex: 1, fontWeight: '700', fontSize: 16, color: isDark ? '#FFF' : '#1C252E' }}
                              />
                            </View>
                          </View>

                          {/* Reason */}
                          <View style={{ marginBottom: 20, zIndex: 100 }}>
                            {renderDropdown('Reason', formData.reason || 'Select Reason', demoReasons.map((r) => ({ label: r, value: r })), 'reason', 100)}
                          </View>
                        </>
                      )}

                      {/* ── Sale fields ──────────────────────────────────────── */}
                      {!isDemo && (
                        <>
                          {/* Original Contract Price */}
                          <View style={{ marginBottom: 20 }}>
                            <Text style={{ fontSize: 11, fontWeight: '900', color: '#637381', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                              Original Contract Price
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#FFFFFF10' : '#E5E7EB', paddingHorizontal: 16, height: 56 }}>
                              <Text style={{ color: '#637381', marginRight: 8, fontSize: 18 }}>$</Text>
                              <TextInput
                                value={formData.originalContractPrice}
                                onChangeText={(t) => setFormData({ ...formData, originalContractPrice: t })}
                                keyboardType="numeric"
                                style={{ flex: 1, fontWeight: '700', fontSize: 16, color: isDark ? '#FFF' : '#1C252E' }}
                              />
                            </View>
                          </View>

                          {/* Down Payment group */}
                          <View style={{ borderWidth: 1, borderColor: isDark ? '#FFFFFF15' : '#919EAB33', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                            <View style={{ marginBottom: 16 }}>
                              <Text style={{ fontSize: 11, fontWeight: '900', color: '#637381', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Down Payment
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#FFFFFF05' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: isDark ? '#FFFFFF10' : '#919EAB33', paddingHorizontal: 12, height: 48 }}>
                                <Text style={{ color: '#637381', marginRight: 8 }}>$</Text>
                                <TextInput
                                  value={formData.downPayment}
                                  onChangeText={(t) => setFormData({ ...formData, downPayment: t })}
                                  keyboardType="numeric"
                                  style={{ flex: 1, fontWeight: '700', fontSize: 14, color: isDark ? '#FFF' : '#1C252E' }}
                                />
                              </View>
                            </View>
                            {renderDropdown(
                              'Payment Method',
                              downPaymentMethods.find((m) => m.value === formData.downPaymentMethod)?.label || 'Select',
                              downPaymentMethods,
                              'downPaymentMethod',
                              90
                            )}
                          </View>

                          {/* Balance group */}
                          <View style={{ borderWidth: 1, borderColor: isDark ? '#FFFFFF15' : '#919EAB33', borderRadius: 16, padding: 16, marginBottom: 20 }}>
                            <View style={{ marginBottom: 16 }}>
                              <Text style={{ fontSize: 11, fontWeight: '900', color: '#637381', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Balance (auto-calculated)
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#FFFFFF05' : '#F4F6F8', borderRadius: 12, borderWidth: 1, borderColor: isDark ? '#FFFFFF10' : '#919EAB33', paddingHorizontal: 12, height: 48 }}>
                                <Text style={{ color: '#637381', marginRight: 8 }}>$</Text>
                                <TextInput
                                  value={formData.balance}
                                  editable={false}
                                  style={{ flex: 1, fontWeight: '700', fontSize: 14, color: '#637381' }}
                                />
                              </View>
                            </View>
                            {renderBalanceDropdown(80)}
                          </View>
                        </>
                      )}

                      {/* Buttons */}
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                        <TouchableOpacity
                          onPress={() => setView('menu')}
                          style={{
                            flex: 1,
                            height: 56,
                            borderRadius: 16,
                            borderWidth: 1,
                            borderColor: isDark ? '#FFFFFF20' : '#E2E8F0',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ fontWeight: '900', fontSize: 14, color: '#637381' }}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleSavePricing}
                          disabled={loading}
                          style={{
                            flex: 1.5,
                            height: 56,
                            backgroundColor: '#4CBB17',
                            borderRadius: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: loading ? 0.6 : 1,
                            shadowColor: '#4CBB17',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.3,
                            shadowRadius: 8,
                            elevation: 6,
                          }}
                        >
                          {loading ? (
                            <ActivityIndicator color="white" />
                          ) : (
                            <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>
                              Save Changes
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </ScrollView>
                  )}
                </>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Appointment Scheduler */}
      <AppointmentSchedulerModal
        visible={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onConfirm={handleScheduleConfirm}
        customerName={`${lead?.customerDetails?.firstName} ${lead?.customerDetails?.lastName}`}
        isEdit={true}
        initialDate={
          outcomeData?.jobBuilder?.scheduleTime?.date ||
          outcomeData?.jobState?.scheduleTime?.date ||
          outcomeData?.installDate
        }
        initialTimeWindow={
          outcomeData?.jobBuilder?.scheduleTime?.timeWindow ||
          outcomeData?.jobState?.scheduleTime?.timeWindow ||
          outcomeData?.timeWindow
        }
      />

      {/* Contract Amendment Modal — only shown for Sale leads */}
      <ContractAmendmentModal
        visible={amendmentOpen}
        onClose={() => {
          if (amendmentSubmitting) return;
          setAmendmentOpen(false);
          setAmendmentChanges([]);
        }}
        onSendSuccess={() => {
          // Customer will sign remotely — close both modals
          setAmendmentOpen(false);
          setAmendmentChanges([]);
          onClose();
          onSendSuccess?.();
        }}
        changes={amendmentChanges}
        onSubmitAmendment={handleAmendmentSubmit}
        submitting={amendmentSubmitting}
        leadId={lead?._id || lead?.id || ''}
        defaultPhone={lead?.customerDetails?.phone || ''}
        defaultEmail={lead?.customerDetails?.email || ''}
        customerFirstName={lead?.customerDetails?.firstName || ''}
        customerLastName={lead?.customerDetails?.lastName || ''}
        draftId={draftId}
      />
    </>
  );
};
