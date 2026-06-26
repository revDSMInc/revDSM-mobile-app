import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { calculateQuote } from '../utils/calculator/calculation-utils';
import { calculateResultUtil } from '../utils/calculator/calculation-results-util';
import { getUpdatedCalculatorTitles } from '../utils/calculator/tab-naming.utils';
import { pricing, extrasList, extrasList50 } from '../utils/calculator/pricing-data';
import { paymentPlans } from '../utils/calculator/payment-plans';
import { getDefaultPaymentMethod } from '../utils/calculator/lowes-payment-util';
import { LeadService } from '../services/api/leads';
import { Alert, DeviceEventEmitter } from 'react-native';
import { useAuth } from './useAuth';
import { autoConfirmManager } from '../utils/calculator/autoConfirmManager';
import { logEvent } from '../services/api/LoggerService';
import {
  logCalculatorCreated,
  logCalculatorRename,
  logPaymentMethodInherited,
} from '../utils/activity-log/calculator-log';
import { sanitizeCalculatorLogTitle } from '../utils/activity-log/job-builder-auto-log';

const INITIAL_INPUTS = {
  gutter5DsE: '',
  gutter6Ft1: '',
  gutter7DsE: '',
  miters: '',
  endCaps: '',
  spoutSavers: '',
  versaMaxFt1: '',
  versaMaxFt2: '',
  versaMaxFt3: '',
  versa6Ft1: '',
  versa7Ft1: '',
  filter45Ft1: '',
  versa6Ft2: '',
  versa7Ft2: '',
  filter45Ft2: '',
  versa6Ft3: '',
  versa7Ft3: '',
  filter45Ft3: '',
  ckToInstallers: '',
  extraLabor: '',
  markup: '100',
  paymentPlan: 'check',
  price: 0,
  isLocked: false,
  discountPercentage: 15,
  isDefaultDiscount: true,
};

const INITIAL_EXTRAS = extrasList.reduce((acc: any, curr) => ({ ...acc, [curr.id]: '' }), {});

export const useDealCalculator = (lead: any) => {
  const { user } = useAuth();
  const isLowesLead = lead?.lowesLead === true;
  const [calculators, setCalculators] = useState<any[]>([
    {
      _id: null,
      name: '.',
      inputs: INITIAL_INPUTS,
      extras: INITIAL_EXTRAS,
      discounts: { seniorVet: false, preOrder: false },
      price: 0,
    },
  ]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const isPendingSave = useRef(false);

  const active = calculators[activeIdx] || calculators[0];
  const { inputs, extras, discounts } = active;

  // --- Web Parity Telemetry Refs & Helpers ---
  const pendingChangesRef = useRef<Array<{
    fieldName: string;
    fieldLabel: string;
    fieldCategory: string;
    oldValue: any;
    newValue: any;
    action: string;
  }>>([]);
  const fieldLogTimerRef = useRef<any>(null);
  const lastSavedTitlesRef = useRef<Record<string, string>>({});
  const hasLoggedCalculatorViewRef = useRef(false);

  const leadId = lead?._id || lead?.id;

  useEffect(() => {
    hasLoggedCalculatorViewRef.current = false;
  }, [leadId]);

  const getInputLabelAndCategory = (name: string): { label: string; category: string } => {
    switch (name) {
      case 'gutter5DsE': return { label: '5" Gutter/DS/E', category: 'gutter_filter' };
      case 'gutter6Ft1': return { label: '6" Gutter/DS/Elbows', category: 'gutter_filter' };
      case 'gutter7DsE': return { label: '7" Gutter/DS/Elbows', category: 'gutter_filter' };
      case 'miters': return { label: 'Miters', category: 'gutter_filter' };
      case 'endCaps': return { label: 'End Caps', category: 'gutter_filter' };
      case 'spoutSavers': return { label: 'Spout Savers', category: 'gutter_filter' };
      case 'versaMaxFt1': return { label: 'Versa Max', category: 'gutter_filter' };
      case 'versaMaxFt2': return { label: 'Versa Max 2nd Story', category: 'gutter_filter' };
      case 'versaMaxFt3': return { label: 'Versa Max 3rd Story', category: 'gutter_filter' };
      case 'versa6Ft1': return { label: '6" Versa (1st Story)', category: 'gutter_filter' };
      case 'versa7Ft1': return { label: '7" Versa (1st Story)', category: 'gutter_filter' };
      case 'filter45Ft1': return { label: '4" & 5" Versa (1st Story)', category: 'gutter_filter' };
      case 'versa6Ft2': return { label: '6" Versa (2nd Story)', category: 'gutter_filter' };
      case 'versa7Ft2': return { label: '7" Versa (2nd Story)', category: 'gutter_filter' };
      case 'filter45Ft2': return { label: '4" & 5" Versa (2nd Story)', category: 'gutter_filter' };
      case 'versa6Ft3': return { label: '6" Versa (3rd Story)', category: 'gutter_filter' };
      case 'versa7Ft3': return { label: '7" Versa (3rd Story)', category: 'gutter_filter' };
      case 'filter45Ft3': return { label: '4" & 5" Versa (3rd Story)', category: 'gutter_filter' };
      case 'ckToInstallers': return { label: 'Check to Installers', category: 'gutter_filter' };
      case 'extraLabor': return { label: 'Extra Labor Hours', category: 'gutter_filter' };
      case 'paymentPlan': return { label: 'Payment Plan', category: 'gutter_filter' };
      case 'markup': return { label: 'Markup', category: 'gutter_filter' };
      case 'discountPercentage': return { label: 'Discount Percentage', category: 'gutter_filter' };
      default: return { label: name, category: 'gutter_filter' };
    }
  };

  const getExtraLabelAndCategory = (name: string): { label: string; category: string } => {
    const matched = extrasList.find((e: any) => e.id === name || e.apiKey === name);
    if (matched) {
      return { label: matched.label, category: 'extras' };
    }
    return { label: name, category: 'extras' };
  };

  const getDiscountLabelAndCategory = (name: string): { label: string; category: string } => {
    if (name === 'seniorVet') return { label: 'Senior/Vet Discount', category: 'discounts' };
    if (name === 'preOrder') return { label: 'Pre-Order Discount', category: 'discounts' };
    return { label: name, category: 'discounts' };
  };

  const flushQueuedFieldChanges = (calc: any) => {
    const userId = user?._id || user?.id;
    if (!userId || !calc) return;
    const changes = pendingChangesRef.current;
    pendingChangesRef.current = [];

    changes.forEach((change) => {
      if (String(change.oldValue) === String(change.newValue)) return;
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: 'calculator_field_entry',
        meta: {
          calculatorId: calc._id,
          appointmentId: calc.appointmentId || appointmentId,
          calculatorTitle: calc.name || calc.title,
          fieldLabel: change.fieldLabel,
          fieldValue: change.newValue,
          fieldCategory: change.fieldCategory,
          oldValue: change.oldValue ?? '',
          newValue: change.newValue ?? '',
          action: change.action,
        },
      });
    });
  };

  // Mirror web lf-calculator-view: log calculator viewed once on initial render, not per tab switch.
  useEffect(() => {
    if (active?._id && user?._id && !hasLoggedCalculatorViewRef.current) {
      hasLoggedCalculatorViewRef.current = true;
      logEvent('view', {
        user_id: user._id,
        created_by: user._id,
        module_type: 'calculator',
        meta: {
          calculatorId: active._id,
          appointmentId: active.appointmentId || appointmentId,
          calculatorTitle: sanitizeCalculatorLogTitle(active.name || active.title || ''),
          action: 'calculator viewed',
        },
      });
    }
  }, [active?._id, user?._id, appointmentId]);

  // Clean up and flush pending change logs on active calculator switch or unmount
  useEffect(() => {
    return () => {
      if (fieldLogTimerRef.current) {
        clearTimeout(fieldLogTimerRef.current);
      }
      if (pendingChangesRef.current.length > 0 && active) {
        flushQueuedFieldChanges(active);
      }
    };
  }, [active?._id]);


  const results = useMemo(() => {
    const n = (v: any) => Number(v) || 0;
    const price50 = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: '50',
      hideScreens: true,
      isLowesLead,
    });
    const finalTotal = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: inputs.markup || '100',
      hideScreens: true,
      isLowesLead,
    });
    const price65 = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: '65',
      hideScreens: true,
      isLowesLead,
    });
    const price100 = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: '100',
      hideScreens: true,
      isLowesLead,
    });

    const items: any[] = [];
    if (n(inputs.gutter5DsE))
      items.push({ label: '5" Gutter/DS/E', value: inputs.gutter5DsE, category: 'Gutters' });
    if (n(inputs.gutter6Ft1))
      items.push({ label: '6" Gutter/DS/Elbows', value: inputs.gutter6Ft1, category: 'Gutters' });
    if (n(inputs.gutter7DsE))
      items.push({ label: '7" Gutter/DS/Elbows', value: inputs.gutter7DsE, category: 'Gutters' });

    const filters = [
      { label: 'Versa Max', val: inputs.versaMaxFt1 },
      { label: '6" Versa (1st)', val: inputs.versa6Ft1 },
      { label: '7" Versa (1st)', val: inputs.versa7Ft1 },
      { label: '7" & 5" Versa (1st)', val: inputs.filter45Ft1 },
      { label: '6" Versa (2nd)', val: inputs.versa6Ft2 },
      { label: '7" Versa (2nd)', val: inputs.versa7Ft2 },
      { label: '7" & 5" Versa (2nd)', val: inputs.filter45Ft2 },
      { label: '6" Versa (3rd)', val: inputs.versa6Ft3 },
      { label: '7" Versa (3rd)', val: inputs.versa7Ft3 },
      { label: '7" & 5" Versa (3rd)', val: inputs.filter45Ft3 },
    ];
    filters.forEach((f) => {
      if (n(f.val)) items.push({ label: f.label, value: f.val, category: 'LeafFilter' });
    });

    extrasList.forEach((e: any) => {
      const val = n(extras[e.id]);
      if (val > 0)
        items.push({
          label: e.label,
          value: val,
          category: e.category || 'Additional Services',
          unit: e.unit,
        });
    });

    if (n(inputs.extraLabor)) {
      items.push({
        label: 'Extra Labor',
        value: inputs.extraLabor,
        category: 'Additional Services',
      });
    }


    return { price50, price65, price100, total: finalTotal, items };
  }, [active]);

  const latestActiveRef = useRef<any>(null);
  const isAutoSavingRef = useRef(false);
  const saveCalculatorRef = useRef<(data: any) => Promise<void>>(async () => {});

  const fetchCalculators = async (leadOverride?: any) => {
    const activeLead = leadOverride || lead;
    if (!activeLead?._id) return;
    try {
      setLoading(true);
      const dateStr =
        activeLead.leadDate || activeLead.appointmentDate || activeLead.date || new Date().toISOString();
      const finalLeadDate = activeLead.leadDate
        ? activeLead.leadDate
        : dateStr.split('T')[0] + 'T00:00:00+05:00';
      console.log('finalLeadDate', finalLeadDate, activeLead.leadDate);

      let res = await LeadService.getAppointments({ lead_date: finalLeadDate });
      let appointments = res.data?.data || res.data || [];
      const targetTitle =
        activeLead.title ||
        `${activeLead.customerDetails?.firstName || ''} ${activeLead.customerDetails?.lastName || ''}`.trim() ||
        'test user';

      const findMyAppt = (list: any[]) =>
        list.find(
          (a: any) =>
            a.selfGenLeadId === activeLead._id ||
            a.leadId === activeLead._id ||
            a._id === activeLead.appointmentId ||
            a.id === activeLead.appointmentId ||
            a.title?.trim().toLowerCase() === targetTitle.trim().toLowerCase()
        );
      let myAppt = findMyAppt(appointments);

      if (!myAppt) {
        try {
          await LeadService.createAppointment({
            title: targetTitle,
            address: activeLead.customerDetails?.address || 'N/A',
            leadId: activeLead.leadId || 'N/A',
            selfGenLeadId: activeLead._id,
          });
          res = await LeadService.getAppointments({ lead_date: finalLeadDate });
          appointments = res.data?.data || res.data || [];
          myAppt = findMyAppt(appointments);
        } catch (err: any) { }
      }

      if (!myAppt) return;

      const apptId = myAppt._id;
      setAppointmentId(apptId);

      const calcRes = await LeadService.getCalculators(apptId);
      let calculatorsData = calcRes.data?.data || calcRes.data || [];

      if (calculatorsData.length === 0) {
        const defaultPay = user?.defaultPaymentMethod || (isLowesLead ? 'lowes_ach' : 'check');
        const fullPayload = {
          title: 'Calculator',
          position: 1,
          ...INITIAL_INPUTS,
          paymentPlan: defaultPay,
          paymentMethod: defaultPay,
          pricemarkup: '100',
          ...Object.keys(INITIAL_EXTRAS).reduce((acc, k) => ({ ...acc, [k]: 0 }), {}),
          price: 0,
        };
        const createRes = await LeadService.createCalculator(apptId, fullPayload);
        const reCalcRes = await LeadService.getCalculators(apptId);
        calculatorsData = reCalcRes.data?.data || reCalcRes.data || [];

        const userId = user?._id || user?.id;
        if (userId) {
          const createdData = (createRes as any)?.data?.data || (createRes as any)?.data;
          const createdId = createdData?._id;
          await logCalculatorCreated({
            userId,
            calculatorId: createdId,
            appointmentId: createdData?.appointmentId || apptId,
            calculatorTitle: createdData?.title || 'Calculator',
            isFirstCalculator: true,
            calculatorPosition: 1,
          });
          if (defaultPay) {
            await logPaymentMethodInherited({
              userId,
              calculatorId: createdId,
              appointmentId: apptId,
              calculatorTitle: createdData?.title || 'Calculator',
              paymentMethod: defaultPay,
              inheritanceSource: 'default payment method',
              toCalculator: createdId,
            });
          }
        }
      }

      if (calculatorsData.length > 0) {
        const mappedCalculators = calculatorsData.map((c: any, idx: number) => ({
          _id: c._id,
          name: c.title || `${idx + 1}`,
          position: c.position !== undefined ? c.position : idx,
          inputs: {
            ...INITIAL_INPUTS,
            gutter5DsE: String(c.gutter5DsE || c.gutter_footage || ''),
            gutter6Ft1: String(c.gutter6Ft1 || c.gutter_6_footage || ''),
            gutter7DsE: String(c.gutter7DsE || c.gutter_7_footage || ''),
            miters: String(c.miters || ''),
            endCaps: String(c.end_caps || ''),
            spoutSavers: String(c.spout_savers || ''),
            versaMaxFt1: String(c.versaMaxFt1 || c.versa_max_footage || ''),
            versa6Ft1: String(c.versa6Ft1 || c.versa_6_footage || ''),
            versa7Ft1: String(c.versa7Ft1 || c.versa_7_footage || ''),
            filter45Ft1: String(c.filter45Ft1 || c.filter_45_footage || ''),
            versa6Ft2: String(c.versa6Ft2 || c.versa_6_footage_2 || ''),
            versa7Ft2: String(c.versa7Ft2 || c.versa_7_footage_2 || ''),
            filter45Ft2: String(c.filter45Ft2 || c.filter_45_footage_2 || ''),
            versa6Ft3: String(c.versa6Ft3 || c.versa_6_footage_3 || ''),
            versa7Ft3: String(c.versa7Ft3 || c.versa_7_footage_3 || ''),
            filter45Ft3: String(c.filter45Ft3 || c.filter_45_footage_3 || ''),
            ckToInstallers: String(c.ckToInstallers || c.check_to_installers || ''),
            extraLabor: String(c.extraLabor || c.extra_labor_hours || ''),
            paymentPlan: getDefaultPaymentMethod(isLowesLead, c.paymentMethod),
            markup: String(c.pricemarkup || '100'),
            discountPercentage: Number(c.discountPercentage || 15),
            isDefaultDiscount: !!c.isDefaultDiscount,
          },
          extras: extrasList.reduce(
            (acc, e: any) => ({
              ...acc,
              [e.apiKey || e.id]: String(c[e.apiKey || e.id] || ''),
            }),
            {}
          ),
          discounts: {
            seniorVet: c.discounts?.seniorVet || false,
            preOrder: c.discounts?.preOrder || false,
          },
          isRolloutConfirmed: !!c.isRolloutConfirmed,
          isDefaultPayment: !!c.isDefaultPayment,
          price: c.price || 0,
          dropPrice: c.dropPrice || [],
          downPayment: c.downPayment || 0,
          appointmentId: c.appointmentId || apptId,
        }));

        // Apply dynamic naming/warnings on load
        const getRetailPrice = (calc: any) => {
          const res = calculateQuote(calc.inputs, calc.extras, '3', '100', 'check', {
            seniorVet: false,
            preOrder: false,
          });
          return res.baseRetailTotal;
        };
        const titles = getUpdatedCalculatorTitles(mappedCalculators, getRetailPrice);
        mappedCalculators.forEach((c: { _id: string | number; name: any }) => {
          if (c._id && titles[c._id]) c.name = titles[c._id];
        });

        mappedCalculators.sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
        mappedCalculators.forEach((c: any) => {
          if (c._id && !lastSavedTitlesRef.current[c._id]) {
            lastSavedTitlesRef.current[c._id] = c.name;
          }
        });
        setCalculators(mappedCalculators);
        return mappedCalculators;
      }
      return [];
    } catch (e) {
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (lead?._id) {
      fetchCalculators();
    }
  }, [lead?._id]);

  useEffect(() => {
    const userId = user?._id || user?.id;
    calculators.forEach((calc) => {
      autoConfirmManager.registerPendingConfirm(calc, userId);
    });
  }, [calculators, user]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('calculatorAutoConfirmed', () => {
      fetchCalculators();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const cleanup = autoConfirmManager.startAutoConfirmScheduler();
    return () => cleanup();
  }, []);

  useEffect(() => {
    const activeCalc = calculators[activeIdx];
    if (!activeCalc) return;
    const extras = activeCalc.extras || {};
    const hasStoryFt = ['lighting1stStory', 'lighting2ndStory', 'lighting3rdStory'].some(
      (f) => Number(extras[f]) > 0
    );
    const normalizeControlBox = (v: any) => {
      const s = String(v ?? '').trim();
      return s === '0' ? '' : s;
    };
    const expectedControlBox = hasStoryFt ? '1' : '';
    const currentControlBox = normalizeControlBox(extras.lightingControlBox);

    if (currentControlBox !== expectedControlBox) {
      setCalculators((prev) => {
        const next = [...prev];
        if (!next[activeIdx]) return prev;
        const current = { ...next[activeIdx] };
        current.extras = { ...current.extras, lightingControlBox: expectedControlBox };
        next[activeIdx] = current;
        return next;
      });

      // Only log when auto-adding control box (story footage entered) — not on open/normalize
      const userId = user?._id || user?.id;
      if (userId && activeCalc._id && hasStoryFt && expectedControlBox === '1') {
        logEvent('change', {
          user_id: userId,
          created_by: userId,
          module_type: 'calculator_field_entry',
          meta: {
            calculatorId: activeCalc._id,
            appointmentId: activeCalc.appointmentId || appointmentId,
            calculatorTitle: activeCalc.name,
            fieldLabel: 'Control Box',
            fieldCategory: 'extras',
            oldValue: currentControlBox,
            newValue: expectedControlBox,
            action: 'calculator field changed',
            autoSet: true,
          },
        });
      }
    }
  }, [
    activeIdx,
    calculators.length,
    calculators[activeIdx]?.extras?.lighting1stStory,
    calculators[activeIdx]?.extras?.lighting2ndStory,
    calculators[activeIdx]?.extras?.lighting3rdStory,
  ]);

  const updateActive = useCallback(
    (patch: any, bypassAutoSave: boolean = false) => {
      setCalculators((prev) => {
        const next = [...prev];
        if (!next[activeIdx]) return prev;
        const current = { ...next[activeIdx] };

        // Queue field changes for web parity logging
        const userId = user?._id || user?.id;
        if (userId) {
          if (patch.inputs) {
            Object.entries(patch.inputs).forEach(([k, v]) => {
              const oldValue = current.inputs[k] ?? '';
              const newValue = v ?? '';
              if (String(oldValue) !== String(newValue)) {
                const info = getInputLabelAndCategory(k);
                const existing = pendingChangesRef.current.find(c => c.fieldName === k);
                const originalOldValue = existing ? existing.oldValue : oldValue;

                pendingChangesRef.current = [
                  ...pendingChangesRef.current.filter(c => c.fieldName !== k),
                  {
                    fieldName: k,
                    fieldLabel: info.label,
                    fieldCategory: info.category,
                    oldValue: originalOldValue,
                    newValue,
                    action: 'calculator field changed',
                  }
                ];
              }
            });
          }

          if (patch.extras) {
            Object.entries(patch.extras).forEach(([k, v]) => {
              const oldValue = current.extras[k] ?? '';
              const newValue = v ?? '';
              if (String(oldValue) !== String(newValue)) {
                const info = getExtraLabelAndCategory(k);
                const existing = pendingChangesRef.current.find(c => c.fieldName === k);
                const originalOldValue = existing ? existing.oldValue : oldValue;

                pendingChangesRef.current = [
                  ...pendingChangesRef.current.filter(c => c.fieldName !== k),
                  {
                    fieldName: k,
                    fieldLabel: info.label,
                    fieldCategory: info.category,
                    oldValue: originalOldValue,
                    newValue,
                    action: 'calculator field changed',
                  }
                ];
              }
            });
          }

          if (patch.discounts) {
            Object.entries(patch.discounts).forEach(([k, v]) => {
              const oldValue = current.discounts[k] ?? false;
              const newValue = v ?? false;
              if (oldValue !== newValue) {
                const info = getDiscountLabelAndCategory(k);
                const existing = pendingChangesRef.current.find(c => c.fieldName === k);
                const originalOldValue = existing ? existing.oldValue : oldValue;

                pendingChangesRef.current = [
                  ...pendingChangesRef.current.filter(c => c.fieldName !== k),
                  {
                    fieldName: k,
                    fieldLabel: info.label,
                    fieldCategory: info.category,
                    oldValue: originalOldValue,
                    newValue,
                    action: 'calculator field changed',
                  }
                ];
              }
            });
          }

          if (fieldLogTimerRef.current) {
            clearTimeout(fieldLogTimerRef.current);
          }
          fieldLogTimerRef.current = setTimeout(() => {
            flushQueuedFieldChanges(current);
          }, 1000);
        }

        if (patch.inputs) current.inputs = { ...current.inputs, ...patch.inputs };
        if (patch.extras) current.extras = { ...current.extras, ...patch.extras };
        if (patch.discounts) current.discounts = { ...current.discounts, ...patch.discounts };
        if (patch.price !== undefined) current.price = patch.price;
        if (patch.isRolloutConfirmed !== undefined)
          current.isRolloutConfirmed = patch.isRolloutConfirmed;
        if (patch.isDefaultPayment !== undefined) {
          current.isDefaultPayment = patch.isDefaultPayment;
          if (patch.isDefaultPayment === true) {
            next.forEach((c, idx) => {
              if (idx !== activeIdx) {
                c.isDefaultPayment = false;
                if (c._id) {
                  saveCalculator(c);
                }
              }
            });
          }
        }
        if (patch.dropPrice) current.dropPrice = patch.dropPrice;
        if (patch.name) current.name = patch.name;
        if (patch.downPayment !== undefined) current.downPayment = patch.downPayment;
        next[activeIdx] = current;

        const getRetailPrice = (calc: any) => {
          const res = calculateQuote(calc.inputs, calc.extras, '3', '100', 'check', {
            seniorVet: false,
            preOrder: false,
          });
          return res.baseRetailTotal;
        };
        const titles = getUpdatedCalculatorTitles(next, getRetailPrice);
        const displacedToSave: any[] = [];
        next.forEach((c, idx) => {
          const key = c._id || `temp-${idx}`;
          if (titles[key]) c.name = titles[key];
          if (idx !== activeIdx && c._id) {
            const oldTitle = lastSavedTitlesRef.current[c._id];
            if (oldTitle && c.name && oldTitle !== c.name) {
              displacedToSave.push({ ...c });
            }
          }
        });

        if (displacedToSave.length > 0) {
          setTimeout(() => {
            displacedToSave.forEach((c) => saveCalculatorRef.current(c));
          }, 0);
        }

        if (bypassAutoSave) {
          isPendingSave.current = false;
        } else {
          isPendingSave.current = true;
        }
        latestActiveRef.current = next[activeIdx];
        return next;
      });
    },
    [activeIdx]
  );

  const saveCalculator = async (data: any) => {
    if (!data?._id || isAutoSavingRef.current) return;
    try {
      setIsAutoSaving(true);

      // Check if title changed to trigger auto_rename log
      const oldTitle = lastSavedTitlesRef.current[data._id];
      const newTitle = data.name;
      if (oldTitle && newTitle && oldTitle !== newTitle) {
        lastSavedTitlesRef.current[data._id] = newTitle;
        const userId = user?._id || user?.id;
        if (userId) {
          logEvent('auto_rename', {
            user_id: userId,
            created_by: userId,
            module_type: 'calculator',
            meta: {
              calculatorId: data._id,
              appointmentId: data.appointmentId || appointmentId,
              calculatorTitle: newTitle,
              action: 'calculator_auto_renamed',
            },
          });
        }
      } else if (!oldTitle && newTitle) {
        lastSavedTitlesRef.current[data._id] = newTitle;
      }
      isAutoSavingRef.current = true;

      let rawDrops = (data.dropPrice || []).map(({ _clientId, ...rest }: any) => rest);
      const targetApptId = data.appointmentId || appointmentId;
      if (targetApptId) {
        try {
          const calcRes = await LeadService.getCalculators(targetApptId);
          const calculatorsData = calcRes.data?.data || calcRes.data || [];
          const matched = calculatorsData.find((c: any) => c._id === data._id);
          if (matched && matched.dropPrice) {
            rawDrops = rawDrops.map((dp: any) => {
              if (!dp._id) {
                const matchedDbDrop = matched.dropPrice.find(
                  (dbDp: any) =>
                    Number(dbDp.dropedPrice) === Number(dp.dropedPrice) &&
                    dbDp.status === dp.status
                );
                if (matchedDbDrop) {
                  return { ...dp, _id: matchedDbDrop._id };
                }
              }
              return dp;
            });
          }
        } catch (err) {
          console.warn('Failed to resolve dropPrice _ids in saveCalculator', err);
        }
      }

      const payload = {
        title: data.name,
        position: data.position,
        gutter5DsE: Number(data.inputs.gutter5DsE),
        gutter6Ft1: Number(data.inputs.gutter6Ft1),
        gutter7DsE: Number(data.inputs.gutter7DsE),
        miters: Number(data.inputs.miters),
        endCaps: Number(data.inputs.endCaps),
        spoutSavers: Number(data.inputs.spoutSavers),
        versaMaxFt1: Number(data.inputs.versaMaxFt1),
        versaMaxFt2: Number(data.inputs.versaMaxFt2),
        versaMaxFt3: Number(data.inputs.versaMaxFt3),
        versa6Ft1: Number(data.inputs.versa6Ft1),
        versa7Ft1: Number(data.inputs.versa7Ft1),
        filter45Ft1: Number(data.inputs.filter45Ft1),
        versa6Ft2: Number(data.inputs.versa6Ft2),
        versa7Ft2: Number(data.inputs.versa7Ft2),
        filter45Ft2: Number(data.inputs.filter45Ft2),
        versa6Ft3: Number(data.inputs.versa6Ft3),
        versa7Ft3: Number(data.inputs.versa7Ft3),
        filter45Ft3: Number(data.inputs.filter45Ft3),
        ckToInstallers: Number(data.inputs.ckToInstallers),
        extraLabor: Number(data.inputs.extraLabor),
        paymentMethod: data.inputs.paymentPlan,
        pricemarkup: data.inputs.markup,
        price: data.price,
        downPayment: data.downPayment,
        isRolloutConfirmed: data.isRolloutConfirmed,
        isDefaultPayment: data.isDefaultPayment,
        discounts: data.discounts,
        discountPercentage: Number(data.inputs.discountPercentage || 15),
        isDefaultDiscount: !!data.inputs.isDefaultDiscount,
        dropPrice: rawDrops,
        ...Object.keys(data.extras).reduce(
          (acc, k) => ({
            ...acc,
            [(extrasList as any[]).find((e: any) => e.id === k)?.apiKey || k]: Number(
              data.extras[k]
            ),
          }),
          {}
        ),
      };
      await LeadService.updateCalculator(data._id, payload);
      const now = new Date();
      setLastUpdatedAt(
        now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
      );
      isPendingSave.current = false;
    } catch (e) {
      console.warn('Auto-save failed', e);
    } finally {
      setIsAutoSaving(false);
      isAutoSavingRef.current = false;
    }
  };
  saveCalculatorRef.current = saveCalculator;

  useEffect(() => {
    if (active) {
      const currentInState = calculators.find((c) => c._id === latestActiveRef.current?._id);
      if (currentInState) {
        latestActiveRef.current = currentInState;
        if (currentInState.isRolloutConfirmed) {
          isPendingSave.current = false;
        }
      } else {
        latestActiveRef.current = active;
      }
    }
  }, [calculators, active]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPendingSave.current && !isAutoSavingRef.current && latestActiveRef.current) {
        saveCalculator(latestActiveRef.current);
      }
    }, 3000);

    return () => {
      clearInterval(timer);
      if (isPendingSave.current && latestActiveRef.current) {
        saveCalculator(latestActiveRef.current);
      }
    };
  }, []);

  const handleAddNewCalculator = async () => {
    const apptId = appointmentId || lead.appointmentId || lead.latestAppointment?._id || lead._id;
    if (!apptId) return;
    try {
      setLoading(true);
      if (isPendingSave.current && latestActiveRef.current) {
        await saveCalculator(latestActiveRef.current);
      }
      const leadName = `${lead.customerDetails?.firstName || ''} ${lead.customerDetails?.lastName || ''
        }`.trim();
      const initialTitle = leadName || `${calculators.length + 1}`;

      const defaultCalc = calculators.find((c) => c.isDefaultPayment);
      const defaultPay = defaultCalc ? defaultCalc.inputs?.paymentPlan : (user?.defaultPaymentMethod || getDefaultPaymentMethod(isLowesLead));
      const shouldSetDefaultToggle = defaultCalc ? true : false;

      // Mirror web: seed default discount from user.defaultPercentage
      const defaultDiscount = user?.defaultPercentage || INITIAL_INPUTS.discountPercentage;
      const shouldSetDefaultDiscount = !!user?.defaultPercentage;

      const positions = calculators.map((c) => c.position ?? 0);
      const nextPosition = positions.length > 0 ? Math.max(...positions) + 1 : 1;

      const fullPayload = {
        title: '.',
        position: nextPosition,
        ...INITIAL_INPUTS,
        paymentPlan: defaultPay,
        paymentMethod: defaultPay,
        isDefaultPayment: shouldSetDefaultToggle,
        discountPercentage: defaultDiscount,
        isDefaultDiscount: shouldSetDefaultDiscount,
        pricemarkup: '100',
        ...Object.keys(INITIAL_EXTRAS).reduce((acc, k) => ({ ...acc, [k]: 0 }), {}),
        price: 0,
      };
      await LeadService.createCalculator(apptId, fullPayload);

      const newCalcs = await fetchCalculators();
      if (newCalcs && newCalcs.length > 0) {
        setActiveIdx(newCalcs.length - 1);

        const createdCalc = newCalcs[newCalcs.length - 1];
        const userId = user?._id || user?.id;
        if (userId && createdCalc) {
          await logCalculatorCreated({
            userId,
            calculatorId: createdCalc._id,
            appointmentId: apptId,
            calculatorTitle: createdCalc.name,
            isFirstCalculator: false,
            calculatorPosition: createdCalc.position ?? nextPosition,
            action: 'calculator_created',
          });
          const inheritedPaymentMethod = defaultPay || '';
          if (inheritedPaymentMethod) {
            await logPaymentMethodInherited({
              userId,
              calculatorId: createdCalc._id,
              appointmentId: apptId,
              calculatorTitle: createdCalc.name,
              paymentMethod: inheritedPaymentMethod,
              inheritanceSource: 'default payment method',
              toCalculator: createdCalc._id,
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to add calculator', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicateCalculator = async (idx: number) => {
    const apptId = appointmentId || lead.appointmentId || lead.latestAppointment?._id || lead._id;
    if (!apptId) return;

    const duplicate = calculators[idx];
    if (!duplicate) return;

    try {
      setLoading(true);
      if (isPendingSave.current && latestActiveRef.current) {
        await saveCalculator(latestActiveRef.current);
      }

      // Check if there is an existing default calculator settings
      const defaultCalc = calculators.find((c) => c.isDefaultPayment);
      const defaultPay = defaultCalc ? defaultCalc.inputs?.paymentPlan : (user?.defaultPaymentMethod || getDefaultPaymentMethod(isLowesLead));

      // Inherit paymentPlan and default status
      const paymentPlanToUse = defaultCalc ? defaultPay : (duplicate?.inputs?.paymentPlan || defaultPay);
      const isDefaultPaymentToUse = defaultCalc ? true : (duplicate?.isDefaultPayment || false);

      // Mirror web: derive isDefaultDiscount from user.defaultPercentage vs duplicated discount
      const isDefaultDiscountToUse =
        !!user?.defaultPercentage &&
        user.defaultPercentage === duplicate.inputs.discountPercentage;

      const positions = calculators.map((c) => c.position ?? 0);
      const nextPosition = positions.length > 0 ? Math.max(...positions) + 1 : 1;

      const cleanBaseName = duplicate.name
        .replace(/⚠️/g, '')
        .replace(/\s\((SM|MD|LG|XL|XXL(-[0-9])?)\)$/i, '')
        .trim();
      const warningTitle = `⚠️ ${cleanBaseName} ⚠️`;

      const dataExcludingKeys: any = {
        title: warningTitle,
        position: nextPosition,
        gutter5DsE: duplicate.inputs.gutter5DsE,
        gutter6Ft1: duplicate.inputs.gutter6Ft1,
        gutter7DsE: duplicate.inputs.gutter7DsE,
        miters: duplicate.inputs.miters,
        endCaps: duplicate.inputs.endCaps,
        spoutSavers: duplicate.inputs.spoutSavers,
        versaMaxFt1: duplicate.inputs.versaMaxFt1,
        versaMaxFt2: duplicate.inputs.versaMaxFt2,
        versaMaxFt3: duplicate.inputs.versaMaxFt3,
        versa6Ft1: duplicate.inputs.versa6Ft1,
        versa7Ft1: duplicate.inputs.versa7Ft1,
        filter45Ft1: duplicate.inputs.filter45Ft1,
        versa6Ft2: duplicate.inputs.versa6Ft2,
        versa7Ft2: duplicate.inputs.versa7Ft2,
        filter45Ft2: duplicate.inputs.filter45Ft2,
        versa6Ft3: duplicate.inputs.versa6Ft3,
        versa7Ft3: duplicate.inputs.versa7Ft3,
        filter45Ft3: duplicate.inputs.filter45Ft3,
        ckToInstallers: duplicate.inputs.ckToInstallers,
        extraLabor: duplicate.inputs.extraLabor,

        // Send snake_case keys as well to ensure backend compatibility
        gutter_footage: duplicate.inputs.gutter5DsE,
        gutter_6_footage: duplicate.inputs.gutter6Ft1,
        gutter_7_footage: duplicate.inputs.gutter7DsE,
        end_caps: duplicate.inputs.endCaps,
        spout_savers: duplicate.inputs.spoutSavers,
        versa_max_footage: duplicate.inputs.versaMaxFt1,
        versa_6_footage: duplicate.inputs.versa6Ft1,
        versa_7_footage: duplicate.inputs.versa7Ft1,
        filter_45_footage: duplicate.inputs.filter45Ft1,
        versa_6_footage_2: duplicate.inputs.versa6Ft2,
        versa_7_footage_2: duplicate.inputs.versa7Ft2,
        filter_45_footage_2: duplicate.inputs.filter45Ft2,
        versa_6_footage_3: duplicate.inputs.versa6Ft3,
        versa_7_footage_3: duplicate.inputs.versa7Ft3,
        filter_45_footage_3: duplicate.inputs.filter45Ft3,
        check_to_installers: duplicate.inputs.ckToInstallers,
        extra_labor_hours: duplicate.inputs.extraLabor,

        paymentPlan: paymentPlanToUse,
        paymentMethod: paymentPlanToUse,
        pricemarkup: duplicate.inputs.markup,
        price: '',
        isRolloutConfirmed: false,
        isDefaultPayment: isDefaultPaymentToUse,
        discounts: duplicate.discounts,
        discountPercentage: duplicate.inputs.discountPercentage,
        isDefaultDiscount: isDefaultDiscountToUse,
        ...Object.keys(duplicate.extras || {}).reduce((acc: any, k) => {
          const matchingExtra = (extrasList as any[]).find((e: any) => e.id === k || e.apiKey === k);
          if (matchingExtra) {
            acc[matchingExtra.id] = duplicate.extras[k];
            if (matchingExtra.apiKey) {
              acc[matchingExtra.apiKey] = duplicate.extras[k];
            }
          } else {
            acc[k] = duplicate.extras[k];
          }
          return acc;
        }, {}),
      };

      await LeadService.createCalculator(apptId, {
        ...dataExcludingKeys,
        originalCalculatorId: duplicate._id || duplicate.id,
        duplicateLog: {
          user_id: user?._id || user?.id,
          created_by: user?._id || user?.id,
          module_type: 'calculator',
          actionType: 'duplicate',
          meta: {
            leadId: lead?._id || lead?.id,
            sourceCalculatorId: duplicate._id,
            sourceCalculatorTitle: sanitizeCalculatorLogTitle(duplicate.name || duplicate.title || ''),
            newCalculatorTitle: sanitizeCalculatorLogTitle(warningTitle),
            appointmentId: apptId,
            position: nextPosition,
            action: 'Calculator',
            duplicateAction: 'calculator_duplicated',
          },
        },
      });

      const newCalcs = await fetchCalculators();
      if (newCalcs && newCalcs.length > 0) {
        setActiveIdx(newCalcs.length - 1);
        const createdCalc = newCalcs[newCalcs.length - 1];
        const userId = user?._id || user?.id;
        const logTitle = sanitizeCalculatorLogTitle(warningTitle);
        const sourceTitle = sanitizeCalculatorLogTitle(duplicate.name || duplicate.title || '');
        const leadIdVal = lead?._id || lead?.id;

        const inheritedPaymentMethod = duplicate?.inputs?.paymentPlan || duplicate?.paymentMethod || '';
        if (userId && createdCalc && inheritedPaymentMethod) {
          await logPaymentMethodInherited({
            userId,
            calculatorId: createdCalc._id,
            appointmentId: apptId,
            calculatorTitle: logTitle,
            paymentMethod: inheritedPaymentMethod,
            inheritanceSource: 'calculator duplication',
            fromCalculator: duplicate._id,
            toCalculator: createdCalc._id,
            sourceCalculatorTitle: sourceTitle,
            newCalculatorTitle: logTitle,
            leadId: leadIdVal,
          });
        }
      }
    } catch (e) {
      console.warn('Failed to duplicate', e);
    } finally {
      setLoading(false);
    }
  };

  const handleReorderCalculators = useCallback(async (newCalculators: any[], newActiveIdx: number) => {
    const updated = newCalculators.map((c, idx) => ({
      ...c,
      position: idx,
    }));

    const getRetailPrice = (calc: any) => {
      const res = calculateQuote(calc.inputs, calc.extras, '3', '100', 'check', {
        seniorVet: false,
        preOrder: false,
      });
      return res.baseRetailTotal;
    };
    const titles = getUpdatedCalculatorTitles(updated, getRetailPrice);
    updated.forEach((c, idx) => {
      const key = c._id || `temp-${idx}`;
      if (titles[key] !== undefined) c.name = titles[key];
    });

    setCalculators(updated);
    setActiveIdx(newActiveIdx);

    try {
      await Promise.all(
        updated.map((c, idx) => {
          if (!c._id) return Promise.resolve();
          const payload = {
            title: c.name,
            position: idx,
            gutter5DsE: Number(c.inputs.gutter5DsE),
            gutter6Ft1: Number(c.inputs.gutter6Ft1),
            gutter7DsE: Number(c.inputs.gutter7DsE),
            miters: Number(c.inputs.miters),
            endCaps: Number(c.inputs.endCaps),
            spoutSavers: Number(c.inputs.spoutSavers),
            versaMaxFt1: Number(c.inputs.versaMaxFt1),
            versaMaxFt2: Number(c.inputs.versaMaxFt2),
            versaMaxFt3: Number(c.inputs.versaMaxFt3),
            versa6Ft1: Number(c.inputs.versa6Ft1),
            versa7Ft1: Number(c.inputs.versa7Ft1),
            filter45Ft1: Number(c.inputs.filter45Ft1),
            versa6Ft2: Number(c.inputs.versa6Ft2),
            versa7Ft2: Number(c.inputs.versa7Ft2),
            filter45Ft2: Number(c.inputs.filter45Ft2),
            versa6Ft3: Number(c.inputs.versa6Ft3),
            versa7Ft3: Number(c.inputs.versa7Ft3),
            filter45Ft3: Number(c.inputs.filter45Ft3),
            ckToInstallers: Number(c.inputs.ckToInstallers),
            extraLabor: Number(c.inputs.extraLabor),
            paymentMethod: c.inputs.paymentPlan,
            pricemarkup: c.inputs.markup,
            price: c.price,
            isRolloutConfirmed: c.isRolloutConfirmed,
            isDefaultPayment: c.isDefaultPayment,
            discounts: c.discounts,
            discountPercentage: Number(c.inputs.discountPercentage || 15),
            isDefaultDiscount: !!c.inputs.isDefaultDiscount,
            ...Object.keys(c.extras).reduce(
              (acc, k) => ({
                ...acc,
                [(extrasList as any[]).find((e: any) => e.id === k)?.apiKey || k]: Number(
                  c.extras[k]
                ),
              }),
              {}
            ),
          };
          return LeadService.updateCalculator(c._id, payload);
        })
      );
    } catch (e) {
      console.warn('Failed to save reordered positions', e);
    }
  }, []);

  const handleDeleteCalculator = async (idx: number) => {
    if (calculators.length <= 1) return;
    const deletedCalc = calculators[idx];
    try {
      setLoading(true);
      await LeadService.deleteCalculator(deletedCalc._id);

      const userId = user?._id || user?.id;
      if (userId && deletedCalc) {
        logEvent('delete', {
          user_id: userId,
          created_by: userId,
          module_type: 'calculator',
          meta: {
            action: 'calculator_deleted',
            calculatorId: deletedCalc._id,
            calculatorTitle: deletedCalc.name,
            appointmentId: appointmentId || lead.appointmentId,
          },
        });
      }

      setCalculators((prev) => {
        const remaining = prev.filter((_, i) => i !== idx);

        // Re-calculate pricing/names to clear duplicate warning signs if no duplicate exists anymore
        const getRetailPrice = (calc: any) => {
          const res = calculateQuote(calc.inputs, calc.extras, '3', '100', 'check', {
            seniorVet: false,
            preOrder: false,
          });
          return res.baseRetailTotal;
        };
        const titles = getUpdatedCalculatorTitles(remaining, getRetailPrice);
        remaining.forEach((c, i) => {
          const key = c._id || `temp-${i}`;
          if (titles[key] !== undefined) c.name = titles[key];
        });

        // Save new positions and names to database
        Promise.all(
          remaining.map((c, i) => {
            if (!c._id) return Promise.resolve();
            const payload = {
              title: c.name,
              position: i,
              gutter5DsE: Number(c.inputs.gutter5DsE),
              gutter6Ft1: Number(c.inputs.gutter6Ft1),
              gutter7DsE: Number(c.inputs.gutter7DsE),
              miters: Number(c.inputs.miters),
              endCaps: Number(c.inputs.endCaps),
              spoutSavers: Number(c.inputs.spoutSavers),
              versaMaxFt1: Number(c.inputs.versaMaxFt1),
              versaMaxFt2: Number(c.inputs.versaMaxFt2),
              versaMaxFt3: Number(c.inputs.versaMaxFt3),
              versa6Ft1: Number(c.inputs.versa6Ft1),
              versa7Ft1: Number(c.inputs.versa7Ft1),
              filter45Ft1: Number(c.inputs.filter45Ft1),
              versa6Ft2: Number(c.inputs.versa6Ft2),
              versa7Ft2: Number(c.inputs.versa7Ft2),
              filter45Ft2: Number(c.inputs.filter45Ft2),
              versa6Ft3: Number(c.inputs.versa6Ft3),
              versa7Ft3: Number(c.inputs.versa7Ft3),
              filter45Ft3: Number(c.inputs.filter45Ft3),
              ckToInstallers: Number(c.inputs.ckToInstallers),
              extraLabor: Number(c.inputs.extraLabor),
              paymentMethod: c.inputs.paymentPlan,
              pricemarkup: c.inputs.markup,
              price: c.price,
              isRolloutConfirmed: c.isRolloutConfirmed,
              isDefaultPayment: c.isDefaultPayment,
              discounts: c.discounts,
              discountPercentage: Number(c.inputs.discountPercentage || 15),
              isDefaultDiscount: !!c.inputs.isDefaultDiscount,
              ...Object.keys(c.extras).reduce(
                (acc, k) => ({
                  ...acc,
                  [(extrasList as any[]).find((e: any) => e.id === k)?.apiKey || k]: Number(
                    c.extras[k]
                  ),
                }),
                {}
              ),
            };
            return LeadService.updateCalculator(c._id, payload);
          })
        ).catch((err) => {
          console.warn('Failed to update remaining calculators after deletion', err);
        });

        return remaining;
      });

      setActiveIdx(0);
    } catch (e) {
      console.warn('Delete calculator failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRenameCalculator = async (idx: number, newTitle: string) => {
    const calc = calculators[idx];
    const trimmed = newTitle.trim();
    if (!calc?._id || !trimmed) return;

    const previousTitle = calc.name || calc.title || '';
    if (previousTitle === trimmed) return;

    try {
      setLoading(true);
      setCalculators((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], name: trimmed };
        return next;
      });

      await LeadService.updateCalculator(calc._id, {
        title: trimmed,
        gutter5DsE: Number(calc.inputs?.gutter5DsE || 0),
        gutter6Ft1: Number(calc.inputs?.gutter6Ft1 || 0),
        gutter7DsE: Number(calc.inputs?.gutter7DsE || 0),
        paymentMethod: calc.inputs?.paymentPlan || 'check',
        pricemarkup: calc.inputs?.markup || '100',
        price: calc.price || 0,
      });

      lastSavedTitlesRef.current[calc._id] = trimmed;

      const userId = user?._id || user?.id;
      if (userId) {
        await logCalculatorRename({
          userId,
          calculatorId: calc._id,
          appointmentId: calc.appointmentId || appointmentId || '',
          previousCalculatorTitle: previousTitle,
          newCalculatorTitle: trimmed,
        });
      }
    } catch (e) {
      console.warn('Failed to rename calculator', e);
      Alert.alert('Error', 'Could not rename calculator. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return {
    calculators,
    setCalculators,
    activeIdx,
    setActiveIdx,
    active,
    inputs,
    extras,
    discounts,
    results,
    updateActive,
    loading,
    setLoading,
    isAutoSaving,
    lastUpdatedAt,
    appointmentId,
    handleAddNewCalculator,
    fetchCalculators,
    handleDuplicateCalculator,
    handleDeleteCalculator,
    handleReorderCalculators,
    handleRenameCalculator,
  };
};
