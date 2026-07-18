import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Modal, Pressable, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useTheme } from '../../../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, LinearTransition, FadeOut } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { CalculatorSchema } from '../types/calculator';
import { resolveSchemaStyle } from '../utils/icon-color';
import { formatAmountInput, stripAmount } from '../utils/format-amount';
import { MODAL_BLUR_AMOUNT, MODAL_SCRIM, MODAL_CARD_SHADOW } from './modal-chrome';
import { FlashMessage } from '../../../config/message';
import { useAuth } from '../../../hooks/useAuth';
import { SettingsService } from '../../../services/api/SettingsService';
import {
  DealPricing,
  DealPlan,
  PayCategory,
  planLabelOf,
  calcMonthly,
  withPlanFee,
  isFinancing,
  planBelowMin,
  belowMinMsg,
} from '../hooks/useDealPricing';
import {
  endPriceError as computeEndPriceError,
  effectiveCostOf as computeEffectiveCost,
  floorTier as computeFloorTier,
  computeRolloutResult,
  computeCalculatorTiers,
  screensCountFromEntries,
  markupLabel,
  WELLS_FARGO_HIGH_KEYS,
  WF_HIGH_MIN_PRICE,
} from '../utils/dynamic-rollout-pricing';
import { applyFeesToTier, type PricingConfig } from '../utils/pricing-config-util';
import { unitSuffix, labelWithSection, buildSectionLabelMap } from '../utils/item-format';

/** Resolve the payment plan shown for a calculator (saved → user default → lead-aware fallback). */
const resolveMethod = (calc: CalculatorTab, userDefault?: string, defaultMethod?: string) =>
  calc.paymentMethod || userDefault || defaultMethod || 'check';

/**
 * The **$200 job-minimum floor** applied to a tier value. The regular rollout AND
 * the web app run every COST/PAR/RETAIL tier through `calculateResultUtil`, which
 * bumps any priced job to $200 **INDEPENDENTLY per tier**, so a tiny job can read
 * $200 across all three. Gated on the calc having items (`retail > 0`).
 */
const floorTier = computeFloorTier;

/**
 * The calculator's cost with the $200 job-minimum floor applied — the value the
 * end price / drop price is validated against.
 */
function effectiveCostOf(calc: CalculatorTab): number {
  return computeEffectiveCost(calc.totals);
}

/**
 * Most-specific reason an end price is invalid (else null) — below the (floored)
 * cost, then the Wells-Fargo-high $7,500 hardcoded floor (web safety net), then
 * the selected plan's own minimum. Strings match the web app exactly. Delegates
 * to the unit-tested `dynamic-rollout-pricing` module.
 */
function endPriceError(plans: Record<string, DealPlan>, price: number, calc: CalculatorTab, method: string): string | null {
  return computeEndPriceError(plans, price, calc.totals, method);
}

interface CalculatorTab {
  id: string;
  title: string;
  entries: Record<string, any>;
  totals: { cost: number; par: number; retail: number };
  isRolloutConfirmed?: boolean;
  price?: number;
  paymentMethod?: string;
  dropPrice?: any[];
  downPayment?: number;
  discountPercentage?: number;
}

interface RolloutViewProps {
  calculators: CalculatorTab[];
  /** All configured verticals — used to label the quote-card category pills AND to
   *  recompute the COST/PAR/RETAIL tiles live from the schema field prices. */
  verticals?: CalculatorSchema[];
  /** Company pricing config (tier derivation + static fees) for the tile recompute. */
  pricingConfig?: PricingConfig | null;
  /** Backend-driven payment plans + discount config (static fallback). */
  pricing: DealPricing;
  /** Lowe's leads get the Lowe's-only plan groups + `lowes_ach` default. */
  isLowesLead?: boolean;
  onBack?: () => void;
  onConfirmRollouts?: (confirmed: Array<{ id: string; price: number }>) => void;
  onResultJob?: (calculatorId: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => void;
  /** Persist a calculator's payment plan (auto-saves like a field change). */
  onPaymentMethodChange?: (id: string, method: string) => void;
  /** Persist a calculator's drop-price list. */
  onDropChange?: (id: string, drops: any[]) => void;
  /** Persist a calculator's pre-order discount % (result-section selector). */
  onDiscountChange?: (id: string, discount: number) => void;
  /** Persist a calculator's rollout down payment. */
  onDownPaymentChange?: (id: string, downPayment: number) => void;
  /** Controlled active tab — syncs with the calculator view so switching views
   *  preserves which calculator the user was working on. */
  activeTabId?: string;
  onTabSelect?: (id: string) => void;
}

type CatStyle = { color: string; icon: string; bg: string };

// Same palette as the calculator so pills stay consistent across the flow.
const CATEGORY_STYLE_MAP: Record<string, CatStyle> = {
  gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  gutter: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  leaffilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  'leaf filter': { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  leaf: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
  fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
  lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
  additional: { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  'additional services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  miscellaneous: { color: '#637381', icon: 'ellipsis-horizontal-circle', bg: '#F4F6F8' },
};

function styleForKey(name: string, color?: string): CatStyle {
  const found = CATEGORY_STYLE_MAP[(name || '').toLowerCase()];
  if (found) return found;
  const c = color || '#637381';
  return { color: c, icon: 'pricetag', bg: color ? `${c}1A` : '#F4F6F8' };
}

/**
 * Grouped payment-plan picker — mirrors the regular rollout's picker
 * (`CalculatorSummary` line ~1541): plans bucketed under colored headers
 * (Basic Options, GreenSky Plans, Wells Fargo Plans, Wells Fargo High, Concora,
 * or the Lowe's groups). Plans below their `minPrice` for the current end price
 * are greyed out and warn instead of selecting. `getRolloutPaymentCategories`
 * is the shared source of truth for the group order/labels/colors.
 */
function PaymentPlanModal({ visible, selected, price, plans, categories, onSelect, onClose }: {
  visible: boolean; selected: string; price: number;
  plans: Record<string, DealPlan>; categories: PayCategory[];
  onSelect: (key: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '82%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#1C252E' }}>Payment Plan</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#637381" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }} showsVerticalScrollIndicator={false}>
            {categories.map((cat) => (
              <View key={cat.title || 'basic'} style={{ marginBottom: cat.title ? 16 : 8 }}>
                {!!cat.title && (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginBottom: 8, backgroundColor: cat.bg }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1.5, color: cat.text }}>{cat.title.toUpperCase()}</Text>
                  </View>
                )}
                {cat.plans.map((key) => {
                  const plan = plans[key];
                  if (!plan) return null;
                  const belowMin = planBelowMin(plans, key, price);
                  const isSel = key === selected;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        if (belowMin) { FlashMessage.warning('Payment plan', belowMinMsg(plans, key, price)); return; }
                        onSelect(key);
                      }}
                      style={{
                        padding: 14, borderRadius: 12, borderWidth: 1.5, marginBottom: 8,
                        borderColor: isSel ? '#4CBB17' : '#E2E8F0',
                        backgroundColor: isSel ? '#4CBB170D' : belowMin ? '#F1F5F9' : '#fff',
                        opacity: belowMin ? 0.6 : 1,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ flex: 1, paddingRight: 10, fontSize: 12.5, fontWeight: '800', color: isSel ? '#15803D' : '#1C252E' }}>{plan.label}</Text>
                        {isSel && <Ionicons name="checkmark-circle" size={20} color="#4CBB17" />}
                      </View>
                      {plan.minPrice && belowMin ? (
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', marginTop: 4 }}>Requires ${plan.minPrice.toLocaleString()}+</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One label/value line inside the program-comparison boxes. */
function PriceRow({ label, value, green, small }: { label: string; value: string; green?: boolean; small?: boolean }) {
  const fs = small ? 10 : 11;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: small ? 6 : 10 }}>
      <Text style={{ fontSize: fs, fontWeight: '600', color: green ? '#16a34a' : '#637381' }}>{label}</Text>
      <Text style={{ fontSize: fs, fontWeight: '900', color: green ? '#16a34a' : '#1C252E' }}>{value}</Text>
    </View>
  );
}

/**
 * The financing plans the rep can add to the drop modal's "Monthly Options" list —
 * grouped exactly like the regular rollout's Add-Plan picker (`getDropAddPlanCategories`).
 */
function DropAddPlanModal({ visible, price, plans, categories, added, onAdd, onClose }: {
  visible: boolean; price: number;
  plans: Record<string, DealPlan>; categories: PayCategory[]; added: string[];
  onAdd: (key: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 24 }} onPress={onClose}>
        <Pressable style={{ backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden', maxHeight: '70%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#F8FAFC' }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#1C252E' }}>Add Payment Plan</Text>
            <TouchableOpacity onPress={onClose} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={16} color="#919EAB" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }} showsVerticalScrollIndicator={false}>
            {categories.map((cat) => (
              <View key={cat.title || 'basic'} style={{ marginBottom: cat.title ? 12 : 6 }}>
                {!!cat.title && (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 8, alignSelf: 'flex-start', backgroundColor: cat.bg }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', color: cat.text }}>{cat.title}</Text>
                  </View>
                )}
                {cat.plans.map((key) => {
                  const plan = plans[key];
                  if (!plan) return null;
                  const belowMin = planBelowMin(plans, key, price);
                  const isAdded = added.includes(key);
                  return (
                    <TouchableOpacity
                      key={key}
                      disabled={isAdded}
                      onPress={() => {
                        if (belowMin) { FlashMessage.warning('Payment plan', belowMinMsg(plans, key, price)); return; }
                        onAdd(key);
                      }}
                      style={{ padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8, borderColor: isAdded ? '#31D076' : '#F1F5F9', backgroundColor: isAdded ? '#F0FDF4' : belowMin ? '#F1F5F9' : '#fff', opacity: belowMin ? 0.6 : 1 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ flex: 1, paddingRight: 8, fontSize: 11, fontWeight: '800', color: isAdded ? '#15803D' : '#0F172A' }}>{plan.label}</Text>
                        {isAdded && <Ionicons name="checkmark-circle" size={18} color="#31D076" />}
                      </View>
                      {plan.minPrice && belowMin ? (
                        <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8', marginTop: 2 }}>Requires ${plan.minPrice.toLocaleString()}+</Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Drop-price negotiation modal — a faithful port of the regular rollout's drop
 * modal (`CalculatorSummary` drop modal / web `DropPriceModal`): a CENTERED card
 * (not a bottom sheet) with a green check, the "UPDATED PRICE" eyebrow, the price
 * with CK/CC (or ACH/CC) method badges, an Add Down Payment → Balance block, a
 * "Monthly Options" list of financing plans (add/select/remove, each showing its
 * monthly on the balance), and **Decline** / **Secure This Price** actions. Secure
 * is disabled until a plan is selected and the down payment does not exceed the
 * drop price (web parity). Records the drop only on Secure/Decline.
 */
/**
 * Right-swipe "Delete" action for a Monthly-Options plan row (mirrors the regular
 * rollout's drop modal, `CalculatorSummary`). Extracted to a component so the
 * `useAnimatedStyle` hook lives in a real component, not a render callback.
 */
function SwipeDeleteAction({ drag, onDelete }: { drag: any; onDelete: () => void }) {
  const styleAnimation = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + 80 }],
  }));
  return (
    <View style={{ width: 80, marginLeft: 8, marginBottom: 12 }}>
      <Animated.View style={styleAnimation}>
        <TouchableOpacity
          onPress={onDelete}
          style={{ backgroundColor: '#FF5630', height: '100%', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function DropOutcomeModal({ visible, dropPrice, method, existingDrop, isLowesLead, plans, dropAddCategories, onSecure, onDecline, onClose }: {
  visible: boolean;
  dropPrice: number;
  method: string;
  /** When reopening an already-recorded drop (Display), its saved values seed the
   * modal so the previously-chosen plan / down payment are shown, not a blank form. */
  existingDrop?: any | null;
  isLowesLead: boolean;
  plans: Record<string, DealPlan>;
  dropAddCategories: PayCategory[];
  onSecure: (data: { paymentMethod: string; downPayment: number; balance: number }) => void;
  onDecline: (data: { paymentMethod: string; downPayment: number; balance: number }) => void;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const badges = isLowesLead
    ? [{ key: 'lowes_ach', label: 'ACH' }, { key: 'lowes_cc', label: 'CC' }]
    : [{ key: 'check', label: 'CK' }, { key: 'mcVisaDscvr', label: 'CC' }];

  const [selectedPlan, setSelectedPlan] = useState(method);
  const [addedPlans, setAddedPlans] = useState<string[]>(isFinancing(plans, method) ? [method] : []);
  const [downText, setDownText] = useState('');
  const [showDown, setShowDown] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Seed the modal each time it opens: from the saved drop when re-displaying an
  // existing one, otherwise from the calculator's current payment method. Without
  // this an already-secured drop reopened empty (dropped its plan + down payment).
  useEffect(() => {
    if (!visible) return;
    const savedMethod = existingDrop?.paymentMethod || method;
    const savedDown = Number(existingDrop?.downPayment) || 0;
    setSelectedPlan(savedMethod);
    setAddedPlans(isFinancing(plans, savedMethod) ? [savedMethod] : []);
    setDownText(savedDown > 0 ? String(savedDown) : '');
    setShowDown(savedDown > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, method, existingDrop]);

  const down = parseFloat(downText) || 0;
  const balance = Math.max(0, dropPrice - down);
  const downExceeds = down > dropPrice;
  const canSecure = !!selectedPlan && !downExceeds;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const addPlan = (key: string) => {
    setAddedPlans((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setSelectedPlan(key);
    setShowPicker(false);
  };
  const removePlan = (key: string) => {
    setAddedPlans((prev) => prev.filter((k) => k !== key));
    if (selectedPlan === key) setSelectedPlan(badges[0].key);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }} onPress={onClose}>
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={isDark ? 'dark' : 'light'}
            blurAmount={MODAL_BLUR_AMOUNT}
            reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
            pointerEvents="none"
          />
          <View style={MODAL_SCRIM} pointerEvents="none" />
          <Pressable style={{ backgroundColor: '#fff', borderRadius: 40, padding: 24, maxHeight: '88%', ...MODAL_CARD_SHADOW }}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Header — green check + UPDATED PRICE + price + method badges */}
              <View style={{ alignItems: 'center', marginBottom: 24 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Ionicons name="checkmark" size={24} color="#31D076" />
                </View>
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 2, marginBottom: 8 }}>UPDATED PRICE</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 34, fontWeight: '900', color: '#1C252E' }}>{fmt(dropPrice)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {badges.map((b) => {
                      const sel = selectedPlan === b.key;
                      return (
                        <TouchableOpacity key={b.key} onPress={() => setSelectedPlan(b.key)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 2, borderColor: sel ? '#31D076' : '#E2E8F0', backgroundColor: sel ? '#31D076' : '#fff' }}>
                          <Text style={{ fontSize: 11, fontWeight: '900', color: sel ? '#fff' : '#94A3B8' }}>{b.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>

              {/* Add Down Payment → Down Payment + Balance */}
              {showDown ? (
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                  <View style={{ flex: 1, backgroundColor: '#fff', borderWidth: 2, borderColor: downExceeds ? '#D32F2F' : '#0F172A', borderRadius: 16, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 }}>
                    <Text style={{ position: 'absolute', top: -8, left: 12, backgroundColor: '#fff', paddingHorizontal: 4, fontSize: 10, fontWeight: '900', color: '#0F172A' }}>Down Payment</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A', marginRight: 4 }}>$</Text>
                      <TextInput
                        style={{ flex: 1, fontSize: 16, fontWeight: '900', color: '#0F172A', padding: 0 }}
                        value={formatAmountInput(downText)}
                        onChangeText={(t) => setDownText(stripAmount(t))}
                        placeholder="0" placeholderTextColor="#94A3B8" keyboardType="numeric"
                      />
                    </View>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#F1F5F9', borderRadius: 16, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, opacity: 0.7 }}>
                    <Text style={{ position: 'absolute', top: -8, left: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 4, fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>Balance</Text>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#94A3B8' }}>${balance.toLocaleString()}</Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowDown(true)} style={{ alignSelf: 'center', marginBottom: 24, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E2E8F0', borderRadius: 16, flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="add" size={16} color="#919EAB" />
                  <Text style={{ marginLeft: 4, fontSize: 14, fontWeight: '700', color: '#919EAB' }}>Add Down Payment</Text>
                </TouchableOpacity>
              )}
              {downExceeds && <Text style={{ fontSize: 10, fontWeight: '700', color: '#D32F2F', marginTop: -14, marginBottom: 16 }}>Down payment cannot exceed the drop price.</Text>}

              <View style={{ height: 1, backgroundColor: '#F1F5F9', width: '100%', marginBottom: 20 }} />

              {/* Monthly Options — financing plans, each showing its monthly on the balance.
                  Swipe a plan LEFT to delete it (matches the regular rollout's drop modal). */}
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>Monthly Options</Text>
              <GestureHandlerRootView>
                {addedPlans.filter((k) => isFinancing(plans, k)).map((key) => {
                  const plan = plans[key] || ({} as DealPlan);
                  const sel = selectedPlan === key;
                  const monthly = calcMonthly(plans, balance, key);
                  return (
                    <Animated.View key={key} layout={LinearTransition} exiting={FadeOut}>
                      <Swipeable
                        renderRightActions={(_prog, drag) => <SwipeDeleteAction drag={drag} onDelete={() => removePlan(key)} />}
                        rightThreshold={40}
                        onSwipeableWillOpen={() => removePlan(key)}
                      >
                        <TouchableOpacity onPress={() => setSelectedPlan(key)} activeOpacity={0.9} style={{ marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 2, borderColor: sel ? '#31D076' : '#F1F5F9', backgroundColor: sel ? '#fff' : '#F8FAFC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                              <Text style={{ fontSize: 13, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8', marginRight: 6 }} numberOfLines={1}>{plan.label?.split('(')[0]?.trim() || key}</Text>
                              {sel && <View style={{ backgroundColor: '#31D076', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}><Text style={{ fontSize: 8, fontWeight: '900', color: '#fff' }}>SELECTED</Text></View>}
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                              <Text style={{ fontSize: 20, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8' }}>${Math.round(monthly).toLocaleString()}</Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginLeft: 2 }}>/mo</Text>
                            </View>
                          </View>
                          <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: sel ? '#31D076' : '#E2E8F0', backgroundColor: sel ? '#fff' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
                            {sel && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#31D076' }} />}
                          </View>
                        </TouchableOpacity>
                      </Swipeable>
                    </Animated.View>
                  );
                })}
              </GestureHandlerRootView>
              <TouchableOpacity onPress={() => setShowPicker(true)} style={{ height: 52, borderWidth: 2, borderStyle: 'dashed', borderColor: '#31D076', borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0FDF4', marginBottom: 20 }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#31D076' }}>+ Add Plan</Text>
              </TouchableOpacity>

              {/* Actions — Decline / Secure This Price */}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity onPress={() => onDecline({ paymentMethod: selectedPlan, downPayment: down, balance })} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!canSecure} onPress={() => onSecure({ paymentMethod: selectedPlan, downPayment: down, balance })} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: canSecure ? '#31D076' : '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: canSecure ? '#fff' : '#94A3B8' }}>Secure This Price</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            <DropAddPlanModal
              visible={showPicker}
              price={dropPrice}
              plans={plans}
              categories={dropAddCategories}
              added={addedPlans}
              onAdd={addPlan}
              onClose={() => setShowPicker(false)}
            />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Small "Result Job {name}" Sale/Demo chooser — mirrors the regular rollout's
 * inline chooser (`CalculatorSummary` ~L1683): a centered card with a document
 * icon, the calculator name, the most-recent price, and Sale (green) / Demo
 * (orange) / Cancel. Choosing an outcome hands off to the full Result Lead
 * (outcome) modal at the screen level.
 */
function ResultJobChooser({ visible, name, price, onSale, onDemo, onClose }: {
  visible: boolean; name: string; price: number; onSale: () => void; onDemo: () => void; onClose: () => void;
}) {
  const { isDark } = useTheme();
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }} onPress={onClose}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={isDark ? 'dark' : 'light'}
          blurAmount={MODAL_BLUR_AMOUNT}
          reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
          pointerEvents="none"
        />
        <View style={MODAL_SCRIM} pointerEvents="none" />
        <Pressable style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, ...MODAL_CARD_SHADOW }}>
          <View style={{ alignItems: 'center' }}>
            <View style={{ padding: 16, marginBottom: 24, backgroundColor: '#FFF0D9', borderRadius: 12 }}>
              <Ionicons name="document-text" size={28} color="#FF9800" />
            </View>
          </View>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#1C252E', textAlign: 'center', marginBottom: 12 }}>Result Job {name}</Text>
          <Text style={{ fontSize: 14, color: '#999999', textAlign: 'center', marginBottom: 24 }}>How Would You Like to Result this Lead?</Text>
          <View style={{ gap: 12 }}>
            <TouchableOpacity onPress={onSale} style={{ borderRadius: 8, paddingVertical: 12, backgroundColor: '#4CBB17', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Sale</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDemo} style={{ borderRadius: 8, paddingVertical: 12, backgroundColor: '#FF9800', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Demo</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onClose} style={{ borderRadius: 8, marginTop: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1C252E' }}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * "Price Declined" modal — port of web `deal-center/components/DeclinePriceModal.js`
 * (and the regular rollout's copy at `CalculatorSummary` ~L1740). Web opens this
 * the moment the drop modal closes on a decline ("keeps blur continuous, no gap
 * between modals"), offering **Result Lead** — which results the lead as a DEMO at
 * the most recent drop price — or **Exit**.
 */
function DeclinedPriceModal({ visible, declinedPrice, onResultLead, onClose }: {
  visible: boolean; declinedPrice: number; onResultLead: () => void; onClose: () => void;
}) {
  const { isDark } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }} onPress={onClose}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={isDark ? 'dark' : 'light'}
          blurAmount={10}
          reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
          pointerEvents="none"
        />
        {/* The card needs its own elevation/shadow: on a `light` blur the backdrop
            goes near-white, so an unshadowed white card melts into it and the two
            read as one surface. The regular rollout's copy uses `shadow-2xl` for
            exactly this reason. */}
        <Pressable
          style={{
            backgroundColor: '#fff',
            borderRadius: 16,
            padding: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 24,
            elevation: 12,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FDECEA', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Ionicons name="close" size={28} color="#F44336" />
            </View>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1C252E', textAlign: 'center', marginBottom: 12 }}>
            Price Declined
          </Text>
          <Text style={{ fontSize: 14, color: '#999999', textAlign: 'center', marginBottom: 24 }}>
            {`$${Math.round(declinedPrice || 0).toLocaleString()} was not accepted. What would you like to do?`}
          </Text>
          <View style={{ gap: 12 }}>
            <TouchableOpacity onPress={onResultLead} style={{ borderRadius: 8, paddingVertical: 12, backgroundColor: '#FF9800', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Result Lead</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ borderRadius: 8, paddingVertical: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#637381' }}>Exit</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PremiumQuoteCard({ calculator, initialPrice, categoryMeta, isLowesLead, pricing, verticals, pricingConfig, onPriceChange, onResult, onPaymentMethodChange, onDropChange, onDiscountChange, onDownPaymentChange }: {
  calculator: CalculatorTab; initialPrice?: number;
  categoryMeta: Record<string, { label: string; style: CatStyle }>;
  isLowesLead: boolean;
  pricing: DealPricing;
  verticals: CalculatorSchema[];
  pricingConfig?: PricingConfig | null;
  onPriceChange: (id: string, price: number) => void;
  onResult: (id: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => void;
  onPaymentMethodChange: (id: string, method: string) => void;
  onDropChange: (id: string, drops: any[]) => void;
  onDiscountChange: (id: string, discount: number) => void;
  onDownPaymentChange: (id: string, downPayment: number) => void;
}) {
  const { user, refreshUser } = useAuth();
  const [endPrice, setEndPrice] = useState(initialPrice ? String(initialPrice) : String(calculator.price || ''));
  const [focused, setFocused] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [dropText, setDropText] = useState('');
  const [showDropInput, setShowDropInput] = useState(false);
  const [downText, setDownText] = useState(calculator.downPayment ? String(calculator.downPayment) : '');
  const [showDownInput, setShowDownInput] = useState((calculator.downPayment || 0) > 0);
  // Collapsed-by-default breakdown once the rollout is locked; the chevron on the
  // Rollout End Price box toggles it (web `isRolloutExpanded`).
  const [showLockedDetails, setShowLockedDetails] = useState(false);
  // Pending drop price waiting on the Secure/Decline modal (web `DropPriceModal`).
  const [pendingDrop, setPendingDrop] = useState(0);
  const [showDropModal, setShowDropModal] = useState(false);
  // The index of the already-recorded drop being re-displayed (-1 = a brand-new
  // drop). Re-securing/declining an existing drop updates it in place instead of
  // appending a duplicate, and its saved values seed the modal.
  const [pendingDropIndex, setPendingDropIndex] = useState(-1);
  // Sale/Demo chooser (web `showResultModal`) — opened from Result Lead or after
  // securing a drop; picking an outcome opens the full Result Lead outcome modal.
  const [showChooser, setShowChooser] = useState(false);
  const [chooserPrice, setChooserPrice] = useState(0);
  // Web `ViewAllCalculators.declineModal` — null when hidden, else the declined price.
  const [declinedPrice, setDeclinedPrice] = useState<number | null>(null);
  // Down payment carried into the Result Lead modal — seeded from the drop being
  // resulted (secured/viewed) or the accepted drop, so a down payment entered in
  // the drop price flow prefills the outcome modal (web parity).
  const [chooserDown, setChooserDown] = useState(0);

  const plans = pricing.plans;
  const method = resolveMethod(calculator, user?.defaultPaymentMethod, pricing.defaultMethod);
  const isDefaultMethod = !!user?.defaultPaymentMethod && user.defaultPaymentMethod === method;
  const drops: any[] = calculator.dropPrice || [];
  const acceptedDrop = drops.find((d) => d.status === 'accepted');
  const activeMethod = acceptedDrop?.paymentMethod || method;
  const activeDownPayment = Number(acceptedDrop?.downPayment) || 0;

  // COST/PAR/RETAIL are recomputed LIVE from the entered quantities × the current
  // schema field prices (web `getCalculationResult` parity) — NOT from the stored
  // `calculator.totals`, which for a blank-tier schema (only retail priced) carried
  // par/cost = 0 and floored every tile to $200. `computeCalculatorTiers` resolves
  // each tier via the company pricing config's derivation rules (par/cost derived
  // from retail) as a PURE tier sum (this mirrors web's stored `totals`, which are
  // pre-fee — DealCenterContext `computeTotals`).
  const liveTotals = useMemo(
    () => computeCalculatorTiers(calculator.entries, verticals, pricingConfig),
    [calculator.entries, verticals, pricingConfig],
  );
  // The DISPLAYED tile then reproduces web `calculateResultUtil` EXACTLY, per tier:
  //   pure tier sum  →  applyFeesToTier (static company fee, e.g. a par-only fee)
  //   →  withPlanFee (bank-fee gross-up for the selected plan)  →  $200 floor.
  // Applying the static fee here (not inside the sum) matches web: web stores pure
  // totals and adds the tier fee only at render, so e.g. PAR shows `sum + parFee`
  // (this closed the mobile↔web PAR gap where mobile showed the raw sum).
  const tiers = useMemo(() => {
    const hasItems = liveTotals.retail > 0;
    const tierValue = (key: 'cost' | 'par' | 'retail') => {
      const withFee = applyFeesToTier(liveTotals[key], key, pricingConfig, { hasLineItems: liveTotals[key] > 0 });
      return floorTier(withPlanFee(plans, withFee, method), hasItems);
    };
    return [
      { label: 'COST', value: tierValue('cost'), isRetail: false },
      { label: 'PAR', value: tierValue('par'), isRetail: false },
      { label: 'RETAIL', value: tierValue('retail'), isRetail: true },
    ];
  }, [liveTotals, method, plans, pricingConfig]);

  const categoryChips = useMemo(() => {
    // Count of entered line items per category — the pill shows "Gutters (10)".
    // Only categories with an entered value (entries hold the full seeded field
    // list, so untouched fields must be excluded).
    const counts: Record<string, number> = {};
    const order: string[] = [];
    Object.values(calculator.entries || {}).forEach((e: any) => {
      if (e?.categoryId && e.inputValue > 0) {
        if (counts[e.categoryId] === undefined) order.push(e.categoryId);
        counts[e.categoryId] = (counts[e.categoryId] || 0) + 1;
      }
    });
    return order.map((id) => ({ id, count: counts[id] }));
  }, [calculator.entries]);

  // Entered line-items, grouped by category (mirrors the old mobile locked view).
  const itemRows = useMemo(() => {
    const rows = Object.values(calculator.entries || {}).filter((e: any) => e && e.inputValue > 0) as any[];
    return rows.sort((a, b) => String(a.categoryId).localeCompare(String(b.categoryId)));
  }, [calculator.entries]);

  // sectionId → label so item rows read "5' 5" Gutter/DS/E (All Stories)" (web parity).
  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const priceNum = parseFloat(endPrice) || 0;
  // Below-cost / below-plan-minimum / below-$200 — the full web check set.
  const priceErr = endPriceError(plans, priceNum, calculator, method);
  const finalPrice = drops.length ? drops[drops.length - 1].price : (calculator.price || priceNum);

  // ── Result-section values (mirror the regular rollout, CalculatorSummary.tsx:422-429) ──
  // Shown live once a valid end price is entered. Computed via the unit-tested
  // `computeRolloutResult`: MSRP/programs are DATA-DRIVEN from the backend discount
  // config when present (web parity — includeInMsrp sum, per-program linked
  // discounts, ≥100% clamp), else the pre-order + Sr/Vet two-program fallback.
  // Screens (`number_of_screen`) fold into End-Price-w/-Screens + MSRP; the
  // financing monthly base is endPrice − downPayment (excludes screens), per web.
  const discountPct = calculator.discountPercentage || pricing.defaultPreOrder;
  const seniorVetPct = pricing.seniorVetPct;
  const isDefaultDiscount = !!user?.defaultPercentage && user.defaultPercentage === discountPct;
  const screensCount = screensCountFromEntries(calculator.entries);
  const downPay = calculator.downPayment || 0;
  const rolloutResult = useMemo(
    () =>
      computeRolloutResult({
        endPrice: priceNum > 0 ? priceNum : tiers[2].value,
        screensCount,
        discountConfig: pricing.discountConfig,
        discountPct,
        seniorVetPct,
        downPayment: downPay,
        plan: plans[method],
      }),
    [priceNum, tiers, screensCount, pricing.discountConfig, discountPct, seniorVetPct, downPay, plans, method],
  );
  const priceWithScreens = rolloutResult.priceWithScreens;
  const msrp = rolloutResult.msrp;
  // Map the (fallback or config) programs onto the two-box layout: highlighted =
  // In-Home Pre-Order, the other = 1-Year Program.
  const inHomeProgram = rolloutResult.programs.find((p) => p.isHighlighted) || rolloutResult.programs[rolloutResult.programs.length - 1];
  const oneYearProgram = rolloutResult.programs.find((p) => !p.isHighlighted) || rolloutResult.programs[0];
  const oneYearGrandTotal = oneYearProgram?.grandTotal ?? msrp;
  const preOrderGrandTotal = inHomeProgram?.grandTotal ?? msrp;
  const srVetDiscount = msrp * (seniorVetPct / 100);
  const preOrderDiscountVal = msrp * (discountPct / 100);
  const preOrderMonthly = rolloutResult.monthly;
  // Before lock: the breakdown auto-shows as soon as a valid end price is entered.
  // After lock: it's collapsed behind the end-price box's chevron (web parity —
  // `(price>0 && !error && !confirmed) || (confirmed && isRolloutExpanded)`).
  const showResult = calculator.isRolloutConfirmed ? showLockedDetails : (priceNum > 0 && !priceErr);

  const toggleDefault = async (next: boolean) => {
    try {
      await SettingsService.updateCalculatorsSetting({ defaultPaymentMethod: next ? method : null });
      await refreshUser?.();
      FlashMessage.success(next ? 'Default payment method set' : 'Default payment method cleared');
    } catch (e: any) {
      FlashMessage.error('Could not update default', e?.message || 'Please try again.');
    }
  };

  // A confirmed rollout is a LOCKED quote: the breakdown behind the chevron is a
  // receipt, not a form. Anything that would move MSRP / the program totals is
  // read-only from here on (the end price input already is) — otherwise a rep
  // could re-price a locked calculator by tapping a Pre-Order Discount tile.
  const isLocked = !!calculator.isRolloutConfirmed;

  const toggleDefaultDiscount = async (next: boolean) => {
    if (isLocked) return;
    try {
      await SettingsService.updateCalculatorsSetting({ defaultPercentage: next ? discountPct : null });
      await refreshUser?.();
      FlashMessage.success(next ? 'Default discount set' : 'Default discount cleared');
    } catch (e: any) {
      FlashMessage.error('Could not update default discount', e?.message || 'Please try again.');
    }
  };

  const commitDownPayment = () => {
    let v = parseFloat(downText) || 0;
    // Web parity (PremiumQuoteCard `validatedDownPaymentChange`): a down payment
    // can't exceed the end price. The cap reference is `rolloutPrice || calculator.price`,
    // so it still applies when the end price was persisted but not re-typed this session.
    const cap = priceNum > 0 ? priceNum : (calculator.price || 0);
    if (cap > 0 && v > cap) {
      FlashMessage.warning('Down payment', `Down payment cannot be greater than the end price (${fmt(cap)}).`);
      v = cap;
      setDownText(String(v));
    }
    onDownPaymentChange(calculator.id, v);
  };

  const clearDownPayment = () => {
    setDownText('');
    setShowDownInput(false);
    onDownPaymentChange(calculator.id, 0);
  };

  // Validate the typed drop price (same checks as the regular rollout), then open
  // the Secure/Decline modal — the drop is only RECORDED once the rep secures or
  // declines it (web parity: entering a drop opens the negotiation modal).
  const openDrop = () => {
    const v = parseFloat(dropText) || 0;
    if (v <= 0) return;
    // Mirrors the regular rollout's drop checks: below the floored cost → exceeds
    // the rollout end price → the selected plan's own minimum (minPrice-driven,
    // web parity — a plan's minPrice, e.g. 7,500, is the single source of truth).
    // Web `handleOpenDropPrice` floors the drop at the calc's COST tier priced at its
    // OWN payment method (fee-inflated) — i.e. the displayed COST tile ($1,117) — NOT
    // the fee-free cost the end-price check uses. Reuse the COST tile value so the
    // threshold and message match web (`getCalculationResult(calc, '50', method)`).
    const cost = tiers.find((t) => t.label === 'COST')?.value ?? effectiveCostOf(calculator);
    if (v < cost) { FlashMessage.error('Invalid drop price', `Drop price must be at least the cost price (${fmt(cost)}).`); return; }
    if (priceNum > 0 && v > priceNum) { FlashMessage.error('Invalid drop price', `Drop price cannot exceed rollout end price (${fmt(priceNum)})`); return; }
    // Wells Fargo "high" $7,500 hardcoded floor (web `handleAddDrop`) — enforced
    // even if the backend plan omits minPrice.
    if (WELLS_FARGO_HIGH_KEYS.includes(method) && v < WF_HIGH_MIN_PRICE) {
      FlashMessage.error('Invalid drop price', `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`);
      return;
    }
    const planMin = plans[method]?.minPrice || 0;
    if (planMin && v < planMin) { FlashMessage.error('Invalid drop price', `This payment plan requires a minimum price of ${fmt(planMin)}.`); return; }
    setPendingDrop(v);
    setPendingDropIndex(-1); // brand-new drop
    setShowDropModal(true);
    setShowDropInput(false);
    setDropText('');
  };

  // Resolve which existing drop a Secure/Decline should EDIT in place (vs. append a
  // new one). Web parity (`handleDisplayDropAction` + `handleSecurePrice`'s
  // same-price dedup): an explicit Display index wins; otherwise a brand-new drop at a
  // price that ALREADY EXISTS updates that entry instead of appending a duplicate.
  // Match by price REGARDLESS OF STATUS (not just declined): securing the same price
  // "again and again" via + Nth Drop previously appended a fresh entry each time (the
  // existing same-price entry was accepted, so a declined-only match missed it),
  // stacking duplicate $400/$6,000 rows that then flooded the admin drops table. A
  // drop price is a single negotiated number — two entries at the identical price are
  // never meaningful — so only a genuinely-NEW price appends.
  const resolveDropTargetIndex = () =>
    pendingDropIndex >= 0
      ? pendingDropIndex
      : drops.findIndex((d) => Number(d.price ?? d.dropedPrice) === pendingDrop);

  // Secure the pending drop → record it accepted (single-accepted: demote any
  // previously-accepted drop to declined, matching web `handleSecurePrice`), then
  // open the Result Lead outcome modal carrying the drop price.
  const secureDrop = (data: { paymentMethod: string; downPayment: number; balance: number }) => {
    // Web drop shape (ViewAllCalculators.js:797) carries `dropedPrice`, `status`,
    // `paymentMethod`, `pricemarkup` (the markup label), `downPayment`, `balance`.
    const pricemarkup = markupLabel(pendingDrop, calculator.totals);
    const targetIndex = resolveDropTargetIndex();
    const accepted = { price: pendingDrop, dropedPrice: pendingDrop, status: 'accepted', pricemarkup, ...data };
    // Edit in place (preserving any existing `_id`, web `...item`) when targeting an
    // existing drop; demote every OTHER accepted drop (single-accepted rule).
    const next = drops.map((d, idx) => {
      if (idx === targetIndex) return { ...d, ...accepted };
      return d.status === 'accepted' ? { ...d, status: 'declined' } : d;
    });
    if (targetIndex < 0) next.push(accepted); // genuinely-new price → append
    onDropChange(calculator.id, next);
    setShowDropModal(false);
    setShowDropInput(false);
    setPendingDropIndex(-1);
    // Web parity: securing a drop opens the Sale/Demo chooser (→ outcome modal).
    setChooserPrice(pendingDrop);
    setChooserDown(Number(data.downPayment) || 0);
    setShowChooser(true);
  };

  // Decline the pending drop → record it declined (web shows a "Price Declined"
  // confirmation; the drop then lists as Declined and Result Lead stays available).
  const declineDrop = (data: { paymentMethod: string; downPayment: number; balance: number }) => {
    const pricemarkup = markupLabel(pendingDrop, calculator.totals);
    const targetIndex = resolveDropTargetIndex();
    const declined = { price: pendingDrop, dropedPrice: pendingDrop, status: 'declined', pricemarkup, ...data };
    // Edit the existing entry in place (preserving `_id`) or append a new declined
    // one; declining never demotes other drops (only Secure enforces single-accepted).
    const next = targetIndex >= 0
      ? drops.map((d, idx) => (idx === targetIndex ? { ...d, ...declined } : d))
      : [...drops, declined];
    onDropChange(calculator.id, next);
    setShowDropModal(false);
    setShowDropInput(false);
    setPendingDropIndex(-1);
    // Web `handleDropDecline`: "Open DeclinePriceModal immediately — keeps blur
    // continuous, no gap between modals". Replaces the mobile-only toast; neither
    // web nor the regular rollout shows one, they show this modal.
    setDeclinedPrice(pendingDrop);
  };

  // Web `handleDeclineResultLead`: close the modal and result the lead as a DEMO at
  // the MOST RECENT drop price (falling back to the rollout end price when there are
  // no drops) — it does NOT go through the Sale/Demo chooser.
  const declineResultLead = () => {
    setDeclinedPrice(null);
    const lastDrop = drops.length
      ? Number(drops[drops.length - 1]?.price ?? drops[drops.length - 1]?.dropedPrice) || 0
      : Number(calculator.price) || 0;
    onResult(calculator.id, 'demo', lastDrop, activeMethod, activeDownPayment);
  };

  // Shared payment-method block (heading follows it, matching the regular rollout:
  // name → payment method → items → cost/par/retail → end price → actions).
  const paymentMethodBlock = (
    <View style={{ marginHorizontal: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, marginBottom: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: '#212B36' }}>Payment Method</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 12, color: '#637381' }}>Set as Default</Text>
          <TouchableOpacity
            onPress={() => toggleDefault(!isDefaultMethod)}
            style={{ width: 32, height: 20, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 4, backgroundColor: isDefaultMethod ? '#22C55E' : '#CBD5E1', alignItems: isDefaultMethod ? 'flex-end' : 'flex-start' }}
          >
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' }} />
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => setShowPlanPicker(true)}
        style={{ minHeight: 56, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DFE3E8', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <View style={{ flex: 1, paddingRight: 16 }}>
          <Text style={{ fontSize: 8, fontWeight: '900', color: '#637381', letterSpacing: 1.5, marginBottom: 2, textTransform: 'uppercase' }}>{pricing.categories.find((c) => c.plans.includes(method))?.title || 'BASIC'}</Text>
          <Text style={{ fontSize: 14, fontWeight: '900', color: '#212B36' }}>{planLabelOf(plans, method)}</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color="#637381" />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      {/* ── Main card ── */}
      <View style={{ backgroundColor: '#fff', borderWidth: 2, borderColor: calculator.isRolloutConfirmed ? '#16A34A' : '#DFE3E8', borderRadius: 24, paddingBottom: 16 }}>
        {/* 1. Heading — calculator name + confirmed/required badge (old UI parity) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 }}>
          {/* Web `QuoteResultCard.js:153-165` renders the calculator title at
              fontWeight 800 — mobile had it at 600, so it read as normal text. */}
          <Text style={{ fontSize: 14, fontWeight: '900', color: '#212B36', flex: 1 }}>{calculator.title}</Text>
          {calculator.isRolloutConfirmed ? (
            <View style={{ backgroundColor: '#16A34A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="lock-closed" size={10} color="#fff" />
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#fff', marginLeft: 4 }}>Confirmed</Text>
            </View>
          ) : !calculator.price ? (
            <View style={{ backgroundColor: '#FF990F', paddingHorizontal: 4, paddingVertical: 4, borderRadius: 6 }}>
              <Text style={{ fontSize: 10, fontWeight: '600', color: '#fff' }}>Required</Text>
            </View>
          ) : null}
        </View>

        {/* 2. Payment Method selector + Set-as-Default toggle */}
        {paymentMethodBlock}

        {/* 3. Category pills */}
        {categoryChips.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
            {categoryChips.map(({ id: catId, count }) => {
              const meta = categoryMeta[catId] || { label: catId, style: styleForKey(catId) };
              return (
                <View key={catId} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: meta.style.bg }}>
                  <Ionicons name={meta.style.icon} size={11} color={meta.style.color} style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, fontWeight: '900', color: meta.style.color }}>{meta.label} ({count})</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* 3. Item rows */}
        {itemRows.map((item, i) => {
          const meta = categoryMeta[item.categoryId] || { label: item.categoryId, style: styleForKey(item.categoryId) };
          return (
            <View key={item.fieldId || i}>
              <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: meta.style.bg, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                  <Ionicons name={meta.style.icon} size={18} color={meta.style.color} />
                </View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C252E', flex: 1 }}>
                  <Text style={{ fontWeight: '900' }}>{item.inputValue}{unitSuffix(item)}</Text>{'  '}{labelWithSection(item.label, item.sectionId, sectionLabelMap)}
                </Text>
              </View>
            </View>
          );
        })}
        {itemRows.length > 0 && <View style={{ height: 1, backgroundColor: '#F1F5F9', marginTop: 8, marginBottom: 14 }} />}

        {/* 4. COST / PAR / RETAIL tiles */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 14 }}>
          {tiers.map((tier) => (
            <View key={tier.label} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: tier.isRetail ? 1.5 : 1, borderColor: tier.isRetail ? '#16A34A' : '#DFE3E8', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4, color: '#94A3B8', textTransform: 'uppercase' }}>{tier.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: tier.isRetail ? '#16A34A' : '#212B36' }}>{fmt(tier.value)}</Text>
            </View>
          ))}
        </View>

        {/* 5. Rollout End Price — old UI style */}
        <View style={{ marginHorizontal: 14, marginBottom: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: calculator.isRolloutConfirmed ? '#16A34A' : '#F59E0B', marginBottom: 8, marginLeft: 4, letterSpacing: 1 }}>ROLLOUT END PRICE</Text>
          {calculator.isRolloutConfirmed ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setShowLockedDetails((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderWidth: 2, borderColor: '#16A34A', borderRadius: 16, paddingHorizontal: 16, height: 64, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#16A34A' }}>
                  {(calculator.price ?? 0) > 0 ? fmt(calculator.price ?? 0) : '—'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(22,163,74,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(22,163,74,0.2)' }}>
                  <Ionicons name="lock-closed" size={12} color="#16A34A" />
                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#16A34A', marginLeft: 6, letterSpacing: 0.5 }}>LOCKED</Text>
                </View>
                <Ionicons name={showLockedDetails ? 'chevron-up' : 'chevron-down'} size={16} color="#16A34A" />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 2, borderColor: priceErr ? '#EF4444' : focused ? '#16A34A' : '#DFE3E8', borderRadius: 16, paddingHorizontal: 16, height: 64, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: focused ? '#16A34A' : '#637381', marginRight: 8, lineHeight: 20 }}>$</Text>
              <TextInput
                style={{ flex: 1, fontSize: 16, fontWeight: '900', color: focused ? '#16A34A' : '#212B36', padding: 0, margin: 0, height: '100%', lineHeight: 20, textAlignVertical: 'center' }}
                value={endPrice}
                onChangeText={(t) => { const c = t.replace(/[^0-9.]/g, ''); setEndPrice(c); onPriceChange(calculator.id, parseFloat(c) || 0); }}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                placeholder="Enter End Price" placeholderTextColor="#919EAB" keyboardType="numeric"
              />
            </View>
          )}
          {/* Only the validation error renders under the end price. Web shows NO
              caption here — the green "RETAIL + X%" markup line was mobile-only. */}
          {!!priceErr && (
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#EF4444', marginTop: 8, marginLeft: 4 }}>{priceErr}</Text>
          )}
        </View>

        {/* 5b. Result breakdown */}
        {showResult && (
          <View style={{ marginHorizontal: 14, marginTop: 16 }}>
            <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
              <View style={{ flex: 1, paddingVertical: 18, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', marginBottom: 6, textAlign: 'center' }}>End Price w/ Screens</Text>
                <Text style={{ fontSize: 22, fontWeight: '900', color: '#15803D' }}>{fmt(priceWithScreens)}</Text>
              </View>
              <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8' }}>Pre Order{'\n'}Discount</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 8, fontWeight: '700', color: '#94A3B8', marginRight: 6 }}>Default</Text>
                    <TouchableOpacity
                      disabled={isLocked}
                      onPress={() => toggleDefaultDiscount(!isDefaultDiscount)}
                      style={{ width: 32, height: 20, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 4, backgroundColor: isDefaultDiscount ? '#22C55E' : '#CBD5E1', alignItems: isDefaultDiscount ? 'flex-end' : 'flex-start', opacity: isLocked ? 0.5 : 1 }}
                    >
                      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' }} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {pricing.preOrderOptions.map((d) => {
                    const active = discountPct === d;
                    return (
                      <TouchableOpacity
                        key={d}
                        disabled={isLocked}
                        onPress={() => onDiscountChange(calculator.id, d)}
                        // Locked: the chosen % still reads clearly, the rest fade
                        // out so the row presents as a record, not a choice.
                        style={{ flex: 1, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? '#4CBB17' : '#E2E8F0', backgroundColor: active ? '#4CBB170D' : '#fff', opacity: isLocked && !active ? 0.4 : 1 }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '900', color: active ? '#15803D' : '#94A3B8' }}>{d}%</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={{ borderWidth: 1, borderColor: '#919EAB33', borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1.5, color: '#1C252E', marginBottom: 2 }}>MSRP</Text>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#4CAF50' }}>{fmt(msrp)}</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16, padding: 14 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: '#1C252E', marginBottom: 16 }}>1 Year Program</Text>
                <PriceRow label="Total" value={fmt(msrp)} />
                <PriceRow label={`${seniorVetPct}% Sr + Vet`} value={`-${fmt(srVetDiscount)}`} green />
                <View style={{ height: 1, backgroundColor: '#E2E8F0', marginVertical: 10 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#94A3B8' }}>Grand Total</Text>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: '#1C252E' }}>{fmt(oneYearGrandTotal)}</Text>
                </View>
              </View>

              <View style={{ flex: 1, borderWidth: 1.5, borderColor: '#4CBB17', borderRadius: 16, overflow: 'hidden' }}>
                <View style={{ backgroundColor: '#4CBB17', paddingVertical: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>In Home Pre Order</Text>
                </View>
                <View style={{ padding: 12 }}>
                  <PriceRow label="Total" value={fmt(msrp)} small />
                  <PriceRow label={`${seniorVetPct}% Sr + Vet`} value={`-${fmt(srVetDiscount)}`} green small />
                  <PriceRow label={`${discountPct}% Discount`} value={`-${fmt(preOrderDiscountVal)}`} green small />
                  <View style={{ height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>Grand total</Text>
                    <Text style={{ fontSize: 14, fontWeight: '900', color: '#15803D' }}>{fmt(preOrderGrandTotal)}</Text>
                  </View>

                  {showDownInput ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 10, marginBottom: 10, height: 36 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#94A3B8', marginRight: 4, lineHeight: 14 }}>$</Text>
                      <TextInput
                        style={{ flex: 1, fontSize: 11, fontWeight: '900', color: '#1C252E', padding: 0, margin: 0, height: '100%', lineHeight: 14, textAlignVertical: 'center' }}
                        value={formatAmountInput(downText)}
                        onChangeText={(t) => setDownText(stripAmount(t))}
                        onEndEditing={commitDownPayment}
                        onBlur={commitDownPayment}
                        placeholder="Down Payment"
                        placeholderTextColor="#94A3B8"
                        keyboardType="numeric"
                      />
                      {downPay > 0 && (
                        <TouchableOpacity onPress={clearDownPayment} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={16} color="#FF5630" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setShowDownInput(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2196F3', backgroundColor: '#2196F30D', borderRadius: 10, paddingVertical: 8, marginBottom: 10 }}>
                      <Ionicons name="add" size={13} color="#2196F3" />
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#2196F3' }}>{downPay > 0 ? `Down Payment: ${fmt(downPay)}` : 'Add Down Payment'}</Text>
                    </TouchableOpacity>
                  )}
                  {downPay > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: '#16a34a' }}>Down Payment</Text>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: '#16a34a' }}>-{fmt(downPay)}</Text>
                    </View>
                  )}

                  {preOrderMonthly > 0 && (
                    <View style={{ alignItems: 'center', marginTop: 4 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#60A5FA', marginBottom: 2 }}>{fmt(preOrderMonthly)}/mo</Text>
                      <Text style={{ fontSize: 8, color: '#94A3B8', textAlign: 'center' }} numberOfLines={2}>{planLabelOf(plans, method)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* ── Outside card: Installers Check + Drops + Actions (old UI parity) ── */}
      {calculator.isRolloutConfirmed && (
        <View style={{ marginTop: 16, marginBottom: 24 }}>
          {/* Installers Check bar */}
          <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1C252E' }}>Check to installers (screens)</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#16A34A' }}>{fmt(screensCount * 75)}</Text>
          </View>

          {/* Drops list with old-UI View/Unselect/Display */}
          {drops.map((d, i) => {
            const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][i] || `${i + 1}th`;
            const declined = d.status === 'declined';
            const secured = !declined;
            const dp = d.price ?? d.dropedPrice ?? 0;
            return (
              <View key={i} style={{ marginBottom: 24 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* Web parity (QuoteResultCard): the "Nth Dropped Price" label is
                        green ONLY for the secured drop; locked/declined drops use the
                        muted secondary gray (web `isSecured ? '#2e7d32' : text.secondary`).
                        Was hardcoded green for every row. */}
                    <Text style={{ fontSize: 11, fontWeight: '900', color: secured ? '#16A34A' : '#64748B', marginRight: 8, letterSpacing: -0.3 }}>{ordinal} Dropped Price</Text>
                    {secured && (
                      <View style={{ backgroundColor: '#16A34A', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff' }}>✓ SECURED</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    {!declined && (
                      <TouchableOpacity onPress={() => { setChooserPrice(dp); setChooserDown(Number(d.downPayment) || 0); setShowChooser(true); }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: secured ? '#16A34A' : '#64748B' }}>View</Text>
                      </TouchableOpacity>
                    )}
                    {secured && (
                      <TouchableOpacity onPress={() => onDropChange(calculator.id, drops.filter((_, idx) => idx !== i))}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#F97316' }}>Unselect</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <View style={{ backgroundColor: '#fff', borderWidth: 2, borderColor: secured ? '#22C55E' : '#E2E8F0', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: secured ? '#16A34A' : '#94A3B8' }}>{fmt(dp)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    <TouchableOpacity
                      onPress={() => {
                        // Display action — in old UI opens the drop modal for re-negotiation,
                        // seeded with this drop's saved plan + down payment (index i).
                        setPendingDrop(dp);
                        setPendingDropIndex(i);
                        setShowDropModal(true);
                      }}
                      style={{ paddingHorizontal: 24, paddingVertical: 8, borderRadius: 8, backgroundColor: secured ? '#22C55E' : '#E2E8F0' }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '900', color: secured ? '#fff' : '#64748B' }}>Display</Text>
                    </TouchableOpacity>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: secured ? '#16A34A' : '#94A3B8' }}>{secured ? 'SECURED' : 'LOCKED'}</Text>
                  </View>
                </View>
              </View>
            );
          })}

          {/* Inline drop input */}
          {showDropInput && (
            <View style={{ marginBottom: 16 }}>
              <View style={{ backgroundColor: '#F4F6F8', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 16, height: 56, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#94A3B8', marginRight: 8 }}>$</Text>
                <TextInput
                  style={{ flex: 1, fontSize: 14, fontWeight: '800', color: '#1C252E' }}
                  // State stays the raw digits (openDrop parseFloats it); only the
                  // display is comma-grouped.
                  value={formatAmountInput(dropText)}
                  onChangeText={(t) => setDropText(stripAmount(t))}
                  onSubmitEditing={openDrop}
                  // iOS's numeric pad has NO return key, so `onSubmitEditing` never
                  // fires there and focusing out dropped the typed price on the
                  // floor; Android's numeric IME has a submit action, hence the
                  // platform split. The regular rollout (`CalculatorSummary`) already
                  // runs the same commit from both handlers. `openDrop` no-ops on an
                  // empty/zero value, so a blur with nothing typed does nothing.
                  onBlur={Platform.OS === 'ios' ? openDrop : undefined}
                  placeholder="Enter price..."
                  placeholderTextColor="#919EAB"
                  keyboardType="numeric"
                  autoFocus
                />
              </View>
            </View>
          )}

          {/* Drop + Result Lead buttons */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                if (showDropInput) {
                  openDrop();
                } else {
                  setDropText('');
                  setShowDropInput(true);
                }
              }}
              style={{ flex: 1, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#1976D2', backgroundColor: '#fff' }}
            >
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#1976D2' }}>
                {`+ ${['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][drops.length] || `${drops.length + 1}th`} Drop`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setChooserPrice(finalPrice); setChooserDown(activeDownPayment); setShowChooser(true); }}
              style={{ flex: 1, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#F97316', backgroundColor: '#fff' }}
            >
              <Ionicons name="document-text-outline" size={16} color="#EA580C" style={{ marginBottom: 2 }} />
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#EA580C', marginBottom: 1 }}>Result Lead</Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#EA580C' }}>
                {finalPrice > 0 ? fmt(finalPrice) : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <PaymentPlanModal
        visible={showPlanPicker}
        selected={method}
        price={priceNum}
        plans={plans}
        categories={pricing.categories}
        onSelect={(key) => { onPaymentMethodChange(calculator.id, key); setShowPlanPicker(false); }}
        onClose={() => setShowPlanPicker(false)}
      />

      <DropOutcomeModal
        visible={showDropModal}
        dropPrice={pendingDrop}
        method={method}
        existingDrop={pendingDropIndex >= 0 ? drops[pendingDropIndex] : null}
        isLowesLead={isLowesLead}
        plans={plans}
        dropAddCategories={pricing.dropAddCategories}
        onSecure={secureDrop}
        onDecline={declineDrop}
        onClose={() => { setShowDropModal(false); setPendingDropIndex(-1); }}
      />

      <ResultJobChooser
        visible={showChooser}
        name={calculator.title}
        price={chooserPrice}
        onSale={() => { setShowChooser(false); onResult(calculator.id, 'sale', chooserPrice, activeMethod, chooserDown); }}
        onDemo={() => { setShowChooser(false); onResult(calculator.id, 'demo', chooserPrice, activeMethod, chooserDown); }}
        onClose={() => setShowChooser(false)}
      />

      <DeclinedPriceModal
        visible={declinedPrice !== null}
        declinedPrice={declinedPrice || 0}
        onResultLead={declineResultLead}
        onClose={() => setDeclinedPrice(null)}
      />
    </>
  );
}

export function RolloutView({ calculators, verticals, pricingConfig, pricing, isLowesLead = false, onBack, onConfirmRollouts, onResultJob, onPaymentMethodChange, onDropChange, onDiscountChange, onDownPaymentChange, activeTabId, onTabSelect }: RolloutViewProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Effective end price for a calculator: the freshly-entered value, else the
  // one already persisted on the tab (e.g. from a duplicated calculator).
  const effectivePrice = (c: CalculatorTab) => prices[c.id] ?? c.price ?? 0;
  // Web parity (`ViewAllCalculators.visibleCalculators`): a calculator whose title
  // is still a bare number is empty (no entries → derived name is just its
  // position) and must NOT appear in the rollout — only real, named calculators
  // can be priced/confirmed.
  const visibleCalculators = useMemo(
    () => calculators.filter((c) => !/^\d+$/.test((c.title || '').trim())),
    [calculators]
  );
  const allConfirmed = visibleCalculators.length > 0 && visibleCalculators.every((c) => c.isRolloutConfirmed);
  const allHavePrices = visibleCalculators.length > 0 && visibleCalculators.every((c) => effectivePrice(c) > 0);
  // Progress tracks calculators with an END PRICE ENTERED (web `ConfirmRolloutPrices`
  // counts `price > 0`, not confirmations), so the bar fills as the rep prices each
  // calculator — instead of sitting at 0% until everything is confirmed at the end.
  const enteredCount = visibleCalculators.filter((c) => effectivePrice(c) > 0).length;
  const progress = visibleCalculators.length > 0 ? (enteredCount / visibleCalculators.length) * 100 : 0;
  const selectedCalc = visibleCalculators.find((c) => c.id === activeTabId) || visibleCalculators[0];

  // Web parity (ViewAllCalculators): auto-confirm after 10 minutes of inactivity.
  // Track the last time each calculator's price or payment method was changed.
  const AUTO_CONFIRM_DELAY = 600000; // 10 min
  const rolloutLastChangedRef = useRef<Record<string, number>>({});
  const onConfirmRolloutsRef = useRef(onConfirmRollouts);
  onConfirmRolloutsRef.current = onConfirmRollouts;

  const checkAndAutoConfirm = useCallback(async (calc: CalculatorTab) => {
    if (calc.isRolloutConfirmed) return;
    if (/^\d+$/.test((calc.title || '').trim())) return; // empty calc
    const enteredPrice = prices[calc.id] ?? calc.price ?? 0;
    if (enteredPrice <= 0) return;
    const lastChanged = rolloutLastChangedRef.current[calc.id];
    if (!lastChanged) return;
    const elapsed = Date.now() - lastChanged;
    if (elapsed < AUTO_CONFIRM_DELAY) return;
    const method = resolveMethod(calc, user?.defaultPaymentMethod, pricing.defaultMethod);
    const err = endPriceError(pricing.plans, enteredPrice, calc, method);
    if (err) return;
    onConfirmRolloutsRef.current?.([{ id: calc.id, price: enteredPrice }]);
  }, [prices, pricing, user]);

  // Check on mount and every 30 seconds (web parity: mount + polling interval).
  useEffect(() => {
    if (selectedCalc) checkAndAutoConfirm(selectedCalc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visibleCalculators.length) return;
    const interval = setInterval(() => {
      visibleCalculators.forEach((calc) => checkAndAutoConfirm(calc));
    }, 30000);
    return () => clearInterval(interval);
  }, [visibleCalculators, checkAndAutoConfirm]);

  // Map categoryId -> { label, style } across all verticals so quote-card pills
  // and item rows read nicely. Icon/color are schema-driven (Iconify → Ionicons).
  const categoryMeta = useMemo(() => {
    const map: Record<string, { label: string; style: CatStyle }> = {};
    (verticals || []).forEach((v) => (v.categories || []).forEach((cat) => {
      const named = CATEGORY_STYLE_MAP[(cat.name || '').toLowerCase()] || CATEGORY_STYLE_MAP[(cat.label || '').toLowerCase()];
      map[cat.id] = { label: cat.label, style: resolveSchemaStyle({ icon: cat.icon, color: cat.color }, named) };
    }));
    return map;
  }, [verticals]);

  // Tab-scroll state for progressive fade overlays (old UI parity)
  const [scrollOffset, setScrollOffset] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const summaryTabsScrollViewRef = useRef<ScrollView>(null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 24}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#DFE3E8', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={onBack} style={{ padding: 8, marginRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DFE3E8', borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
          <Ionicons name="arrow-back" size={18} color="#212B36" />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 40 }}>
          <View style={{ flex: 1, position: 'relative', flexDirection: 'row', alignItems: 'center', height: '100%' }}>
            <ScrollView
              ref={summaryTabsScrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              scrollEventThrottle={16}
              onScroll={(e) => setScrollOffset(e.nativeEvent.contentOffset.x)}
              onContentSizeChange={(w) => setContentWidth(w)}
              onLayout={(e) => setScrollViewWidth(e.nativeEvent.layout.width)}
            >
              {visibleCalculators.map((calc) => {
                const isActive = calc.id === selectedCalc?.id;
                const hasLockedDrop = (calc.dropPrice || []).some((d: any) => d.status === 'accepted');
                return (
                  <TouchableOpacity key={calc.id} onPress={() => onTabSelect?.(calc.id)} style={{ flexDirection: 'row', alignItems: 'center', height: '100%', paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: isActive ? '#16A34A' : 'transparent' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {hasLockedDrop && (
                        <Ionicons name="lock-closed" size={12} color={isActive ? '#16A34A' : '#94A3B8'} style={{ marginRight: 6 }} />
                      )}
                      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '900', color: isActive ? '#212B36' : '#637381' }}>{calc.title}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Left progressive fade overlay */}
            {scrollOffset > 5 && (
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' }} pointerEvents="none">
                {[1.0, 0.8, 0.6, 0.4, 0.2, 0.08].map((opacity, idx) => (
                  <View key={`lb-${idx}`} style={{ width: 4, height: '100%', backgroundColor: `rgba(255,255,255,${opacity})` }} />
                ))}
              </View>
            )}

            {/* Right progressive fade overlay */}
            {scrollOffset + scrollViewWidth < contentWidth - 5 && (
              <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' }} pointerEvents="none">
                {[0.08, 0.2, 0.4, 0.6, 0.8, 1.0].map((opacity, idx) => (
                  <View key={`rb-${idx}`} style={{ width: 4, height: '100%', backgroundColor: `rgba(255,255,255,${opacity})` }} />
                ))}
              </View>
            )}
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ maxWidth: 600, alignSelf: 'center', width: '100%' }}>
          {selectedCalc ? (
            <PremiumQuoteCard key={selectedCalc.id} calculator={selectedCalc}
              initialPrice={effectivePrice(selectedCalc)}
              categoryMeta={categoryMeta}
              isLowesLead={isLowesLead}
              pricing={pricing}
              verticals={verticals || []}
              pricingConfig={pricingConfig}
              onPriceChange={(id, price) => {
                setPrices((p) => ({ ...p, [id]: price }));
                rolloutLastChangedRef.current = { ...rolloutLastChangedRef.current, [id]: Date.now() };
              }}
              onResult={(id, result, price, paymentMethod, downPayment) => onResultJob?.(id, result, price, paymentMethod, downPayment)}
              onPaymentMethodChange={(id, m) => {
                onPaymentMethodChange?.(id, m);
                rolloutLastChangedRef.current = { ...rolloutLastChangedRef.current, [id]: Date.now() };
              }}
              onDropChange={(id, drops) => onDropChange?.(id, drops)}
              onDiscountChange={(id, d) => onDiscountChange?.(id, d)}
              onDownPaymentChange={(id, dp) => onDownPaymentChange?.(id, dp)} />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 80 }}>
              <Ionicons name="cube-outline" size={44} color="#CBD5E1" />
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#637381', marginTop: 12, marginBottom: 8 }}>No Calculators</Text>
              <Text style={{ fontSize: 14, color: '#94A3B8' }}>Add calculators to see pricing</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {visibleCalculators.length > 0 && !allConfirmed && (
        <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 16 }}>
          <View style={{ maxWidth: 1200, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 24 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#637381' }}>{enteredCount} of {visibleCalculators.length} entered</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#637381' }}>{Math.round(progress)}%</Text>
              </View>
              <View style={{ height: 6, backgroundColor: 'rgba(145,158,171,0.1)', borderRadius: 12, overflow: 'hidden' }}>
                <View style={{ height: '100%', backgroundColor: allHavePrices ? '#4CBB17' : '#2169f3', borderRadius: 12, width: `${progress}%` }} />
              </View>
            </View>
            <TouchableOpacity onPress={() => {
              const pending = visibleCalculators.filter((c) => !c.isRolloutConfirmed);
              // Web parity: every calculator needs a price (> 0) that clears its
              // floored cost, the payment plan's minimum, and the Wells-Fargo-high
              // minimum — the same checks the card enforces inline.
              const missing = pending.find((c) => effectivePrice(c) <= 0);
              if (missing) {
                FlashMessage.error('Missing Price', `Enter an end price for “${missing.title}”.`);
                return;
              }
              for (const c of pending) {
                const err = endPriceError(pricing.plans, effectivePrice(c), c, resolveMethod(c, user?.defaultPaymentMethod, pricing.defaultMethod));
                if (err) {
                  FlashMessage.error('Price too low', `“${c.title}”: ${err}`);
                  return;
                }
              }
              const confirmed = pending.map((c) => ({ id: c.id, price: effectivePrice(c) }));
              onConfirmRollouts?.(confirmed);
            }} disabled={!allHavePrices} style={{ minWidth: 200, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: allHavePrices ? '#4CBB17' : 'rgba(145,158,171,0.12)' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', textAlign: 'center', color: allHavePrices ? '#fff' : 'rgba(145,158,171,0.4)' }}>Confirm Rollouts</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
