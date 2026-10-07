import { useEffect, useRef, useCallback, useState } from 'react';
import { logEvent } from '../services/api/LoggerService';
import { getAutoFieldEntriesForSection } from '../utils/activity-log/auto-fields';
import { getPaymentPlanLabel } from '../utils/activity-log/rollout-log-meta';
import { resolveLeadCalculatorId } from '../services/api/leads';
import {
  fetchJobBuilderLoggedSections,
  markAutoFieldsLogged,
} from '../utils/activity-log/job-builder-auto-log';
import { useAuth } from './useAuth';
import { composeFundingAction, type FundingSource } from '../utils/activity-log/funding-log';

const RESULT_FIELDS = [
  'oneLeg',
  'result',
  'downPaymentMethod',
  'balancePaymentMethod',
  'originalContractPrice',
  'lastPriceQuoted',
  'reason',
  'reasonExplanation',
];

export function useOutcomeLogging(opts: {
  visible: boolean;
  outcomeForm?: any;
  outcomeStatus?: 'demo' | 'sale' | null;
  calculators?: any[];
  activeIdx?: number;
  setActiveIdx?: (idx: number) => void;
  lead?: any;
  disabled?: boolean;
  source?: FundingSource;
  moduleType?: string;
}) {
  const { user } = useAuth();
  const {
    visible,
    outcomeForm = {},
    outcomeStatus = null,
    calculators = [],
    activeIdx = 0,
    lead,
    disabled = false,
    source,
    moduleType = 'lead_result_field_entry',
  } = opts;
  const leadId = lead?._id || lead?.leadId || lead?.id;
  const stepViewedRef = useRef(false);
  const autoLoggedRef = useRef(false);
  const prevFormRef = useRef<any>(null);
  const prevActiveIdxRef = useRef<number>(activeIdx);
  const debounceRef = useRef<any>(null);
  const jobBuilderRef = useRef<any>(null);
  const loggedSectionsRef = useRef<Record<string, boolean>>({});
  const [sectionsReady, setSectionsReady] = useState(false);

  const stamp = useCallback(
    (meta: Record<string, any>, baseAction?: string) => {
      if (!source) return meta;
      const action = composeFundingAction(String(meta.action || baseAction || ''), source);
      return { ...meta, ...(action ? { action } : {}), fundingSource: source };
    },
    [source]
  );

  const buildResultData = useCallback(() => {
    const activeCalc = calculators && calculators.length > activeIdx ? calculators[activeIdx] : null;
    const leadData = lead?.leadData || lead?.jobBuilder?.leadData || {};
    return {
      ...leadData,
      ...outcomeForm,
      result: outcomeStatus || outcomeForm?.result || leadData?.result,
      paymentMethod: outcomeForm?.downPaymentMethod || outcomeForm?.paymentMethod || leadData?.paymentMethod,
      balancePaymentMethod: outcomeForm?.balancePaymentMethod || leadData?.balancePaymentMethod,
      downPayment: outcomeForm?.downPayment ?? leadData?.downPayment,
      balance: outcomeForm?.balance ?? leadData?.balance,
      originalContractPrice:
        outcomeForm?.originalContractPrice ?? leadData?.originalContractPrice ?? activeCalc?.price,
      selectedCalculatorTitle: activeCalc?.name || activeCalc?.title,
      LFCalculator: activeCalc,
    };
  }, [outcomeForm, outcomeStatus, calculators, activeIdx, lead]);

  const loggedSectionsCalcId = calculators[activeIdx]?._id || resolveLeadCalculatorId(lead);

  useEffect(() => {
    if (disabled) return;
    if (!visible || !leadId) {
      setSectionsReady(false);
      return;
    }
    fetchJobBuilderLoggedSections(leadId, loggedSectionsCalcId)
      .then(({ jobBuilder, loggedSections }) => {
        jobBuilderRef.current = jobBuilder;
        loggedSectionsRef.current = loggedSections;
        if (loggedSections.lead_result) {
          autoLoggedRef.current = true;
        }
        setSectionsReady(true);
      })
      .catch(() => {
        setSectionsReady(true);
      });
  }, [visible, leadId, disabled, loggedSectionsCalcId]);

  useEffect(() => {
    if (disabled) return;
    if (!visible) {
      stepViewedRef.current = false;
      autoLoggedRef.current = false;
      prevFormRef.current = null;
      prevActiveIdxRef.current = activeIdx;
      return;
    }

    const userId = user?._id || user?.id;
    if (!userId || !leadId) return;

    if (!stepViewedRef.current) {
      stepViewedRef.current = true;
    }
  }, [visible, user, leadId, activeIdx, disabled]);

  useEffect(() => {
    if (disabled) return;
    if (!visible || !sectionsReady) return;

    const userId = user?._id || user?.id;
    if (!userId || !leadId || autoLoggedRef.current || loggedSectionsRef.current.lead_result) return;

    const data = buildResultData();
    const entries = getAutoFieldEntriesForSection('lead_result', data);
    if (entries.length === 0 && !outcomeStatus) return;

    autoLoggedRef.current = true;

    const fireAutoLogs = async () => {
      for (const entry of entries) {
        let displayValue = entry.value;
        if (entry.key === 'paymentMethod' || entry.key === 'balancePaymentMethod') {
          displayValue = getPaymentPlanLabel(String(entry.value));
        }
        await logEvent('auto-populated', {
          user_id: userId,
          created_by: userId,
          module_type: moduleType,
          meta: stamp(
            {
              fieldName: entry.key,
              fieldLabel: entry.label,
              fieldValue: displayValue,
              fieldType: entry.fieldType || 'auto',
              section: 'lead_result',
              fieldCategory: 'lead_result',
              leadId,
              jobBuilderId: leadId,
            },
            'lead_result_field_auto_populated'
          ),
        });
      }
      loggedSectionsRef.current.lead_result = true;
      await markAutoFieldsLogged(leadId, jobBuilderRef.current, 'lead_result');
    };

    fireAutoLogs();
    prevFormRef.current = JSON.parse(JSON.stringify(outcomeForm || {}));
    prevActiveIdxRef.current = activeIdx;
  }, [visible, sectionsReady, user, leadId, buildResultData, outcomeForm, outcomeStatus, activeIdx, disabled, stamp, moduleType]);

  useEffect(() => {
    if (disabled) return;
    if (!visible) return;
    const userId = user?._id || user?.id;
    if (!userId || !leadId) return;

    if (prevActiveIdxRef.current !== activeIdx && stepViewedRef.current) {
      const prevCalc = calculators[prevActiveIdxRef.current];
      const newCalc = calculators[activeIdx];
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: moduleType,
        meta: stamp({
          leadId,
          fieldName: 'selectedCalculatorId',
          fieldLabel: 'Selected Calculator',
          oldValue: prevCalc?._id || '',
          newValue: newCalc?._id || '',
          calculatorTitle: newCalc?.name || newCalc?.title || null,
          fieldCategory: 'lead_result',
          section: 'lead_result',
          jobBuilderId: leadId,
          action: 'lead field changed',
        }),
      });
      prevActiveIdxRef.current = activeIdx;
    }
  }, [activeIdx, visible, user, leadId, calculators, disabled, stamp, moduleType]);

  useEffect(() => {
    if (disabled) return;
    if (!visible) return;
    const userId = user?._id || user?.id;
    if (!userId || !leadId || !prevFormRef.current) return;

    const prev = prevFormRef.current;
    const curr = outcomeForm || {};

    if (String(prev.downPayment ?? '') !== String(curr.downPayment ?? '')) {
      if (curr.downPayment) {
        logEvent('user_changed', {
          user_id: userId,
          created_by: userId,
          module_type: moduleType,
          meta: stamp(
            {
              fieldName: 'downPayment',
              fieldLabel: 'Down Payment',
              fieldValue: curr.downPayment,
              fieldType: 'user',
              section: 'lead_result',
              fieldCategory: 'lead_result',
              leadId,
              jobBuilderId: leadId,
            },
            'lead_result_field_entered'
          ),
        });
      }
      const balance = Number(curr.balance);
      if (!isNaN(balance) && balance >= 0) {
        logEvent('auto-populated', {
          user_id: userId,
          created_by: userId,
          module_type: moduleType,
          meta: stamp(
            {
              fieldName: 'balance',
              fieldLabel: 'Balance',
              fieldValue: balance.toLocaleString(),
              fieldType: 'auto',
              section: 'lead_result',
              fieldCategory: 'lead_result',
              leadId,
              jobBuilderId: leadId,
            },
            'lead_result_field_auto_populated'
          ),
        });
      }
    }

    const changes: Array<{ fieldName: string; fieldLabel: string; fieldValue: any }> = [];
    const labels: Record<string, string> = {
      oneLeg: 'One Leg',
      reason: 'Reason',
      reasonExplanation: 'Reason Explanation',
      originalContractPrice: 'Original Contract Price',
      lastPriceQuoted: 'Last Price Quoted',
      downPaymentMethod: 'Payment Method (Down Payment)',
      balancePaymentMethod: 'Payment Method (Balance)',
      versatile: 'Versatile',
      pineapple: 'Pineapple',
    };

    RESULT_FIELDS.forEach((key) => {
      if (String(prev[key] ?? '') !== String(curr[key] ?? '')) {
        changes.push({
          fieldName: key,
          fieldLabel: labels[key] || key,
          fieldValue: curr[key],
        });
      }
    });

    if (changes.length === 0) {
      prevFormRef.current = JSON.parse(JSON.stringify(curr));
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      changes.forEach((change) => {
        logEvent('change', {
          user_id: userId,
          created_by: userId,
          module_type: moduleType,
          meta: stamp({
            leadId,
            fieldName: change.fieldName,
            fieldLabel: change.fieldLabel,
            fieldValue: change.fieldValue,
            fieldCategory: 'lead_result',
            section: 'lead_result',
            jobBuilderId: leadId,
            action: 'lead field changed',
          }),
        });
      });
      prevFormRef.current = JSON.parse(JSON.stringify(curr));
    }, 1000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [outcomeForm, visible, user, leadId, disabled, stamp, moduleType]);

  const logReset = useCallback(() => {
    if (disabled) return;
    const userId = user?._id || user?.id;
    if (!userId || !leadId) return;
    logEvent('reset', {
      user_id: userId,
      created_by: userId,
      module_type: moduleType,
      meta: stamp({
        leadId,
        action: 'reset_lead_result_form',
      }),
    });
    autoLoggedRef.current = false;
    stepViewedRef.current = false;
  }, [user, leadId, disabled, stamp, moduleType]);

  return { logReset };
}

