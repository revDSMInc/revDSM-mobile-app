import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  DealPlan,
  PayCategory,
  calcMonthly,
  isFinancing,
} from '../hooks/useDealPricing';

/**
 * 1-Year Program monthly-payment selector (web parity: the `OneYearMonthlyPlan`
 * sub-component in `PricingSharedUI.js`). The 1-Year card can now show a monthly
 * payment that either **matches** the In-Home selected plan or uses the rep's
 * **default** 1-Year financing plan — and the rep may override it with ANY
 * financing plan (it is allowed to be "worse" than the In-Home plan). The chosen
 * plan persists on the calculator as `oneYearMonthlyPlan` so the Investment Center
 * shows the same monthly.
 */

export type OneYearMonthlyValue = {
  mode: 'match' | 'default' | 'custom';
  planKey?: string;
  apr?: number;
  monthlyPayment?: number;
  grandTotal?: number;
  isDefault?: boolean;
} | null;

interface Props {
  plans: Record<string, DealPlan>;
  categories: PayCategory[];
  /** The In-Home selected plan key — used by `match` mode. */
  inHomeMethod: string;
  /** The rep's default 1-Year financing plan key — used by `default` mode. */
  defaultKey: string;
  /** The 1-Year program grand total (financing base). */
  base: number;
  value: OneYearMonthlyValue;
  onChange: (v: OneYearMonthlyValue) => void;
  locked?: boolean;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Catalog aprs are stored as fractions (0.0999 = 9.99%); tolerate a whole percent. */
const aprPercent = (apr: any): number => {
  const n = Number(apr) || 0;
  if (n <= 0) return 0;
  return n < 1 ? n * 100 : n;
};

/** 120 → "120th", 33 → "33rd", 1 → "1st" (web `getOrdinal`). */
const getOrdinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Web `formatPlanTerms`: "9.99% APR · 1/29th" for a standard financing plan,
 *  "0% for 6mo · 1/120th" for a deferred-interest plan. */
function formatPlanTerms(plan: any): string {
  const pf = Number(plan?.pf) || 0;
  const totalLoanMonths = Number(plan?.totalLoanMonths) || 0;
  const duration = Number(plan?.duration) || 0;
  const deferredMonths = Number(plan?.deferredMonths) || 0;
  const apr = aprPercent(plan?.apr);
  let n = 0;
  if (pf > 0) n = Math.round(1 / pf);
  else if (totalLoanMonths > 0) n = totalLoanMonths;
  else if (duration > 0) n = duration;
  const fraction = n > 0 ? `1/${getOrdinal(n)}` : '';
  const leading = apr > 0 ? `${Number(apr.toFixed(2))}% APR` : deferredMonths > 0 ? `0% for ${deferredMonths}mo` : '0% APR';
  return fraction ? `${leading} · ${fraction}` : leading;
}

export function OneYearMonthlyPlan({ plans, categories, inHomeMethod, defaultKey, base, value, onChange, locked = false }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const mode = value?.mode || 'match';

  const resolvedKey = useMemo(() => {
    if (mode === 'match') return inHomeMethod;
    if (mode === 'default') return defaultKey;
    return value?.planKey || defaultKey;
  }, [mode, inHomeMethod, defaultKey, value?.planKey]);

  const monthly = useMemo(() => calcMonthly(plans, base, resolvedKey), [plans, base, resolvedKey]);
  const financing = isFinancing(plans, resolvedKey);

  const commit = (nextMode: 'match' | 'default' | 'custom', nextKey?: string) => {
    if (locked) return;
    const key = nextMode === 'match' ? inHomeMethod : nextMode === 'default' ? defaultKey : (nextKey || defaultKey);
    const m = calcMonthly(plans, base, key);
    onChange({
      mode: nextMode,
      planKey: key,
      apr: plans[key]?.apr,
      monthlyPayment: m,
      grandTotal: base,
    });
  };

  // Financing plans grouped exactly like the payment-method picker, but only the
  // financing ones (cash/card can't carry a monthly on the 1-Year program).
  const financingCategories = useMemo(
    () =>
      (categories || [])
        .map((c) => ({ ...c, plans: (c.plans || []).filter((k) => isFinancing(plans, k)) }))
        .filter((c) => c.plans.length > 0),
    [categories, plans],
  );

  // Flat, presentation-friendly list for the picker sheet: every eligible financing
  // plan as "$X/mo · terms", highest monthly first (web `oneYearPlanOptions`).
  const planOptions = useMemo(() => {
    const keys: string[] = [];
    financingCategories.forEach((c) => (c.plans || []).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    return keys
      .filter((k) => {
        const p = plans[k];
        if (!p) return false;
        const min = Number(p.minPrice) || 0;
        return !(min > 0 && base > 0 && base < min);
      })
      .map((k) => ({ key: k, monthly: calcMonthly(plans, base, k), terms: formatPlanTerms(plans[k]) }))
      .filter((o) => o.monthly > 0)
      .sort((a, b) => b.monthly - a.monthly);
  }, [financingCategories, plans, base]);

  const segBtn = (label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity
      disabled={locked}
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 5,
        borderRadius: 8,
        alignItems: 'center',
        backgroundColor: active ? '#4CBB17' : 'transparent',
        opacity: locked && !active ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 9, fontWeight: '900', color: active ? '#fff' : '#94A3B8' }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 10 }}>
      <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 6 }}>MONTHLY PLAN</Text>

      {/* Match / Default segmented control */}
      <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, marginBottom: 8 }}>
        {segBtn('Match', mode === 'match', () => commit('match'))}
        {segBtn('Default', mode === 'default', () => commit('default'))}
      </View>

      {/* Monthly + APR + edit — mockup: "$200 /mo  9.99% / APR  [pencil]" */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {financing && monthly > 0 ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 22, fontWeight: '900', color: '#212B36' }}>{fmt(monthly)}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 7 }}>/mo</Text>
            <View style={{ marginLeft: 5, marginTop: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', lineHeight: 11 }}>{`${Number(aprPercent(plans[resolvedKey]?.apr).toFixed(2))}%`}</Text>
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', lineHeight: 11 }}>APR</Text>
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: 9, color: '#94A3B8', flex: 1 }}>Pick a financing plan to show a monthly</Text>
        )}
        {!locked && (
          <TouchableOpacity
            onPress={() => setShowPicker(true)}
            style={{ width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="create-outline" size={17} color="#3B82F6" />
          </TouchableOpacity>
        )}
      </View>

      {/* Plan picker (custom) — bottom sheet matching the rollout PaymentPlanModal. */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <Pressable onPress={() => setShowPicker(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: '#F2F4F7', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '82%', paddingBottom: 24 }}>
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1' }} />
            </View>
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#1C252E' }}>Pick 1 Year Monthly Plan</Text>
                <Text style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>This monthly flows through to the Investment Center.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#637381" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {planOptions.length === 0 ? (
                <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingVertical: 24 }}>No financing plans are eligible for this total.</Text>
              ) : (
                planOptions.map((opt) => {
                  // Selected when this is the active plan (match/default resolve to a key too).
                  const isSel = mode === 'custom' ? value?.planKey === opt.key : resolvedKey === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      activeOpacity={0.85}
                      onPress={() => { commit('custom', opt.key); setShowPicker(false); }}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#4CBB17' : '#E2E8F0', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16, marginBottom: 12, backgroundColor: isSel ? '#4CBB170D' : '#fff' }}
                    >
                      <Text style={{ fontSize: 20, fontWeight: '900', color: '#4CBB17' }}>
                        {fmt(opt.monthly)}<Text style={{ fontSize: 12, fontWeight: '800' }}>/mo</Text>
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#637381' }} numberOfLines={1}>{opt.terms}</Text>
                        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: isSel ? 0 : 1.5, borderColor: '#CBD5E1', backgroundColor: isSel ? '#4CBB17' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                          {isSel && <Ionicons name="checkmark" size={15} color="#fff" />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
