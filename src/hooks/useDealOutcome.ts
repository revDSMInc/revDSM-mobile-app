import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { LeadService, resolveLeadCalculatorId } from '../services/api/leads';
import { getDefaultPaymentMethod } from '../utils/calculator/lowes-payment-util';
import { useAuth } from './useAuth';

export const useDealOutcome = (
  lead: any,
  activeCalculator: any,
  results: any,
  appointmentId: string | null,
  onRefresh?: () => void,
  onClose?: () => void
) => {
  const { user } = useAuth();
  const [outcomeStatus, setOutcomeStatus] = useState<'demo' | 'sale' | null>(null);
  const [outcomeForm, setOutcomeForm] = useState<any>({
    oneLeg: 'No',
    reason: '',
    reasonExplanation: '',
    downPayment: '',
    balance: '',
    originalContractPrice: '',
    lastPriceQuoted: '',
    downPaymentMethod: 'check',
    balancePaymentMethod: 'check',
    versatile: false,
    pineapple: false,
    installDate: null,
    toBeDetermined: false,
  });
  const [jobState, setJobState] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const leadId = lead?._id || lead?.leadId || lead?.id;

  const fetchOutcomeData = async (leadIdOverride?: string) => {
    const activeLeadId = leadIdOverride || leadId;
    if (!activeLeadId) return;
    try {
      setLoading(true);
      const calcId = activeCalculator?._id || resolveLeadCalculatorId(lead);
      if (!calcId) return;
      const res = await LeadService.getLeadOutcomeByCalculator(activeLeadId, calcId);
      const data = res.data?.data || res.data;
      if (data) {
        const outcome = data.outcome || data.leadData || data;
        const status = outcome.status || outcome.result;
        if (status) setOutcomeStatus(status);

        const builder = outcome.jobBuilder;
        if (builder) setJobState(builder);

        setOutcomeForm((prev: any) => ({ ...prev, ...outcome }));
      }
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutcomeData();
  }, [leadId]);

  useEffect(() => {
    if (outcomeStatus && activeCalculator) {
      const latestDrop =
        (activeCalculator.dropPrice || []).length > 0
          ? activeCalculator.dropPrice[activeCalculator.dropPrice.length - 1].dropedPrice
          : activeCalculator.price;
      let final = Number(latestDrop) || results.total || 0;
      setOutcomeForm((prev: any) => ({
        ...prev,
        lastPriceQuoted: outcomeStatus === 'demo' ? String(final) : prev.lastPriceQuoted,
        originalContractPrice:
          outcomeStatus === 'sale' ? String(final) : prev.originalContractPrice,
      }));
    }
  }, [outcomeStatus, activeCalculator?.price, results.total]);

  const handleStatusSelect = (status: 'demo' | 'sale') => {
    setOutcomeStatus(status);

    const drops = activeCalculator?.dropPrice || [];
    const targetDrop = drops.find((d: any) => d.status === 'accepted') || drops[drops.length - 1];

    const latestDrop = targetDrop?.dropedPrice || activeCalculator?.price;
    const final = Number(latestDrop) || results?.total || 0;
    const dp = targetDrop?.downPayment ? String(targetDrop.downPayment) : '';
    const balanceVal = status === 'sale' ? String(Math.max(0, final - (Number(dp) || 0))) : '';

    const isLowesLead = lead?.lowesLead === true;
    const planKey = getDefaultPaymentMethod(
      isLowesLead,
      activeCalculator?.inputs?.paymentPlan
    );
    const dpMethod =
      planKey === 'mcVisaDscvr'
        ? 'card'
        : planKey === 'lowes_cc'
          ? 'lowes_cc'
          : ['check', 'amex', 'lowes_ach'].includes(planKey)
            ? planKey
            : isLowesLead
              ? 'lowes_ach'
              : 'check';

    setOutcomeForm({
      ...outcomeForm,
      lastPriceQuoted: status === 'demo' ? String(final) : '',
      originalContractPrice: status === 'sale' ? String(final) : '',
      downPayment: status === 'sale' ? dp : '',
      balance: balanceVal,
      downPaymentMethod: dpMethod,
      balancePaymentMethod: planKey,
    });

    if (leadId) {
      LeadService.updateLeadTimelineProgress(leadId, {
        salesProcess: 'completed',
        leadResulted: 'active',
      }).catch((err) => {
        console.error('[useDealOutcome] Failed to update timeline progress on status select:', err);
      });
    }
  };

  const handleFinishOutcome = async (setShowJobBuilder: (v: boolean) => void) => {
    if (!leadId) {
      Alert.alert('Error', 'Lead ID not found. Please try again.');
      return;
    }

    if (outcomeStatus === 'demo') {
      if (!outcomeForm.reason) {
        Alert.alert('Required Field', 'Please select a reason for the demo.');
        return;
      }
      if (outcomeForm.reason === 'Other (Explain)' && !outcomeForm.reasonExplanation?.trim()) {
        Alert.alert('Required Field', 'Please explain the reason for the demo.');
        return;
      }
    }

    try {
      setLoadingMessage('Opening Job Builder...');
      setLoading(true);

      let lfCalculatorPayload = activeCalculator && Object.keys(activeCalculator).length > 0
        ? {
          ...activeCalculator,
          title: (activeCalculator?.title && String(activeCalculator.title).trim())
            ? activeCalculator.title
            : 'Job Builder Estimate',
          appointmentId: activeCalculator?.appointmentId || appointmentId,
          createdBy: user?._id || user?.id || activeCalculator?.createdBy,
        }
        : undefined;

      if (lfCalculatorPayload && lfCalculatorPayload._id) {
        try {
          const apptId = appointmentId || lfCalculatorPayload.appointmentId;
          if (apptId) {
            const calcRes = await LeadService.getCalculators(apptId);
            const calculatorsData = calcRes.data?.data || calcRes.data || [];
            const matched = calculatorsData.find((c: any) => c._id === lfCalculatorPayload._id);
            if (matched && matched.dropPrice) {
              lfCalculatorPayload.dropPrice = (lfCalculatorPayload.dropPrice || []).map((dp: any) => {
                const apiShape = {
                  ...(dp._id ? { _id: dp._id } : {}),
                  dropedPrice: Number(dp.dropedPrice ?? dp.price),
                  status: dp.status ?? (dp.secured ? 'accepted' : 'declined'),
                  paymentMethod: dp.paymentMethod,
                  downPayment: dp.downPayment ?? 0,
                  balance: dp.balance ?? 0,
                  addedPlans: dp.addedPlans || [],
                };
                if (!apiShape._id) {
                  const matchedDbDrop = matched.dropPrice.find(
                    (dbDp: any) =>
                      Number(dbDp.dropedPrice) === Number(apiShape.dropedPrice) &&
                      dbDp.status === apiShape.status
                  );
                  if (matchedDbDrop) {
                    apiShape._id = matchedDbDrop._id;
                  }
                }
                return apiShape;
              });
            }
          }
        } catch (err) {
          console.warn('Failed to resolve dropPrice _ids in handleFinishOutcome', err);
        }
      }

      const payload: any = {
        ...outcomeForm,
        LFCalculator: undefined,
        status: outcomeStatus,
        result: outcomeStatus,
        calculatorId: activeCalculator?._id,
        selectedCalculatorId: activeCalculator?._id,
        selectedAppointmentId: appointmentId,
        appointmentId: appointmentId,
        lastPriceQuoted: (outcomeStatus as any) === 'demo' ? outcomeForm.lastPriceQuoted : '',
        originalContractPrice:
          (outcomeStatus as any) === 'sale' ? outcomeForm.originalContractPrice : '',
        downPayment: (outcomeStatus as any) === 'sale' ? outcomeForm.downPayment : '',
        balance: (outcomeStatus as any) === 'sale' ? outcomeForm.balance : '',
      };

      if (lfCalculatorPayload) {
        payload.LFCalculator = lfCalculatorPayload;
      }

      const outcomeCalcId = activeCalculator?._id || resolveLeadCalculatorId(lead);
      if (outcomeCalcId) {
        await LeadService.updateLeadOutcomeByCalculator(leadId, outcomeCalcId, payload);
      }

      await LeadService.updateLeadTimelineProgress(leadId, {
        leadResulted: 'completed',
        jobBuild: 'active',
        salesProcess: 'completed',
      });

      onRefresh?.();

      if (outcomeStatus === 'sale' || outcomeStatus === 'demo') {
        setTimeout(() => {
          setLoading(false);
          setShowJobBuilder(true);
        }, 500);
      } else {
        setLoading(false);
        onClose?.();
      }
    } catch (e) {
      setLoading(false);
      console.error('[Outcome] Global initialization failed:', e);
      Alert.alert(
        'Initialization Error',
        'System could not initialize the Job Builder. Please check your connection.'
      );
    }
  };

  return {
    outcomeStatus,
    setOutcomeStatus,
    outcomeForm,
    setOutcomeForm,
    handleStatusSelect,
    handleFinishOutcome,
    refetchOutcome: fetchOutcomeData,
    loading,
    setLoading,
    loadingMessage,
    jobState,
    setJobState,
  };
};
