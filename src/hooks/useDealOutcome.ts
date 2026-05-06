import { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { LeadService } from '../services/api/leads';

export const useDealOutcome = (
  lead: any,
  activeCalculator: any,
  results: any,
  appointmentId: string | null,
  onRefresh?: () => void,
  onClose?: () => void
) => {
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
  });
  const [jobState, setJobState] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Extract a reliable lead ID
  const leadId = lead?._id || lead?.leadId || lead?.id;

  useEffect(() => {
    // Reset state when lead changes to prevent data leakage
    setOutcomeStatus(null);
    setOutcomeForm({
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
    });
    setJobState({});

    if (!leadId) return;

    const fetchOutcomeData = async () => {
      try {
        const res = await LeadService.getLeadOutcome(leadId);
        const data = res.data?.data || res.data;
        if (data) {
          if (data.status || data.result) setOutcomeStatus(data.status || data.result);
          if (data.jobBuilder || data.leadData?.jobBuilder)
            setJobState(data.jobBuilder || data.leadData.jobBuilder);
          if (data.leadData || data)
            setOutcomeForm((prev: any) => ({ ...prev, ...(data.leadData || data) }));
        }
      } catch (err) {}
    };
    fetchOutcomeData();
  }, [leadId]);

  useEffect(() => {
    if (outcomeStatus && activeCalculator) {
      let final = Number(activeCalculator.price) || results.total || 0;
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
    const final = Number(activeCalculator.price) || results.total || 0;
    const planKey = activeCalculator?.inputs?.paymentPlan || 'check';
    const dpMethod =
      planKey === 'mcVisaDscvr' ? 'card' : ['check', 'amex'].includes(planKey) ? planKey : 'check';

    setOutcomeForm({
      ...outcomeForm,
      lastPriceQuoted: status === 'demo' ? String(final) : '',
      originalContractPrice: status === 'sale' ? String(final) : '',
      downPayment: '',
      balance: status === 'sale' ? String(final) : '',
      downPaymentMethod: dpMethod,
      balancePaymentMethod: planKey,
    });
  };

  const handleFinishOutcome = async (setShowJobBuilder: (v: boolean) => void) => {
    if (!leadId) {
      Alert.alert('Error', 'Lead ID not found. Please try again.');
      return;
    }

    try {
      setLoadingMessage('Initializing Job Builder...');
      setLoading(true);

      // 1. Reset Job Builder on backend (requested fresh start)
      // We wrap this in a sub-try-catch to ensure that if the reset endpoint fails (common in staging),
      // we still proceed with the local initialization and subsequent outcome saving.
      try {
        await LeadService.resetLead(leadId);
      } catch (resetErr) {
        console.warn(
          '[Outcome] Backend reset failed, proceeding with local initialization:',
          resetErr
        );
      }

      // 2. Initialize fresh job state with default rows based on calculator data
      const inputs = activeCalculator?.inputs || {};

      const lfCombos: any[] = [];
      // Always include at least one LF combo
      lfCombos.push({
        id: Date.now(),
        lfColor: 'White',
        lfProfile: 'Versa',
        measurements: Array(18).fill('0'),
        gutterOpeningWidth: '5"',
        gutterProfile: 'K-Style',
      });

      // Add more if rollout has multi-tier data
      if (
        Number(inputs.versa6Ft2 || inputs.versa7Ft2 || inputs.filter45Ft2 || inputs.versaMaxFt2) > 0
      ) {
        lfCombos.push({
          id: Date.now() + 1,
          lfColor: 'White',
          lfProfile: 'Versa',
          measurements: Array(18).fill('0'),
          gutterOpeningWidth: '5"',
          gutterProfile: 'K-Style',
        });
      }
      if (
        Number(inputs.versa6Ft3 || inputs.versa7Ft3 || inputs.filter45Ft3 || inputs.versaMaxFt3) > 0
      ) {
        lfCombos.push({
          id: Date.now() + 2,
          lfColor: 'White',
          lfProfile: 'Versa',
          measurements: Array(18).fill('0'),
          gutterOpeningWidth: '5"',
          gutterProfile: 'K-Style',
        });
      }

      const initialJobState = {
        gutter: {
          gutterColorsMulti: [
            {
              id: Date.now() + 3,
              color: 'White',
              size: (() => {
                if (Number(inputs.gutter5Inch) > 0) return '5" K-Style';
                if (Number(inputs.gutter6Inch) > 0) return '6" K-Style';
                if (Number(inputs.gutter7Inch) > 0) return '7" K-Style';
                if (Number(inputs.gutter8Inch) > 0) return '8" K-Style';
                return '5" K-Style';
              })(),
              measurements: Array(18).fill('0'),
              mitersOutside: 0,
              mitersInside: 0,
              endCapsRights: 0,
              endCapsLefts: 0,
            },
          ],
          downspoutsMulti: [
            {
              id: Date.now() + 4,
              color: 'White',
              type: '2 X 3',
              footage: 0,
              aElbows: 0,
              bElbows: 0,
              roundElbow: 0,
              offsetElbows: 0,
              spoutSavers: 0,
            },
          ],
          extrasColors: { groundSpout: 'Black' },
        },
        leaffilter: {
          combinations: lfCombos,
          extras: {
            csr: 0,
            cornersFilter: 0,
            sawzallHanger: 0,
            removeProtection: 0,
            ribbedRoof: 0,
          },
        },
        soffit: { vinyl: { type: '' }, porch: { location: [] }, nailer: { type: '' } },
        fascia: { wrap: { type: '' }, boards: { boardType: '' }, aluminumBoards: { footage: '' } },
        additional: { extraLabor: activeCalculator?.inputs?.extraLabor || 0 },
        scheduleTime: null,
      };

      // Set the local state
      setJobState(initialJobState);

      // 3. Construct payload and update backend outcome
      const payload = {
        ...outcomeForm,
        status: outcomeStatus,
        result: outcomeStatus,
        calculatorId: activeCalculator?._id,
        jobBuilder: initialJobState,
        selectedCalculatorId: activeCalculator?._id,
        selectedAppointmentId: appointmentId,
        lastPriceQuoted: (outcomeStatus as any) === 'demo' ? outcomeForm.lastPriceQuoted : '',
        originalContractPrice:
          (outcomeStatus as any) === 'sale' ? outcomeForm.originalContractPrice : '',
        downPayment: (outcomeStatus as any) === 'sale' ? outcomeForm.downPayment : '',
        balance: (outcomeStatus as any) === 'sale' ? outcomeForm.balance : '',
      };

      // Update Lead Outcome
      await LeadService.updateLeadOutcome(leadId, payload);

      // Update Timeline
      await LeadService.updateLeadTimelineProgress(leadId, {
        leadResulted: 'completed',
        jobBuild: outcomeStatus === 'sale' ? 'active' : 'completed',
        salesProcess: 'completed',
      });

      onRefresh?.();

      if (outcomeStatus === 'sale') {
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
      // Only show Alert if the core outcome update fails
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
    loading,
    setLoading,
    loadingMessage,
    jobState,
    setJobState,
  };
};
