import React, { useState, useRef, useEffect } from 'react';
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
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import { getCalculationResult } from '../../../utils/calculator/calculator-calculation';
import { calculateMarkupLabel } from '../../../utils/activity-log/rollout-log-meta';

// Human-readable labels for each field — used in change logs
const labelMap: Record<string, string> = {
  reason: 'Reason',
  explain: 'Explain',
  lastPriceQuoted: 'Last Price Quoted',
  originalContractPrice: 'Original Contract Price',
  downPayment: 'Down Payment',
  downPaymentMethod: 'Payment Method (Down Payment)',
  balancePaymentMethod: 'Payment Method (Balance)',
  balance: 'Balance',
};

const paymentFields = ['downPaymentMethod', 'balancePaymentMethod'];
const specialLoggingFields = ['downPayment', 'balance'];

function getPaymentMethodLabel(value: string) {
  if (!value) return '';
  return paymentPlans[value]?.label || value;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

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
  const { user } = useAuth();

  // ── Analytics & Parity refs ────────────────────────────────────────────────
  const pendingLogChangesRef = useRef<any[]>([]);
  const [logChangeTrigger, setLogChangeTrigger] = useState<any>(null);
  const debouncedLogChange = useDebounce(logChangeTrigger, 1000);
  const prevFormDataRef = useRef<any>(null);
  const initialFieldsRef = useRef<Record<string, any>>({});
  const fetchedCalculatorRef = useRef<any>(null);

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
  const amendmentLoggedRef = useRef(false);

  const leadId = lead?._id || lead?.id || outcomeData?._id || outcomeData?.id;
  const result = isSale ? 'Sale' : 'Demo';

  const resolveCalculator = (fData: any) => {
    if (fetchedCalculatorRef.current) return fetchedCalculatorRef.current;
    const calcId = fData?.selectedCalculatorId || lead?.selectedCalculatorId || outcomeData?.selectedCalculatorId;
    const lfCalc = lead?.LFCalculator || outcomeData?.LFCalculator || lead?.jobBuilder?.LFCalculator || outcomeData?.jobBuilder?.LFCalculator || {};
    if (!calcId || !lfCalc) return null;
    if (Array.isArray(lfCalc)) return lfCalc.find((c: any) => c._id === calcId) || null;
    if (typeof lfCalc === 'object') {
      if (lfCalc._id === calcId) return lfCalc;
      return lfCalc[calcId] || null;
    }
    return null;
  };

  const buildRolloutMeta = (
    fData: any,
    fieldName: string,
    fieldLabel: string,
    fieldCategory: string,
    oldValue: any,
    newValue: any,
    action: string,
    extra: any = {}
  ) => {
    const calculator = resolveCalculator(fData);
    const calcId = fData?.selectedCalculatorId || lead?.selectedCalculatorId || outcomeData?.selectedCalculatorId || null;
    const endPrice = parseFloat(String(fData?.originalContractPrice || fData?.lastPriceQuoted || '0').replace(/,/g, '')) || 0;
    
    const costPrice = calculator
      ? Math.round(getCalculationResult(calculator, '50', 'check')) || 0
      : 0;
    const parPrice = calculator
      ? Math.round(getCalculationResult(calculator, '65', 'check')) || 0
      : 0;
    const retailPrice = calculator
      ? Math.round(getCalculationResult(calculator, '100', 'check')) || 0
      : 0;

    const percentageOfRollout = calculator
      ? calculateMarkupLabel(endPrice, costPrice, parPrice, retailPrice)
      : '';

    const reportFieldName = fieldName === 'downPaymentMethod' ? 'paymentMethod' : fieldName;

    return {
      calculatorId: calcId,
      appointmentId: calculator?.appointmentId || null,
      calculatorTitle: calculator?.name || calculator?.title || null,
      fieldName: reportFieldName,
      fieldLabel,
      fieldValue: newValue ?? oldValue,
      fieldCategory,
      oldValue: oldValue ?? '',
      newValue: newValue ?? '',
      action,
      costPrice,
      parPrice,
      retailPrice,
      percentageOfRollout,
      leadId,
      ...extra,
    };
  };

  const queueLog = (meta: any) => {
    const existing = pendingLogChangesRef.current.find((c) => c.fieldName === meta.fieldName);
    const merged = existing
      ? { ...meta, oldValue: existing.oldValue }
      : meta;
    pendingLogChangesRef.current = [
      ...pendingLogChangesRef.current.filter((c) => c.fieldName !== meta.fieldName),
      merged,
    ];
    setLogChangeTrigger({ fieldName: meta.fieldName, _ts: Date.now() });
  };

  const flushQueuedLogs = () => {
    const userId = user?._id || user?.id;
    if (!userId) return;
    const changes = pendingLogChangesRef.current;
    if (!changes.length) return;
    pendingLogChangesRef.current = [];
    changes.forEach((meta) => {
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: 'amendments',
        meta,
      });
    });
  };

  // Flush queued changes when debounce settles
  useEffect(() => {
    if (!debouncedLogChange || !user?._id) return;
    flushQueuedLogs();
  }, [debouncedLogChange, user?._id]);

  useEffect(() => {
    if (!amendmentOpen) {
      amendmentLoggedRef.current = false;
      return;
    }
    if (amendmentLoggedRef.current) return;

    const userId = user?._id || user?.id;
    const lId = lead?._id || lead?.id || outcomeData?._id || outcomeData?.id;
    if (!userId || !lId) return;

    amendmentLoggedRef.current = true;

    logEvent('add', {
      user_id: userId,
      created_by: userId,
      module_type: 'amendments',
      meta: {
        leadId: lId,
        action: 'opened_contract_amendment_modal',
      },
    });

    amendmentChanges.forEach((change) => {
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: 'amendments',
        meta: {
          leadId: lId,
          fieldName: change.key === 'downPaymentMethod' ? 'paymentMethod' : change.key,
          fieldLabel: change.label,
          oldValue: change.oldValue,
          newValue: change.newValue,
          action: 'amendment_field_changed',
        },
      });
    });
  }, [amendmentOpen, amendmentChanges, user, lead, outcomeData]);

  const handleFieldChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

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

      initialFieldsRef.current = {
        originalContractPrice: String(price),
        downPayment: String(dp),
        downPaymentMethod: dpMethod,
        balance: String(bal),
        balancePaymentMethod: balMethod,
        lastPriceQuoted: String(lastPrice),
        reason,
      };

      prevFormDataRef.current = null;
      pendingLogChangesRef.current = [];

      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('add', {
          user_id: userId,
          module_type: 'amendments',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id || outcomeData?._id || outcomeData?.id,
            action: 'opened_contract_details_edit_modal',
            result: isSale ? 'Sale' : 'Demo',
          },
        });
      }

      const calcId =
        outcomeData?.selectedCalculatorId ||
        outcomeData?.jobBuilder?.calculatorId ||
        lead?.selectedCalculatorId ||
        lead?.jobBuilder?.calculatorId;

      if (calcId) {
        LeadService.getCalculator(calcId)
          .then((res) => {
            fetchedCalculatorRef.current = res?.data?.data || res?.data || null;
          })
          .catch(() => {
            fetchedCalculatorRef.current = null;
          });
      } else {
        fetchedCalculatorRef.current = null;
      }

      setView('menu');
      setAmendmentOpen(false);
      setAmendmentChanges([]);
      setDraftId(null);
    } else {
      flushQueuedLogs();
    }
  }, [visible, outcomeData, lead, user?._id, user?.id]);

  // ── field-change detection → queue log ─────────────────────────────────────
  useEffect(() => {
    const userId = user?._id || user?.id;
    if (!visible || !userId || !leadId) return;

    if (!prevFormDataRef.current) {
      prevFormDataRef.current = formData;
      return;
    }

    let changedField = null;
    let oldVal = '';
    let newVal = '';

    for (const key of Object.keys(formData)) {
      if (key === 'LFCalculator' || key === 'lfCalculator') continue;
      const curVal = (formData as any)[key];
      const prevVal = (prevFormDataRef.current as any)[key];
      if (curVal !== prevVal) {
        changedField = key;
        oldVal = prevVal;
        newVal = curVal;
        break;
      }
    }

    prevFormDataRef.current = formData;

    if (!changedField || !labelMap[changedField] || specialLoggingFields.includes(changedField))
      return;

    const isPayment = paymentFields.includes(changedField);
    queueLog(
      buildRolloutMeta(
        formData,
        changedField,
        labelMap[changedField],
        isPayment ? 'payment' : 'contract',
        isPayment ? getPaymentMethodLabel(oldVal) || oldVal || '' : (oldVal ?? ''),
        isPayment ? getPaymentMethodLabel(newVal) || newVal || '' : (newVal ?? ''),
        'contract_details_field_changed'
      )
    );
  }, [formData, visible, user?._id, user?.id, leadId]);

  // ── Auto-compute balance & queue special logging fields ─────────────────────
  React.useEffect(() => {
    const price = normalise(formData.originalContractPrice) || 0;
    const dp = normalise(formData.downPayment) || 0;
    const newBalance = Math.max(0, price - dp);
    const currentBalance = normalise(formData.balance) || 0;
    
    if (newBalance !== currentBalance) {
      const oldDp = initialFieldsRef.current.downPayment;
      const newDp = formData.downPayment;
      const oldBal = initialFieldsRef.current.balance;
      const newBal = fmt(newBalance);

      setFormData((prev) => ({ ...prev, balance: newBal }));

      const userId = user?._id || user?.id;
      if (userId && visible) {
        if (String(oldDp) !== String(newDp)) {
          queueLog(
            buildRolloutMeta(
              { ...formData, balance: newBal },
              'downPayment',
              'Down Payment',
              'payment',
              oldDp,
              newDp,
              'contract_details_field_changed'
            )
          );
        }
        if (String(oldBal) !== String(newBal)) {
          queueLog(
            buildRolloutMeta(
              { ...formData, balance: newBal },
              'balance',
              'Balance',
              'payment',
              oldBal,
              newBal,
              'contract_details_field_changed',
              { fieldType: 'auto' }
            )
          );
        }
      }
    }
  }, [formData.originalContractPrice, formData.downPayment, user?._id, user?.id, visible]);


  // ── Save pricing ────────────────────────────────────────────────────────────
  const handleSavePricing = async () => {
    const leadId = lead?._id || lead?.id;
    if (!leadId) return;

    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('add', {
        user_id: userId,
        created_by: userId,
        module_type: 'amendments',
        meta: {
          leadId,
          action: `saved_contract_details_${result.toLowerCase()}`,
          result,
          initialFormData: initialFieldsRef.current,
          formData,
        },
      });
    }

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
        flushQueuedLogs();
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
      const userId = user?._id || user?.id;
      const leadId = pending.leadId;
      if (userId) {
        logEvent('add', {
          user_id: userId,
          created_by: userId,
          module_type: 'amendments',
          meta: {
            leadId,
            action: 'submitted_amendment_signature',
            changes: amendmentChanges.map((c) => ({
              field: c.label,
              old: c.oldValue,
              new: c.newValue,
            })),
          },
        });
      }

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
      flushQueuedLogs();
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

      // Log installDate and timeWindow edits
      const oldInstallDate = lead?.installDate || outcomeData?.installDate;
      const oldTimeWindow = lead?.timeWindow || outcomeData?.timeWindow;
      const userId = user?._id || user?.id;
      if (userId) {
        if (String(oldInstallDate || '') !== String(apiDate || '')) {
          logEvent('change', {
            user_id: userId,
            module_type: 'amendments',
            created_by: userId,
            meta: {
              leadId,
              fieldName: 'installDate',
              oldValue: oldInstallDate || '',
              newValue: apiDate || '',
              action: 'contract_field_changed',
            },
          });
        }
        if (String(oldTimeWindow || '') !== String(data.timeWindow || '')) {
          logEvent('change', {
            user_id: userId,
            module_type: 'amendments',
            created_by: userId,
            meta: {
              leadId,
              fieldName: 'timeWindow',
              oldValue: oldTimeWindow || '',
              newValue: data.timeWindow || '',
              action: 'contract_field_changed',
            },
          });
        }
      }

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
                      handleFieldChange(field, item.value);
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
                            handleFieldChange('balancePaymentMethod', key);
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
                                onChangeText={(t) => handleFieldChange('lastPriceQuoted', t)}
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
                                onChangeText={(t) => handleFieldChange('originalContractPrice', t)}
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
                                  onChangeText={(t) => handleFieldChange('downPayment', t)}
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
