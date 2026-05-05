import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { calculateQuote } from '../utils/calculator/calculation-utils';
import { calculateResultUtil } from '../utils/calculator/calculation-results-util';
import { getUpdatedCalculatorTitles } from '../utils/calculator/tab-naming.utils';
import { pricing, extrasList, extrasList50 } from '../utils/calculator/pricing-data';
import { paymentPlans } from '../utils/calculator/payment-plans';
import { LeadService } from '../services/api/leads';
import { Alert } from 'react-native';

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
  const [calculators, setCalculators] = useState<any[]>([
    {
      _id: null,
      name: 'Rollout 1',
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
    });
    const finalTotal = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: inputs.markup || '100',
      hideScreens: true,
    });
    const price65 = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: '65',
      hideScreens: true,
    });
    const price100 = calculateResultUtil({
      details: active,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      markupKey: '100',
      hideScreens: true,
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
        items.push({ label: e.label, value: val, category: e.category || 'Additional Services' });
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

  const fetchCalculators = async () => {
    if (!lead?._id) return;
    try {
      setLoading(true);
      const dateStr =
        lead.leadDate || lead.appointmentDate || lead.date || new Date().toISOString();
      const finalLeadDate = lead.leadDate
        ? lead.leadDate
        : dateStr.split('T')[0] + 'T00:00:00+05:00';

      let res = await LeadService.getAppointments({ lead_date: finalLeadDate });
      let appointments = res.data?.data || res.data || [];
      const targetTitle =
        lead.title ||
        `${lead.customerDetails?.firstName || ''} ${lead.customerDetails?.lastName || ''}`.trim() ||
        'test user';

      const findMyAppt = (list: any[]) =>
        list.find(
          (a: any) =>
            a.selfGenLeadId === lead._id ||
            a.leadId === lead._id ||
            a._id === lead.appointmentId ||
            a.id === lead.appointmentId ||
            a.title?.trim().toLowerCase() === targetTitle.trim().toLowerCase()
        );
      let myAppt = findMyAppt(appointments);

      if (!myAppt && appointments.length === 0) {
        try {
          await LeadService.createAppointment({
            title: targetTitle,
            address: lead.customerDetails?.address || 'N/A',
            leadId: lead.leadId || 'N/A',
            selfGenLeadId: lead._id,
          });
          res = await LeadService.getAppointments({ lead_date: finalLeadDate });
          appointments = res.data?.data || res.data || [];
          myAppt = findMyAppt(appointments);
        } catch (err: any) {}
      }

      if (!myAppt && appointments.length > 0) myAppt = appointments[0];
      if (!myAppt) return;

      const apptId = myAppt._id;
      setAppointmentId(apptId);

      const calcRes = await LeadService.getCalculators(apptId);
      let calculatorsData = calcRes.data?.data || calcRes.data || [];

      if (calculatorsData.length === 0) {
        const fullPayload = {
          title: '1',
          position: 1,
          ...INITIAL_INPUTS,
          paymentMethod: 'check',
          pricemarkup: '100',
          ...Object.keys(INITIAL_EXTRAS).reduce((acc, k) => ({ ...acc, [k]: 0 }), {}),
          price: 0,
        };
        await LeadService.createCalculator(apptId, fullPayload);
        const reCalcRes = await LeadService.getCalculators(apptId);
        calculatorsData = reCalcRes.data?.data || reCalcRes.data || [];
      }

      if (calculatorsData.length > 0) {
        const mappedCalculators = calculatorsData.map((c: any, idx: number) => ({
          _id: c._id,
          name: c.title || `${idx + 1}`,
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
            paymentPlan: c.paymentMethod || 'check',
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
          price: c.price || 0,
          dropPrice: c.dropPrice || [],
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
        mappedCalculators.forEach((c: { _id: string | number; name: any; }) => {
          if (c._id && titles[c._id]) c.name = titles[c._id];
        });

        setCalculators(mappedCalculators);
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalculators();
  }, [lead?._id]);

  const updateActive = useCallback(
    (patch: any) => {
      setCalculators((prev) => {
        const next = [...prev];
        if (!next[activeIdx]) return prev;
        const current = { ...next[activeIdx] };
        if (patch.inputs) current.inputs = { ...current.inputs, ...patch.inputs };
        if (patch.extras) current.extras = { ...current.extras, ...patch.extras };
        if (patch.discounts) current.discounts = { ...current.discounts, ...patch.discounts };
        if (patch.price !== undefined) current.price = patch.price;
        if (patch.isRolloutConfirmed !== undefined)
          current.isRolloutConfirmed = patch.isRolloutConfirmed;
        if (patch.dropPrice) current.dropPrice = patch.dropPrice;
        if (patch.name) current.name = patch.name;
        next[activeIdx] = current;

        const getRetailPrice = (calc: any) => {
          const res = calculateQuote(calc.inputs, calc.extras, '3', '100', 'check', {
            seniorVet: false,
            preOrder: false,
          });
          return res.baseRetailTotal;
        };
        const titles = getUpdatedCalculatorTitles(next, getRetailPrice);
        next.forEach((c) => {
          if (c._id && titles[c._id]) c.name = titles[c._id];
        });

        isPendingSave.current = true;
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
      isAutoSavingRef.current = true;
      const payload = {
        title: data.name,
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
        isRolloutConfirmed: data.isRolloutConfirmed,
        discounts: data.discounts,
        discountPercentage: Number(data.inputs.discountPercentage || 15),
        isDefaultDiscount: !!data.inputs.isDefaultDiscount,
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

  useEffect(() => {
    if (!latestActiveRef.current) latestActiveRef.current = active;
  }, [active]);

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
      const leadName = `${lead.customerDetails?.firstName || ''} ${
        lead.customerDetails?.lastName || ''
      }`.trim();
      const initialTitle = leadName || `${calculators.length + 1}`;

      const fullPayload = {
        title: initialTitle,
        position: calculators.length,
        ...INITIAL_INPUTS,
        paymentMethod: 'check',
        pricemarkup: '100',
        ...Object.keys(INITIAL_EXTRAS).reduce((acc, k) => ({ ...acc, [k]: 0 }), {}),
        price: 0,
      };
      const res = await LeadService.createCalculator(apptId, fullPayload);
      const newC = res.data?.data || res.data;
      setCalculators([
        ...calculators,
        {
          _id: newC._id,
          name: newC.title || initialTitle,
          inputs: INITIAL_INPUTS,
          extras: INITIAL_EXTRAS,
          discounts: { seniorVet: false, preOrder: false },
          price: 0,
        },
      ]);
      setActiveIdx(calculators.length);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicateCalculator = async (idx: number) => {
    const apptId = appointmentId || lead.appointmentId || lead.latestAppointment?._id || lead._id;
    if (!apptId) return;

    Alert.alert(
      'Duplicate Calculator',
      'Are you sure you want to create a copy of this pricing scenario?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Duplicate',
          onPress: async () => {
            try {
              setLoading(true);
              const duplicate = calculators[idx];
              const res = await LeadService.createCalculator(apptId, {
                title: `${duplicate.name} (Copy)`,
                ...duplicate.inputs,
                ...duplicate.extras,
                paymentMethod: duplicate.inputs.paymentPlan,
                pricemarkup: duplicate.inputs.markup,
              });
              const newC = res.data?.data || res.data;
              const newList = [...calculators, { ...duplicate, _id: newC._id, name: newC.title }];
              setCalculators(newList);
              setActiveIdx(newList.length - 1);
            } catch (e) {
              console.warn('Failed to duplicate', e);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteCalculator = async (idx: number) => {
    if (calculators.length <= 1) return;
    try {
      setLoading(true);
      await LeadService.deleteCalculator(calculators[idx]._id);
      setCalculators((prev) => prev.filter((_, i) => i !== idx));
      setActiveIdx(0);
    } catch (e) {
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
  };
};
