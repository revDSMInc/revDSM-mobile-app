import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  DealPlan,
  PayCategory,
  planLabelOf,
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
      <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 6 }}>1-YEAR MONTHLY</Text>

      {/* Match / Default segmented control */}
      <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, marginBottom: 8 }}>
        {segBtn('Match In-Home', mode === 'match', () => commit('match'))}
        {segBtn('Default', mode === 'default', () => commit('default'))}
      </View>

      {/* Monthly + plan label + override */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          {financing && monthly > 0 ? (
            <>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#60A5FA' }}>{fmt(monthly)}/mo</Text>
              <Text numberOfLines={1} style={{ fontSize: 8, color: '#94A3B8' }}>
                {mode === 'custom' ? 'Custom · ' : ''}{planLabelOf(plans, resolvedKey)}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 9, color: '#94A3B8' }}>Pick a financing plan to show a monthly</Text>
          )}
        </View>
        {!locked && (
          <TouchableOpacity
            onPress={() => setShowPicker(true)}
            style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, gap: 4 }}
          >
            <Ionicons name="create-outline" size={12} color="#4CBB17" />
            <Text style={{ fontSize: 9, fontWeight: '900', color: '#4CBB17' }}>Change</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Plan picker (custom) — bottom sheet matching the rollout PaymentPlanModal. */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <Pressable onPress={() => setShowPicker(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '82%', paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#1C252E' }}>Pick 1-Year Monthly Plan</Text>
              <TouchableOpacity onPress={() => setShowPicker(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color="#637381" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
              {financingCategories.length === 0 ? (
                <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', paddingVertical: 20 }}>No financing plans available.</Text>
              ) : (
                financingCategories.map((cat) => (
                  <View key={cat.title}>
                    {!!cat.title && (
                      <View style={{ backgroundColor: cat.bg || '#F1F5F9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8, alignSelf: 'flex-start' }}>
                        <Text style={{ fontSize: 10, fontWeight: '900', color: cat.text || '#637381' }}>{cat.title}</Text>
                      </View>
                    )}
                    {cat.plans.map((key) => {
                      const m = calcMonthly(plans, base, key);
                      const active = resolvedKey === key && mode === 'custom';
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => { commit('custom', key); setShowPicker(false); }}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: active ? '#4CBB17' : '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, backgroundColor: active ? '#4CBB170D' : '#fff' }}
                        >
                          <View style={{ flex: 1, paddingRight: 12 }}>
                            <Text style={{ fontSize: 12, fontWeight: '900', color: '#1C252E' }}>{planLabelOf(plans, key)}</Text>
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
