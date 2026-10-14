import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  DealPlan,
  PayCategory,
  calcMonthly,
  planLabelOf,
  isFinancing,
} from '../hooks/useDealPricing';
import { oneYearNeedsResync } from '../../../utils/one-year-default';

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
  inHomeMethod: string;
  defaultKey: string;
  base: number;
  value: OneYearMonthlyValue;
  onChange: (v: OneYearMonthlyValue) => void;
  locked?: boolean;
  /** REVUIUX-444: the REP's own 1 Year default plan key (`user.defaultOneYearPaymentMethod`, already validated); null when none. */
  repDefaultKey?: string | null;
  /** Star in the plan sheet: set (key) or clear (null) the rep's default. Independent of `mode`. */
  onSetRepDefault?: (key: string | null) => void;
}

// "2521 (12 Months 0% ...)" -> "2521"; falls back to the whole label when there is no code.
const planCodeOf = (label: string) => (label.split('(')[0] || label).trim();

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

const aprPercent = (apr: any): number => {
  const n = Number(apr) || 0;
  if (n <= 0) return 0;
  return n < 1 ? n * 100 : n;
};

export function OneYearMonthlyPlan({ plans, categories, inHomeMethod, defaultKey, base, value, onChange, locked = false, repDefaultKey = null, onSetRepDefault }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerScrollRef = useRef<ScrollView>(null);
  // `defaultKey` already puts the rep's default first (see `resolveOneYearDefaultKey`), so `Default` mode is always LIVE:
  // changing the rep default moves every deal still on `Default`; Match / custom picks are the rep's decision and stay.
  const mode = value?.mode || (repDefaultKey ? 'default' : 'match');

  const resolvedKey = useMemo(() => {
    if (mode === 'match') return inHomeMethod;
    if (mode === 'default') return defaultKey;
    return value?.planKey || defaultKey;
  }, [mode, inHomeMethod, defaultKey, value?.planKey]);

  const monthly = useMemo(() => calcMonthly(plans, base, resolvedKey), [plans, base, resolvedKey]);
  const financing = isFinancing(plans, resolvedKey);

  // ⚠️ `isDefault` is never set from the app any more: the user record owns the default (REVUIUX-444). Writing it on a
  // mode change is what used to erase the rep's pick when they tapped Match then Default.
  const commit = (nextMode: 'match' | 'default' | 'custom', nextKey?: string) => {
    if (locked) return;
    const key = nextMode === 'match' ? inHomeMethod : nextMode === 'default' ? defaultKey : (nextKey || defaultKey);
    onChange({
      mode: nextMode,
      planKey: key,
      apr: plans[key]?.apr,
      monthlyPayment: calcMonthly(plans, base, key),
      grandTotal: base,
      isDefault: false,
    });
  };

  // Stamp / re-stamp a `Default` calculator: a new one arrives from the backend with monthly 0 (it prices nothing), and a
  // changed rep default must reach every deal still on Default.
  const defaultMonthly = useMemo(() => calcMonthly(plans, base, defaultKey), [plans, base, defaultKey]);
  const defaultApr = plans[defaultKey]?.apr;
  useEffect(() => {
    if (locked || mode !== 'default') return;
    if (!oneYearNeedsResync(value, defaultKey, defaultMonthly, base, !!repDefaultKey)) return;
    onChange({
      mode: 'default',
      planKey: defaultKey,
      apr: defaultApr,
      monthlyPayment: defaultMonthly,
      grandTotal: base,
      isDefault: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, mode, defaultKey, defaultMonthly, defaultApr, base, !!repDefaultKey, value?.mode, value?.planKey, value?.monthlyPayment, value?.grandTotal, value?.isDefault]);

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
          // Basic method (Check / card / ACH): no financing term, so the monthly is $0 - shown
          // exactly like the web 1-Year card ("$0 /mo  Check (Bank Fee: 0%)") instead of a hint.
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#4CBB17' }}>{fmt(0)}</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#4CBB17', marginLeft: 2 }}>/mo</Text>
            </View>
            <Text numberOfLines={2} style={{ fontSize: 9, fontWeight: '700', color: '#637381', marginTop: 2 }}>{planLabelOf(plans, resolvedKey)}</Text>
          </View>
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

      <Text style={{ fontSize: 9, color: '#94A3B8', marginTop: 8, lineHeight: 12 }}>
        {mode === 'match' ? 'Mirrors In-Home selected plan \u00B7 pencil overrides' : mode === 'default' ? 'Uses your default plan \u00B7 pencil overrides' : 'Custom plan \u00B7 Match resets it'}
      </Text>

      {/* Plan picker (custom) — bottom sheet matching the rollout PaymentPlanModal. */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <Pressable onPress={() => setShowPicker(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: '#F2F4F7', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '82%', paddingBottom: 24 }}>
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1' }} />
            </View>
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
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
            <ScrollView ref={pickerScrollRef} contentContainerStyle={{ padding: 16 }}>
              {/* The REP's default plan (REVUIUX-444) - shown in EVERY mode so it can be seen and changed from Match too.
                  The star on a row sets it; it is independent of the Match / Default toggle. */}
              {repDefaultKey && !!plans[repDefaultKey] ? (
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#4CBB17', letterSpacing: 0.5, marginBottom: 6 }}>MY DEFAULT PLAN</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#4CBB17', borderRadius: 12, backgroundColor: '#4CBB170D', paddingHorizontal: 14, paddingVertical: 12 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#4CBB1726', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                      <Ionicons name="star" size={17} color="#4CBB17" />
                    </View>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#1C252E', lineHeight: 15 }}>
                        {`${plans[repDefaultKey]?.provider ? plans[repDefaultKey].provider + ' ' : ''}${planCodeOf(planLabelOf(plans, repDefaultKey))}${calcMonthly(plans, base, repDefaultKey) > 0 ? ` \u00B7 ${fmt(calcMonthly(plans, base, repDefaultKey))}/mo` : ''}`}
                      </Text>
                      {!!(plans[repDefaultKey]?.shortlabel || plans[repDefaultKey]?.displayMonths) && (
                        <Text style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{plans[repDefaultKey]?.shortlabel || plans[repDefaultKey]?.displayMonths}</Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => pickerScrollRef.current?.scrollTo({ y: 150, animated: true })}
                      style={{ backgroundColor: '#4CBB1726', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '900', color: '#4CBB17' }}>Change</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontSize: 9, color: '#94A3B8', marginTop: 6 }}>Pre-selected on every new deal, on every lead. Tap the star again to clear it.</Text>
                </View>
              ) : (
                <View style={{ marginBottom: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 4 }}>MY DEFAULT PLAN</Text>
                  <Text style={{ fontSize: 11, color: '#637381', lineHeight: 15 }}>No default set. Tap the star on a plan to make it your 1 Year default for every deal.</Text>
                </View>
              )}
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
                      const isSel = resolvedKey === key;
                      const isMyDefault = key === repDefaultKey;
                      return (
                        <TouchableOpacity
                          key={key}
                          activeOpacity={0.85}
                          onPress={() => { commit('custom', key); setShowPicker(false); }}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#4CBB17' : '#E2E8F0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 9, backgroundColor: isSel ? '#4CBB170D' : '#fff' }}
                        >
                          <View style={{ flex: 1, paddingRight: 12 }}>
                            {isMyDefault && (
                              <View style={{ alignSelf: 'flex-start', backgroundColor: '#4CBB17', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6 }}>
                                <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>MY DEFAULT</Text>
                              </View>
                            )}
                            {/* The plan label already spells out the real APR (e.g.
                                "Reduced rate 6.9% APR…"), so no separate APR line —
                                the old one also printed the raw fraction (0.069%). */}
                            <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#1C252E', lineHeight: 15 }}>{planLabelOf(plans, key)}</Text>
                          </View>
                          <Text style={{ fontSize: 13, fontWeight: '900', color: '#60A5FA' }}>{m > 0 ? `${fmt(m)}/mo` : '—'}</Text>
                          {!!onSetRepDefault && (
                            <TouchableOpacity
                              onPress={() => onSetRepDefault(isMyDefault ? null : key)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={{ marginLeft: 10 }}
                            >
                              <Ionicons name={isMyDefault ? 'star' : 'star-outline'} size={20} color={isMyDefault ? '#4CBB17' : '#94A3B8'} />
                            </TouchableOpacity>
                          )}
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
