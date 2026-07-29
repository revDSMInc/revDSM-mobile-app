import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  DealPlan,
  PayCategory,
  calcMonthly,
  planLabelOf,
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

      {/* Monthly + APR + edit — mockup: "$200 /mo  9.99% / APR  [pencil]".
          `gap` keeps a guaranteed gutter before the edit button and `flexWrap`
          lets the APR drop onto its own line (rather than hiding behind the
          pencil) when the monthly is wide, e.g. a 3-digit "$134" in the narrow
          1-Year column. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        {financing && monthly > 0 ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#212B36' }}>{fmt(monthly)}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 6 }}>/mo</Text>
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
                <Text style={{ fontSize: 16, fontWeight: '900', color: '#1C252E' }}>Pick 1 Year Monthly Plan</Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>This monthly flows through to the Investment Center.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#637381" />
              </TouchableOpacity>
            </View>
            {/* Full plan sheet — grouped by provider (GreenSky / Wells Fargo / …),
                each row the plan's FULL label + APR, with the monthly on the right,
                matching the rollout's payment picker. */}
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {financingCategories.length === 0 ? (
                <Text style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', paddingVertical: 24 }}>No financing plans available.</Text>
              ) : (
                financingCategories.map((cat, ci) => (
                  <View key={cat.title || ci} style={{ marginBottom: 6 }}>
                    {!!cat.title && (
                      <View style={{ backgroundColor: cat.bg || '#F1F5F9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8, alignSelf: 'flex-start' }}>
                        <Text style={{ fontSize: 10, fontWeight: '900', color: cat.text || '#637381' }}>{cat.title}</Text>
                      </View>
                    )}
                    {cat.plans.map((key) => {
                      const m = calcMonthly(plans, base, key);
                      // Selected when this is the active plan (match/default resolve to a key too).
                      const isSel = mode === 'custom' ? value?.planKey === key : resolvedKey === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          activeOpacity={0.85}
                          onPress={() => { commit('custom', key); setShowPicker(false); }}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#4CBB17' : '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 9, backgroundColor: isSel ? '#4CBB170D' : '#fff' }}
                        >
                          <View style={{ flex: 1, paddingRight: 12 }}>
                            <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#1C252E', lineHeight: 15 }}>{planLabelOf(plans, key)}</Text>
                            {(plans[key]?.apr || 0) > 0 && (
                              <Text style={{ fontSize: 9, color: '#94A3B8', marginTop: 2 }}>{plans[key]?.apr}% APR</Text>
                            )}
                          </View>
                          <Text style={{ fontSize: 13, fontWeight: '900', color: '#60A5FA' }}>{m > 0 ? `${fmt(m)}/mo` : '—'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
