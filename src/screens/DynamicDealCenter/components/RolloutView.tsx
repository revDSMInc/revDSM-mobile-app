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
import { describeFullPackage } from '../utils/tab-naming';
import { autoSecureLastDrop, dropPriceOf } from '../utils/drop-prices';
import { FullPackageTitle, FullPackageInfoModal, FullPackageInfoOverlay, type PackageAnchorRect } from './FullPackageBadge';
import { FlashMessage } from '../../../config/message';
import { allRolloutsConfirmed, rolloutCalculators } from '../../../utils/rollout-status';
import { useAuth } from '../../../hooks/useAuth';
import { useBottomInset } from '../../../hooks/useBottomInset';
import { useNumPadScrollIntoView } from '../../../hooks/useNumPadScrollIntoView';
import {
  DealPricing,
  DealPlan,
  PayCategory,
  planLabelOf,
  planProviderAbbr,
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
  computeLogTiers,
  screensCountFromEntries,
  screenUnitPriceFromSchemas,
  markupLabel,
  WELLS_FARGO_HIGH_KEYS,
  WF_HIGH_MIN_PRICE,
} from '../utils/dynamic-rollout-pricing';
import { applyFeesToTier, type PricingConfig } from '../utils/pricing-config-util';
import { logRolloutChange, logPreOrderDiscount } from '../../../utils/activity-log/rollout-log-meta';
import { unitSuffix, labelWithSection, buildSectionLabelMap } from '../utils/item-format';
import { RevRenderSlots, type RenderPair } from './RevRenderSlots';
import { PhotoPeekScrollLockProvider } from '../../../widgets/common/PhotoPeekScrollLock';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { OneYearMonthlyPlan, type OneYearMonthlyValue } from './OneYearMonthlyPlan';
import { resolveRepOneYearKey, resolveOneYearDefaultKey } from '../../../utils/one-year-default';
import { scopeSignature } from '../utils/scope-signature';
import type { CalculatorLockState } from '../utils/job-builder-submission';
import { NUMERIC_KEYBOARD, NUMERIC_KEYBOARD_HAS_RETURN_KEY } from '../../../utils/keyboard-type';
import {
  flushCalculatorSettings,
  queueCalculatorSetting,
} from '../../../services/offlineSettings';
import type { CalculatorSettingsPatch } from '../../../utils/offline-settings';

const resolveMethod = (calc: CalculatorTab, userDefault?: string, defaultMethod?: string) =>
  calc.paymentMethod || userDefault || defaultMethod || 'check';

const floorTier = computeFloorTier;

function effectiveCostOf(calc: CalculatorTab): number {
  return computeEffectiveCost(calc.totals);
}

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
  priceScopeSig?: string;
  paymentMethod?: string;
  dropPrice?: any[];
  downPayment?: number;
  discountPercentage?: number;
  selectedRenders?: any[];
  oneYearMonthlyPlan?: OneYearMonthlyValue;
}

interface RolloutViewProps {
  calculators: CalculatorTab[];
  verticals?: CalculatorSchema[];
  pricingConfig?: PricingConfig | null;
  pricing: DealPricing;
  isLowesLead?: boolean;
  isRehashed?: boolean;
  leadId?: string;
  appointmentId?: string;
  onBack?: () => void;
  onConfirmRollouts?: (confirmed: Array<{ id: string; price: number; pricemarkup?: string }>) => void;
  onResultJob?: (calculatorId: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => void;
  onPriceCommit?: (id: string, price: number, pricemarkup?: string) => void;
  onDismissScopeWarning?: (id: string) => void;
  onPaymentMethodChange?: (id: string, method: string) => void;
  onDropChange?: (id: string, drops: any[]) => void;
  onDiscountChange?: (id: string, discount: number) => void;
  onDownPaymentChange?: (id: string, downPayment: number) => void;
  onRendersChange?: (id: string, renders: any[]) => void;
  onOneYearMonthlyChange?: (id: string, plan: OneYearMonthlyValue) => void;
  onRolloutsConfirmedDone?: () => void;
  activeTabId?: string;
  onTabSelect?: (id: string) => void;
  submittedCalculatorId?: string | null;
  onResetJobBuilder?: () => void;
}

type CatStyle = { color: string; icon: string; bg: string };

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

function PaymentPlanModal({ visible, selected, price, plans, categories, onSelect, onClose }: {
  visible: boolean; selected: string; price: number;
  plans: Record<string, DealPlan>; categories: PayCategory[];
  onSelect: (key: string) => void; onClose: () => void;
}) {
  const bottomInset = useBottomInset();
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
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 14 + bottomInset }} showsVerticalScrollIndicator={false}>
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
                  const min = plan.minPrice || 0;
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
                        <Text style={{ flex: 1, paddingRight: 10, fontSize: 12.5, fontWeight: '800', color: isSel ? '#15803D' : belowMin ? '#94A3B8' : '#1C252E' }}>{plan.label}</Text>
                        {isSel && <Ionicons name="checkmark-circle" size={20} color="#4CBB17" />}
                      </View>
                      {/* Min-price hint: red "Requires $X+ (current: $Y)" ONLY when a price
                          is entered below the minimum; otherwise the plan's own grey note.
                          No "enter end price first" lock — the plan is selectable at $0. */}
                      {belowMin ? (
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#EF4444', marginTop: 4 }}>
                          Requires ${min.toLocaleString()}+ (current: ${Number(price).toLocaleString()})
                        </Text>
                      ) : plan.minPriceNote && plan.minPriceNote !== '0' ? (
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', marginTop: 4 }}>{plan.minPriceNote}</Text>
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

function PriceRow({ label, value, green, small }: { label: string; value: string; green?: boolean; small?: boolean }) {
  const fs = small ? 10 : 11;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: small ? 6 : 10 }}>
      <Text style={{ fontSize: fs, fontWeight: '600', color: green ? '#16a34a' : '#637381' }}>{label}</Text>
      <Text style={{ fontSize: fs, fontWeight: '900', color: green ? '#16a34a' : '#1C252E' }}>{value}</Text>
    </View>
  );
}

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

function DropOutcomeModal({ visible, dropPrice, screensCount = 0, screensCost = 0, method, calculatorMethod, existingDrop, isLowesLead, plans, dropAddCategories, onSecure, onDecline, onPlanSelected, onClose }: {
  visible: boolean;
  dropPrice: number;
  screensCount?: number;
  screensCost?: number;
  method: string;
  calculatorMethod: string;
  existingDrop?: any | null;
  isLowesLead: boolean;
  plans: Record<string, DealPlan>;
  dropAddCategories: PayCategory[];
  onSecure: (data: { paymentMethod: string; paymentMethods: string[]; downPayment: number; balance: number }) => void;
  onDecline: (data: { paymentMethod: string; paymentMethods: string[]; downPayment: number; balance: number }) => void;
  onPlanSelected?: (planKey: string) => void;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const badges = isLowesLead
    ? [{ key: 'lowes_ach', label: 'ACH' }, { key: 'lowes_cc', label: 'CC' }]
    : [{ key: 'check', label: 'CK' }, { key: 'mcVisaDscvr', label: 'CC' }];

  const [selectedPlan, setSelectedPlan] = useState(calculatorMethod);
  const [addedPlans, setAddedPlans] = useState<string[]>(isFinancing(plans, calculatorMethod) ? [calculatorMethod] : []);
  const [leadMethod, setLeadMethod] = useState(method);
  const [downText, setDownText] = useState('');
  const [showDown, setShowDown] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const savedMethod = existingDrop?.paymentMethod || calculatorMethod;
    const savedDown = Number(existingDrop?.downPayment) || 0;
    const savedPlans: string[] = (
      Array.isArray(existingDrop?.paymentMethods) && existingDrop.paymentMethods.length
        ? existingDrop.paymentMethods
        : [savedMethod]
    ).filter((k: string) => isFinancing(plans, k));
    setSelectedPlan(savedMethod);
    setAddedPlans(savedPlans);
    setLeadMethod(calculatorMethod);
    setDownText(savedDown > 0 ? String(savedDown) : '');
    setShowDown(savedDown > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, method, calculatorMethod, existingDrop]);

  const submitted = useRef(false);
  useEffect(() => {
    if (visible) submitted.current = false;
  }, [visible]);
  const submitOnce = (fn: (data: any) => void) => (data: any) => {
    if (submitted.current) return;
    submitted.current = true;
    fn(data);
  };

  const down = parseFloat(downText) || 0;
  const balance = Math.max(0, dropPrice - down);
  const downExceeds = down > dropPrice;
  const canSecure = !!selectedPlan && !downExceeds;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const addPlan = (key: string) => {
    setAddedPlans((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setSelectedPlan(key);
    setShowPicker(false);
    onPlanSelected?.(key);
  };
  const removePlan = (key: string) => {
    setAddedPlans((prev) => prev.filter((k) => k !== key));
    if (selectedPlan === key) setSelectedPlan(badges[0].key);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Non-dismissable backdrop — tapping outside must NOT close the drop without
            saving; the rep has to choose Secure or Decline (web `DropPriceModal` passes
            NO `onClose` + `disableEscapeKeyDown`). And animationType="none" (web's
            `TransitionProps={{ timeout: 0 }}`) so handing off to the chooser / declined
            modal is instant and never fades out to reveal the un-dimmed background. */}
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
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
                  {/* Web parity: the headline is the drop PLUS the screens it includes. */}
                  <Text style={{ fontSize: 34, fontWeight: '900', color: '#1C252E' }}>{fmt(dropPrice + screensCost)}</Text>
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
                {screensCount > 0 && (
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#6B7280', marginTop: 6 }}>
                    ({screensCount} screens - {fmt(screensCost)} included)
                  </Text>
                )}
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
                        placeholder="0" placeholderTextColor="#94A3B8" keyboardType={NUMERIC_KEYBOARD}
                        returnKeyType="done"
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
              {/* Always show the LEAD-selected payment method as its own row.
                  Financing plans render as their own rows below; a BASIC method
                  (check / MC-VISA-DSCVR / AMEX / ACH etc.) has no financing row, so
                  surface it here. Driven by `leadMethod` (not `selectedPlan`) so it
                  stays visible even after the rep selects a different plan in the
                  popup — the lead's method must not be replaced by the new pick. It
                  is still selectable, and shows SELECTED only when it's the active plan. */}
              {leadMethod && !isFinancing(plans, leadMethod) && (
                <TouchableOpacity
                  onPress={() => setSelectedPlan(leadMethod)}
                  activeOpacity={0.9}
                  style={{ marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 2, borderColor: selectedPlan === leadMethod ? '#31D076' : '#F1F5F9', backgroundColor: selectedPlan === leadMethod ? '#fff' : '#F8FAFC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <View style={{ flex: 1, marginRight: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: selectedPlan === leadMethod ? '#0F172A' : '#94A3B8', marginRight: 6 }}>{planLabelOf(plans, leadMethod)}</Text>
                    {selectedPlan === leadMethod && (
                      <View style={{ backgroundColor: '#31D076', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff' }}>SELECTED</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: selectedPlan === leadMethod ? '#31D076' : '#E2E8F0', backgroundColor: selectedPlan === leadMethod ? '#fff' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
                    {selectedPlan === leadMethod && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#31D076' }} />}
                  </View>
                </TouchableOpacity>
              )}
              <GestureHandlerRootView>
                {addedPlans.filter((k) => isFinancing(plans, k)).map((key) => {
                  const plan = plans[key] || ({} as DealPlan);
                  const sel = selectedPlan === key;
                  const monthly = calcMonthly(plans, balance, key);
                  const abbr = planProviderAbbr(plan, key);
                  const planName = plan.label?.split('(')[0]?.trim() || key;
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
                              {!!abbr && (
                                <View style={{ backgroundColor: sel ? '#0F172A' : '#CBD5E1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginRight: 6 }}>
                                  <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>{abbr}</Text>
                                </View>
                              )}
                              <Text style={{ flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8' }} numberOfLines={2}>{planName}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                              <Text style={{ fontSize: 20, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8' }}>${Math.round(monthly).toLocaleString()}</Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginLeft: 2 }}>/mo</Text>
                              {sel && <View style={{ backgroundColor: '#31D076', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 10, alignSelf: 'center' }}><Text style={{ fontSize: 8, fontWeight: '900', color: '#fff' }}>SELECTED</Text></View>}
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
                <TouchableOpacity onPress={() => submitOnce(onDecline)({ paymentMethod: selectedPlan, paymentMethods: addedPlans.filter((k) => isFinancing(plans, k)), downPayment: down, balance })} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!canSecure} onPress={() => submitOnce(onSecure)({ paymentMethod: selectedPlan, paymentMethods: addedPlans.filter((k) => isFinancing(plans, k)), downPayment: down, balance })} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: canSecure ? '#31D076' : '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ResultJobChooser({ visible, name, price, isFullPackage = false, packageExtras = '', onSale, onDemo, onClose }: {
  visible: boolean; name: string; price: number;
  isFullPackage?: boolean;
  packageExtras?: string;
  onSale: () => void; onDemo: () => void; onClose: () => void;
}) {
  const { isDark } = useTheme();
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const [showPackageInfo, setShowPackageInfo] = useState(false);
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
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
          {/* "Result Job <name>" — a full package swaps the name for the icon + ⓘ, so
              this heading matches the tab and the quote card the rep just came from. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#1C252E', textAlign: 'center' }}>Result Job </Text>
            <FullPackageTitle
              isFullPackage={isFullPackage}
              extras={packageExtras}
              title={name}
              size={16}
              weight="600"
              color="#1C252E"
              iconColor="#16A34A"
              onInfo={(rect) => { setPackageAnchor(rect); setShowPackageInfo(true); }}
              style={{ flexShrink: 1 }}
            />
          </View>
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

        {/* Last child of this modal's root, so it covers the chooser card. Anchored in
            window space, which is the same frame this root occupies. */}
        {showPackageInfo && (
          <FullPackageInfoOverlay anchorRect={packageAnchor} onClose={() => setShowPackageInfo(false)} />
        )}
      </Pressable>
    </Modal>
  );
}

function DeclinedPriceModal({ visible, declinedPrice, onResultLead, onClose }: {
  visible: boolean; declinedPrice: number; onResultLead: () => void; onClose: () => void;
}) {
  const { isDark } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
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

function PremiumQuoteCard({ calculator, initialPrice, categoryMeta, isLowesLead, isRehashed = false, pricing, verticals, pricingConfig, leadId, appointmentId, scopeChanged = false, lockState, onResetJobBuilder, onDismissScopeWarning, onShowPackageInfo, onPriceChange, onResult, onPaymentMethodChange, onDropChange, onDiscountChange, onDownPaymentChange, onRendersChange, onOneYearMonthlyChange }: {
  calculator: CalculatorTab; initialPrice?: number;
  categoryMeta: Record<string, { label: string; style: CatStyle }>;
  isLowesLead: boolean;
  isRehashed?: boolean;
  pricing: DealPricing;
  verticals: CalculatorSchema[];
  pricingConfig?: PricingConfig | null;
  leadId?: string;
  appointmentId?: string;
  scopeChanged?: boolean;
  onDismissScopeWarning?: () => void;
  onShowPackageInfo?: (rect: PackageAnchorRect | null) => void;
  onPriceChange: (id: string, price: number, pricemarkup?: string) => void;
  onResult: (id: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => void;
  onPaymentMethodChange: (id: string, method: string) => void;
  lockState?: CalculatorLockState;
  onResetJobBuilder?: () => void;
  onDropChange: (id: string, drops: any[]) => void;
  onDiscountChange: (id: string, discount: number) => void;
  onDownPaymentChange: (id: string, downPayment: number) => void;
  onRendersChange: (id: string, renders: any[]) => void;
  onOneYearMonthlyChange: (id: string, plan: OneYearMonthlyValue) => void;
}) {
  const { user, refreshUser } = useAuth();
  const packageInfo = useMemo(
    () => describeFullPackage(calculator.entries || {}, verticals || []),
    [calculator.entries, verticals]
  );
  const jobLock: CalculatorLockState = lockState || { isSubmittedTab: false, isAnySubmitted: false, isLockedByOtherTab: false };
  const [endPrice, setEndPrice] = useState(initialPrice ? String(initialPrice) : String(calculator.price || ''));
  const [focused, setFocused] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [dropText, setDropText] = useState('');
  const [showDropInput, setShowDropInput] = useState(false);
  const [downText, setDownText] = useState(calculator.downPayment ? String(calculator.downPayment) : '');
  const [showDownInput, setShowDownInput] = useState((calculator.downPayment || 0) > 0);
  const [showLockedDetails, setShowLockedDetails] = useState(false);
  const [pendingDrop, setPendingDrop] = useState(0);
  const [showDropModal, setShowDropModal] = useState(false);
  const [pendingDropIndex, setPendingDropIndex] = useState(-1);
  const [showChooser, setShowChooser] = useState(false);
  const [chooserPrice, setChooserPrice] = useState(0);
  const [declinedPrice, setDeclinedPrice] = useState<number | null>(null);
  const [chooserDown, setChooserDown] = useState(0);

  const plans = pricing.plans;
  const method = resolveMethod(calculator, user?.defaultPaymentMethod, pricing.defaultMethod);
  const isDefaultMethod = !!user?.defaultPaymentMethod && user.defaultPaymentMethod === method;
  const logTiers = useMemo(
    () => computeLogTiers(calculator.entries, verticals, pricingConfig),
    [calculator.entries, verticals, pricingConfig],
  );
  // REVUIUX-444: the 1 Year default is the REP's (user.defaultOneYearPaymentMethod), shared by every deal on every lead.
  const repOneYearKey = useMemo(() => resolveRepOneYearKey(plans, user), [plans, user?.defaultOneYearPaymentMethod]);
  const defaultOneYearKey = useMemo(
    () => resolveOneYearDefaultKey(plans, user, method),
    [plans, user?.defaultOneYearPaymentMethod, user?.defaultPaymentMethod, method],
  );
  const drops: any[] = calculator.dropPrice || [];
  const acceptedDrop = drops.find((d) => d.status === 'accepted');
  const activeMethod = acceptedDrop?.paymentMethod || method;
  const activeDownPayment = Number(acceptedDrop?.downPayment) || 0;
  const resultDownPayment = acceptedDrop ? activeDownPayment : (Number(calculator.downPayment) || 0);

  const logCalculator = { id: calculator.id, title: calculator.title, appointmentId: (calculator as any).appointmentId || appointmentId };

  const loggedPriceRef = useRef<number | null>(calculator.price ? Number(calculator.price) : null);
  const seededDiscountRef = useRef(false);
  const logEndPriceEntered = () => {
    const p = parseFloat(endPrice) || 0;
    if (loggedPriceRef.current === p) return;
    if (p > 0 && priceErr) return;
    const prev = loggedPriceRef.current;
    loggedPriceRef.current = p;
    onPriceChange(calculator.id, p, p > 0 ? markupLabel(p, logTiers) : '');
    const uid = user?._id || user?.id;
    if (!uid || p <= 0) return;
    logRolloutChange({
      userId: uid,
      leadId,
      calculator: logCalculator,
      tiers: logTiers,
      percentageOfRollout: markupLabel(p, logTiers),
      change: {
        fieldName: 'endPrice', fieldLabel: 'End Price', fieldValue: p, fieldCategory: 'rollout',
        oldValue: prev ?? (calculator.price || ''), newValue: p,
        action: 'end price entered',
      },
    }).catch(() => {});
    // Ticket 1308: the In-Home Pre Order discount becomes meaningful the moment there is a
    // price to apply it to, so it is seeded here rather than at Confirm Rollouts. Once per
    // calculator - editing the price again must not re-log a discount that did not change.
    if (!seededDiscountRef.current) {
      seededDiscountRef.current = true;
      logPreOrderDiscount({
        userId: uid,
        leadId,
        calculator: logCalculator,
        tiers: logTiers,
        endPrice: p,
        discountPercentage: discountPct,
        isDefault: !!user?.defaultPercentage && user.defaultPercentage === discountPct,
      }).catch(() => {});
    }
  };

  const logDiscountChanged = (next: number) => {
    const uid = user?._id || user?.id;
    if (!uid || next === discountPct) return;
    // A rep who taps a chip BEFORE entering a price has stated their choice explicitly, so the
    // seed is spent: otherwise the later price entry would log the default underneath this
    // change and the Forever Record would read 20% -> 15%.
    seededDiscountRef.current = true;
    logPreOrderDiscount({
      userId: uid,
      leadId,
      calculator: logCalculator,
      tiers: logTiers,
      endPrice: parseFloat(endPrice) || Number(calculator.price) || 0,
      discountPercentage: next,
      oldDiscountPercentage: discountPct,
      isDefault: !!user?.defaultPercentage && user.defaultPercentage === next,
      isConfirmed: !!(calculator as any).isRolloutConfirmed,
    }).catch(() => {});
  };

  const logPaymentMethodChanged = (newKey: string) => {
    const uid = user?._id || user?.id;
    const oldKey = method;
    if (!uid || newKey === oldKey) return;
    const isConfirmed = !!(calculator as any).isRolloutConfirmed;
    const currentPrice = parseFloat(endPrice) || Number(calculator.price) || 0;
    logRolloutChange({
      userId: uid,
      leadId,
      calculator: logCalculator,
      tiers: logTiers,
      percentageOfRollout: markupLabel(currentPrice, logTiers),
      change: {
        fieldName: 'paymentMethod', fieldLabel: 'Payment Method', fieldValue: currentPrice,
        fieldCategory: isConfirmed ? 'drop' : 'rollout',
        oldValue: oldKey, newValue: currentPrice,
        oldPaymentMethod: oldKey, newPaymentMethod: newKey,
        oldPaymentMethodLabel: planLabelOf(plans, oldKey),
        newPaymentMethodLabel: planLabelOf(plans, newKey),
        action: isConfirmed ? 'payment method changed for drop' : 'payment method changed',
      },
    }).catch(() => {});
  };

  const logDropPlanSelected = (planKey: string) => {
    const uid = user?._id || user?.id;
    if (!uid || !planKey) return;
    logRolloutChange({
      userId: uid,
      leadId,
      calculator: logCalculator,
      tiers: logTiers,
      percentageOfRollout: markupLabel(pendingDrop, logTiers),
      change: {
        fieldName: 'dropPricePlan', fieldLabel: 'Drop Price Plan', fieldValue: pendingDrop, fieldCategory: 'drop',
        oldValue: '', newValue: pendingDrop,
        paymentPlanKey: planKey, paymentPlanLabel: planLabelOf(plans, planKey), dropPrice: pendingDrop,
        action: 'drop price plan selected',
      },
    }).catch(() => {});
  };

  const markupPercentOf = (price: number, t: { cost: number; par: number; retail: number }) => {
    const cost = Math.round(t.cost) || 0;
    const par = Math.round(t.par) || 0;
    const retail = Math.round(t.retail) || 0;
    const anchor = price >= retail ? retail : price >= par ? par : cost;
    return anchor ? Math.round(((price - anchor) / anchor) * 100) : 0;
  };

  const logDropUnselected = (dropPrice: number, index: number) => {
    const uid = user?._id || user?.id;
    if (!uid) return;
    logRolloutChange({
      userId: uid,
      leadId,
      calculator: logCalculator,
      tiers: logTiers,
      percentageOfRollout: markupLabel(dropPrice, logTiers),
      change: {
        fieldName: 'dropPrice', fieldLabel: 'Drop Price', fieldValue: dropPrice, fieldCategory: 'drop',
        oldValue: dropPrice, newValue: dropPrice,
        isSecured: false, isDeclined: true, dropNumber: index + 1, dropPrice,
        dropMarkupPercent: markupPercentOf(dropPrice, logTiers),
        retailMarkupPercent: markupPercentOf(logTiers.retail, logTiers),
        paymentPlanKey: method, paymentPlanLabel: planLabelOf(plans, method),
        action: 'drop price unselected',
      },
    }).catch(() => {});
  };

  const liveTotals = useMemo(
    () => computeCalculatorTiers(calculator.entries, verticals, pricingConfig),
    [calculator.entries, verticals, pricingConfig],
  );
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

  const itemRows = useMemo(() => {
    const rows = Object.values(calculator.entries || {}).filter((e: any) => e && e.inputValue > 0) as any[];
    return rows.sort((a, b) => String(a.categoryId).localeCompare(String(b.categoryId)));
  }, [calculator.entries]);

  const hasProducts = itemRows.length > 0;

  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const priceNum = parseFloat(endPrice) || 0;
  const priceErr = endPriceError(plans, priceNum, calculator, method);
  const finalPrice = drops.length
    ? dropPriceOf(drops[drops.length - 1])
    : (calculator.price || priceNum);

  const discountPct = calculator.discountPercentage || pricing.defaultPreOrder;
  const seniorVetPct = pricing.seniorVetPct;
  const isDefaultDiscount = !!user?.defaultPercentage && user.defaultPercentage === discountPct;
  const screensCount = screensCountFromEntries(calculator.entries);
  const screenUnitPrice = useMemo(
    () => screenUnitPriceFromSchemas(verticals, pricingConfig),
    [verticals, pricingConfig],
  );
  const downPay = calculator.downPayment || 0;
  const rolloutResult = useMemo(
    () =>
      computeRolloutResult({
        endPrice: priceNum > 0 ? priceNum : tiers[2].value,
        screensCount,
        screenUnitPrice,
        discountConfig: pricing.discountConfig,
        discountPct,
        seniorVetPct,
        downPayment: downPay,
        plan: plans[method],
      }),
    [priceNum, tiers, screensCount, screenUnitPrice, pricing.discountConfig, discountPct, seniorVetPct, downPay, plans, method],
  );
  const priceWithScreens = rolloutResult.priceWithScreens;
  const msrp = rolloutResult.msrp;
  const inHomeProgram = rolloutResult.programs.find((p) => p.isHighlighted) || rolloutResult.programs[rolloutResult.programs.length - 1];
  const oneYearProgram = rolloutResult.programs.find((p) => !p.isHighlighted) || rolloutResult.programs[0];
  const oneYearGrandTotal = oneYearProgram?.grandTotal ?? msrp;
  const preOrderGrandTotal = inHomeProgram?.grandTotal ?? msrp;
  const srVetDiscount = msrp * (seniorVetPct / 100);
  const preOrderDiscountVal = msrp * (discountPct / 100);
  const preOrderMonthly = rolloutResult.monthly;
  const priceLocked = !!calculator.isRolloutConfirmed && !isRehashed;

  const showResult = priceLocked ? showLockedDetails : (priceNum > 0 && !priceErr);

  const saveDefault = async (patch: CalculatorSettingsPatch, label: string) => {
    queueCalculatorSetting(patch);
    const applied = await flushCalculatorSettings();
    if (applied) {
      await refreshUser?.();
      FlashMessage.success(label);
      return;
    }
    FlashMessage.success(label, "Saved on your device — it'll sync when you're back online.");
  };

  const setOneYearDefault = (key: string | null) =>
    saveDefault(
      { defaultOneYearPaymentMethod: key },
      key ? '1 Year default plan set' : '1 Year default plan cleared'
    );

  const toggleDefault = (next: boolean) =>
    saveDefault(
      { defaultPaymentMethod: next ? method : null },
      next ? 'Default payment method set' : 'Default payment method cleared'
    );

  const isLocked = !!calculator.isRolloutConfirmed;

  const toggleDefaultDiscount = (next: boolean) =>
    saveDefault(
      { defaultPercentage: next ? discountPct : null },
      next ? 'Default discount set' : 'Default discount cleared'
    );

  const loggedDownRef = useRef<number | null>(calculator.downPayment ? Number(calculator.downPayment) : null);
  const logDownPaymentEntered = (v: number) => {
    const uid = user?._id || user?.id;
    if (!uid || loggedDownRef.current === v) return;
    const prev = loggedDownRef.current;
    loggedDownRef.current = v;
    logRolloutChange({
      userId: uid,
      leadId,
      calculator: logCalculator,
      tiers: logTiers,
      percentageOfRollout: markupLabel(v, logTiers),
      change: {
        fieldName: 'downPayment', fieldLabel: 'Down Payment', fieldValue: v, fieldCategory: 'rollout',
        oldValue: prev ?? (Number(calculator.downPayment) || 0), newValue: v,
        action: 'down payment entered',
      },
    }).catch(() => {});
  };

  const commitDownPayment = () => {
    let v = parseFloat(downText) || 0;
    const cap = priceNum > 0 ? priceNum : (calculator.price || 0);
    if (cap > 0 && v > cap) {
      FlashMessage.warning('Down payment', `Down payment cannot be greater than the end price (${fmt(cap)}).`);
      v = cap;
      setDownText(String(v));
    }
    onDownPaymentChange(calculator.id, v);
    logDownPaymentEntered(v);
  };

  const clearDownPayment = () => {
    setDownText('');
    setShowDownInput(false);
    onDownPaymentChange(calculator.id, 0);
    logDownPaymentEntered(0);
  };

  const openDrop = () => {
    const v = parseFloat(dropText) || 0;
    if (v <= 0) return;
    const cost = tiers.find((t) => t.label === 'COST')?.value ?? effectiveCostOf(calculator);
    if (v < cost) { FlashMessage.error('Invalid drop price', `Drop price must be at least the cost price (${fmt(cost)}).`); return; }
    if (priceNum > 0 && v === priceNum) {
      FlashMessage.error('Invalid drop price', 'Drop Price cannot be added because it is the same as the Rollout Price.');
      return;
    }
    if (priceNum > 0 && v > priceNum) { FlashMessage.error('Invalid drop price', `Drop price cannot exceed rollout end price (${fmt(priceNum)})`); return; }
    if (WELLS_FARGO_HIGH_KEYS.includes(method) && v < WF_HIGH_MIN_PRICE) {
      FlashMessage.error('Invalid drop price', `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`);
      return;
    }
    const planMin = plans[method]?.minPrice || 0;
    if (planMin && v < planMin) { FlashMessage.error('Invalid drop price', `This payment plan requires a minimum price of ${fmt(planMin)}.`); return; }
    setPendingDrop(v);
    setPendingDropIndex(-1); // a fresh round → Secure/Decline APPEND it
    setShowDropModal(true);
    setShowDropInput(false);
    setDropText('');
  };

  const resolveDropTargetIndex = () => {
    const priceOf = (d: any) => Math.round(dropPriceOf(d));
    const target = Math.round(Number(pendingDrop));
    if (
      pendingDropIndex >= 0 &&
      pendingDropIndex < drops.length &&
      priceOf(drops[pendingDropIndex]) === target
    ) {
      return pendingDropIndex;
    }
    return -1;
  };

  const secureDrop = (data: { paymentMethod: string; paymentMethods?: string[]; downPayment: number; balance: number }) => {
    const pricemarkup = markupLabel(pendingDrop, logTiers);
    const targetIndex = resolveDropTargetIndex();
    const accepted = { price: pendingDrop, dropedPrice: pendingDrop, status: 'accepted', pricemarkup, ...data };
    const next = drops.map((d, idx) => {
      if (idx === targetIndex) return { ...d, ...accepted };
      return d.status === 'accepted' ? { ...d, status: 'declined' } : d;
    });
    if (targetIndex < 0) next.push(accepted); // a new round → append, as web does
    onDropChange(calculator.id, next);
    const uidS = user?._id || user?.id;
    if (uidS) {
      const prevIdx = (targetIndex >= 0 ? targetIndex : drops.length) - 1;
      const lastDrop = prevIdx >= 0 ? (drops[prevIdx]?.dropedPrice ?? drops[prevIdx]?.price) : (calculator.price || priceNum);
      const dropNumber = targetIndex >= 0 ? targetIndex + 1 : next.length;
      logRolloutChange({
        userId: uidS,
        leadId,
        calculator: { id: calculator.id, title: calculator.title, appointmentId: (calculator as any).appointmentId || appointmentId },
        tiers: logTiers,
        percentageOfRollout: pricemarkup,
        change: {
          fieldName: 'dropPrice', fieldLabel: 'Drop Price', fieldValue: pendingDrop, fieldCategory: 'drop',
          oldValue: lastDrop, newValue: pendingDrop,
          oldPercentageOfRollout: markupLabel(Number(lastDrop) || 0, logTiers),
          isSecured: true, isDeclined: false, dropNumber, dropPrice: pendingDrop,
          paymentPlanKey: data.paymentMethod, paymentPlanLabel: planLabelOf(pricing.plans, data.paymentMethod),
          action: 'drop price secured',
        },
      }).catch(() => {});
      if (isFinancing(pricing.plans, data.paymentMethod)) {
        logRolloutChange({
          userId: uidS,
          leadId,
          calculator: { id: calculator.id, title: calculator.title, appointmentId: (calculator as any).appointmentId || appointmentId },
          tiers: logTiers,
          percentageOfRollout: pricemarkup,
          change: {
            fieldName: 'dropPricePlan', fieldLabel: 'Drop Price Plan', fieldValue: pendingDrop, fieldCategory: 'drop',
            oldValue: '', newValue: pendingDrop,
            paymentPlanKey: data.paymentMethod, paymentPlanLabel: planLabelOf(pricing.plans, data.paymentMethod),
            dropPrice: pendingDrop, dropNumber,
            action: 'drop price plan selected on secure',
          },
        }).catch(() => {});
      }
    }
    setShowDropModal(false);
    setShowDropInput(false);
    setPendingDropIndex(-1);
    setChooserPrice(pendingDrop);
    setChooserDown(Number(data.downPayment) || 0);
    setShowChooser(true);
  };

  const declineDrop = (data: { paymentMethod: string; paymentMethods?: string[]; downPayment: number; balance: number }) => {
    const pricemarkup = markupLabel(pendingDrop, logTiers);
    const targetIndex = resolveDropTargetIndex();
    const declined = { price: pendingDrop, dropedPrice: pendingDrop, status: 'declined', pricemarkup, ...data };
    const next = targetIndex >= 0
      ? drops.map((d, idx) => (idx === targetIndex ? { ...d, ...declined } : d))
      : [...drops, declined];
    onDropChange(calculator.id, next);
    const uidD = user?._id || user?.id;
    if (uidD) {
      const prevIdx = (targetIndex >= 0 ? targetIndex : drops.length) - 1;
      const lastDrop = prevIdx >= 0 ? (drops[prevIdx]?.dropedPrice ?? drops[prevIdx]?.price) : (calculator.price || priceNum);
      const dropNumber = targetIndex >= 0 ? targetIndex + 1 : next.length;
      logRolloutChange({
        userId: uidD,
        leadId,
        calculator: { id: calculator.id, title: calculator.title, appointmentId: (calculator as any).appointmentId || appointmentId },
        tiers: logTiers,
        percentageOfRollout: pricemarkup,
        change: {
          fieldName: 'dropPrice', fieldLabel: 'Drop Price', fieldValue: pendingDrop, fieldCategory: 'drop',
          oldValue: lastDrop, newValue: pendingDrop,
          oldPercentageOfRollout: markupLabel(Number(lastDrop) || 0, logTiers),
          isSecured: false, isDeclined: true, dropNumber, dropPrice: pendingDrop,
          paymentPlanKey: data.paymentMethod, paymentPlanLabel: planLabelOf(pricing.plans, data.paymentMethod),
          action: 'drop price declined',
        },
      }).catch(() => {});
    }
    setShowDropModal(false);
    setShowDropInput(false);
    setPendingDropIndex(-1);
    setDeclinedPrice(pendingDrop);
  };

  const openResultChooser = () => {
    const secured = autoSecureLastDrop(drops);
    let chooseAt = finalPrice;
    let chooseDown = resultDownPayment;
    if (secured !== drops) {
      onDropChange(calculator.id, secured);
      const idx = secured.length - 1;
      const row = secured[idx];
      const dropPrice = dropPriceOf(row);
      if (dropPrice > 0) chooseAt = dropPrice;
      chooseDown = Number(row?.downPayment) || 0;
      const uidA = user?._id || user?.id;
      if (uidA) {
        const prev = idx > 0 ? secured[idx - 1] : null;
        const lastDrop = prev ? dropPriceOf(prev) : (calculator.price || priceNum);
        logRolloutChange({
          userId: uidA,
          leadId,
          calculator: { id: calculator.id, title: calculator.title, appointmentId: (calculator as any).appointmentId || appointmentId },
          tiers: logTiers,
          percentageOfRollout: markupLabel(dropPrice, logTiers),
          change: {
            fieldName: 'dropPrice', fieldLabel: 'Drop Price', fieldValue: dropPrice, fieldCategory: 'drop',
            oldValue: lastDrop, newValue: dropPrice,
            oldPercentageOfRollout: markupLabel(Number(lastDrop) || 0, logTiers),
            isSecured: true, isDeclined: false, dropNumber: idx + 1, dropPrice,
            paymentPlanKey: row?.paymentMethod || activeMethod,
            paymentPlanLabel: planLabelOf(pricing.plans, row?.paymentMethod || activeMethod),
            action: 'drop price secured',
          },
        }).catch(() => {});
      }
    }
    setChooserPrice(chooseAt);
    setChooserDown(chooseDown);
    setShowChooser(true);
  };

  const declineResultLead = () => {
    setDeclinedPrice(null);
    const lastDrop = drops.length
      ? Number(drops[drops.length - 1]?.price ?? drops[drops.length - 1]?.dropedPrice) || 0
      : Number(calculator.price) || 0;
    onResult(calculator.id, 'demo', lastDrop, activeMethod, resultDownPayment);
  };

  const methodCategory = pricing.categories.find((c) => c.plans.includes(method));
  const methodAvailable = !!plans[method] && !!methodCategory;

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
          <Text style={{ fontSize: 8, fontWeight: '900', color: '#637381', letterSpacing: 1.5, marginBottom: 2, textTransform: 'uppercase' }}>{methodAvailable ? (methodCategory?.title || 'BASIC') : 'PAYMENT METHOD'}</Text>
          <Text style={{ fontSize: 10, fontWeight: '900', color: methodAvailable ? '#212B36' : '#919EAB' }}>{methodAvailable ? planLabelOf(plans, method) : 'Select payment method'}</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color="#637381" />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      {/* ── Main card ── */}
      {/* Ticket 409 — a resulted lead makes the WHOLE quote read-only, not just the two
          action buttons: web dims the entire card (see the reference screenshot, where the
          items, Add Renders, the payment plan, the tiers and the end price are all greyed).
          `pointerEvents: 'none'` is what actually enforces it — without it the payment-plan
          sheet, Add Renders and the end-price field stay tappable behind the dimming and the
          rep can still edit a quote the lead was already resulted against.
          Mirrors the CLASSIC deal center (`CalculatorSummary.tsx`: `opacity: 0.6` +
          `pointerEvents` on `isJobBuilderSubmitted || isJobSubmittedOnOtherCalc`). */}
      <View
        pointerEvents={jobLock.isAnySubmitted ? 'none' : 'auto'}
        style={{ backgroundColor: '#fff', borderWidth: 2, borderColor: calculator.isRolloutConfirmed ? '#16A34A' : '#DFE3E8', borderRadius: 24, paddingBottom: 16, opacity: jobLock.isAnySubmitted ? 0.6 : 1 }}
      >
        {/* 1. Heading — calculator name + confirmed/required badge (old UI parity) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 }}>
          {/* Web `QuoteResultCard.js:153-165` renders the calculator title at
              fontWeight 800 — mobile had it at 600, so it read as normal text.
              A full package shows the badge here too, so this heading and the strip
              tab that selected it never disagree. */}
          <FullPackageTitle
            {...packageInfo}
            title={calculator.title}
            size={14}
            color="#212B36"
            iconColor="#16A34A"
            onInfo={onShowPackageInfo}
            style={{ flex: 1 }}
          />
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

        {/* Add Renders — pick which before/after renders show on the estimate.
            Sits right above Payment Method (mockup parity). */}
        <RevRenderSlots
          leadId={leadId}
          selected={calculator.selectedRenders || []}
          onChange={(renders: RenderPair[]) => onRendersChange(calculator.id, renders)}
          locked={isLocked}
        />

        {/* Payment Method selector — moved down to sit RIGHT ABOVE cost/par/retail so
            reps remember to adjust the plan before reading the price (web parity:
            QuoteResultCard puts PaymentPlanSelect immediately above the tiles). */}
        {paymentMethodBlock}

        {/* 4. COST / PAR / RETAIL tiles */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 14 }}>
          {tiers.map((tier) => (
            <View key={tier.label} style={{ flex: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, backgroundColor: '#fff', borderWidth: tier.isRetail ? 1.5 : 1, borderColor: tier.isRetail ? '#16A34A' : '#DFE3E8', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4, color: '#94A3B8', textTransform: 'uppercase' }}>{tier.label}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ alignSelf: 'stretch', textAlign: 'center', fontSize: 14, fontWeight: '900', color: tier.isRetail ? '#16A34A' : '#212B36' }}>{fmt(tier.value)}</Text>
            </View>
          ))}
        </View>

        {/* Job-scope-changed warning — shown when the calculator's scope changed after
            this end price was entered. The price is KEPT; the rep is asked to review it,
            and can dismiss (✕) once satisfied. Spec: only the changed rollout warns. */}
        {scopeChanged && (
          <View style={{ marginHorizontal: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
            <Ionicons name="warning" size={16} color="#B45309" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#92400E' }}>Job Scope was changed</Text>
              <Text style={{ fontSize: 11, color: '#B45309', marginTop: 2, lineHeight: 15 }}>
                Please review the Rollout End Price — your previously entered price may no longer be correct.
              </Text>
            </View>
            <TouchableOpacity onPress={onDismissScopeWarning} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={16} color="#B45309" />
            </TouchableOpacity>
          </View>
        )}

        {/* 5. Rollout End Price — old UI style */}
        <View style={{ marginHorizontal: 14, marginBottom: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: priceLocked ? '#16A34A' : '#F59E0B', marginBottom: 8, marginLeft: 4, letterSpacing: 1 }}>ROLLOUT END PRICE</Text>
          {priceLocked ? (
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
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: hasProducts ? '#fff' : '#F4F6F8', borderWidth: 2, borderColor: priceErr ? '#EF4444' : focused ? '#16A34A' : '#DFE3E8', borderRadius: 16, paddingHorizontal: 16, height: 64, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: !hasProducts ? '#919EAB' : focused ? '#16A34A' : '#637381', marginRight: 8, lineHeight: 20 }}>$</Text>
              <TextInput
                style={{ flex: 1, fontSize: 16, fontWeight: '900', color: !hasProducts ? '#919EAB' : focused ? '#16A34A' : '#212B36', padding: 0, margin: 0, height: '100%', lineHeight: 20, textAlignVertical: 'center' }}
                value={endPrice}
                editable={hasProducts}
                onChangeText={(t) => { const c = t.replace(/[^0-9.]/g, ''); setEndPrice(c); onPriceChange(calculator.id, parseFloat(c) || 0); }}
                onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); logEndPriceEntered(); }}
                placeholder={hasProducts ? 'Enter End Price' : 'Add products first'} placeholderTextColor="#919EAB" keyboardType={NUMERIC_KEYBOARD}
                returnKeyType="done"
              />
            </View>
          )}
          {/* Says WHY the box is dead. Without it a disabled input with no explanation
              reads as the screen being broken, which is how this was reported. */}
          {!priceLocked && !hasProducts && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,179,0,0.1)', borderWidth: 1, borderColor: 'rgba(255,179,0,0.3)' }}>
              <Ionicons name="information-circle" size={18} color="#F59E0B" />
              <Text style={{ flex: 1, fontSize: 11, fontWeight: '600', color: '#B45309', marginLeft: 8, lineHeight: 16 }}>
                Add products in the calculator to set a rollout price.
              </Text>
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
                      onPress={() => toggleDefaultDiscount(!isDefaultDiscount)}
                      style={{ width: 32, height: 20, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 4, backgroundColor: isDefaultDiscount ? '#22C55E' : '#CBD5E1', alignItems: isDefaultDiscount ? 'flex-end' : 'flex-start' }}
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
                        onPress={() => { logDiscountChanged(d); onDiscountChange(calculator.id, d); }}
                        style={{ flex: 1, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? '#4CBB17' : '#E2E8F0', backgroundColor: active ? '#4CBB170D' : '#fff' }}
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
                {/* 1-Year Program monthly payment — match In-Home or the rep's default,
                    or override with any financing plan (may be "worse" than In-Home).
                    Intentionally editable even when the rollout is LOCKED: the 1-Year
                    terms are presentational (they never re-price the deal — MSRP and the
                    end price are unchanged), and the selection persists via
                    `onOneYearMonthlyChange` so an edit made after confirming still flows
                    through to the Investment Center. */}
                <OneYearMonthlyPlan
                  plans={plans}
                  categories={pricing.categories}
                  inHomeMethod={method}
                  defaultKey={defaultOneYearKey}
                  base={oneYearGrandTotal}
                  value={calculator.oneYearMonthlyPlan ?? null}
                  onChange={(v) => onOneYearMonthlyChange(calculator.id, v)}
                  locked={false}
                  repDefaultKey={repOneYearKey}
                  onSetRepDefault={setOneYearDefault}
                />
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 8, marginBottom: 10, height: 36 }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: '#94A3B8', marginRight: 3, lineHeight: 12 }}>$</Text>
                      <TextInput
                        style={{ flex: 1, fontSize: 9, fontWeight: '800', color: '#1C252E', padding: 0, margin: 0, height: '100%', lineHeight: 12, textAlignVertical: 'center' }}
                        value={formatAmountInput(downText)}
                        onChangeText={(t) => setDownText(stripAmount(t))}
                        onEndEditing={commitDownPayment}
                        onBlur={commitDownPayment}
                        placeholder="Add Down Payment"
                        placeholderTextColor="#94A3B8"
                        keyboardType={NUMERIC_KEYBOARD}
                        returnKeyType="done"
                      />
                      {downPay > 0 && (
                        <TouchableOpacity onPress={clearDownPayment} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={16} color="#FF5630" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setShowDownInput(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2196F3', backgroundColor: '#2196F30D', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, marginBottom: 10 }}>
                      <Ionicons name="add" size={13} color="#2196F3" />
                      {/* flexShrink + shrink-to-fit so the label never spills past
                          the dashed border in the narrow In-Home column. */}
                      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1, fontSize: 10, fontWeight: '800', color: '#2196F3', textAlign: 'center' }}>{downPay > 0 ? `Down Payment: ${fmt(downPay)}` : 'Add Down Payment'}</Text>
                    </TouchableOpacity>
                  )}
                  {downPay > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: '#16a34a' }}>Down Payment</Text>
                      <Text style={{ fontSize: 10, fontWeight: '900', color: '#16a34a' }}>-{fmt(downPay)}</Text>
                    </View>
                  )}

                  {/* Always shown (web parity): a basic method reads "$0 /mo  Check (Bank Fee: 0%)". */}
                  <View style={{ alignItems: 'center', marginTop: 4 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#1C252E', marginBottom: 2 }}>{fmt(preOrderMonthly)}<Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8' }}> /mo</Text></Text>
                      <Text style={{ fontSize: 9, color: '#637381', textAlign: 'center' }} numberOfLines={2}>{planLabelOf(plans, method)}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* ── Outside card: Installers Check + Drops + Actions (old UI parity) ── */}
      {calculator.isRolloutConfirmed && (
        <View style={{ marginTop: 16, marginBottom: 24 }}>
          {/* Everything ABOVE the action row dims with the card. The row itself stays
              OUTSIDE this wrapper — Reset Job Builder is the one control that must remain
              pressable, and it lives there. */}
          <View
            pointerEvents={jobLock.isAnySubmitted ? 'none' : 'auto'}
            style={{ opacity: jobLock.isAnySubmitted ? 0.6 : 1 }}
          >
          {/* Installers Check bar */}
          <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1C252E' }}>Check to installers (screens)</Text>
            {/* Reuse the computed screensCost rather than re-deriving it — a second
                copy of the math is exactly how this drifted from the schema price. */}
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#16A34A' }}>{fmt(rolloutResult.screensCost)}</Text>
          </View>

          {/* Drops list with old-UI View/Unselect/Display */}
          {drops.map((d, i) => {
            const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][i] || `${i + 1}th`;
            const declined = d.status === 'declined';
            const secured = d.status === 'accepted';
            const dp = dropPriceOf(d);
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
                      <TouchableOpacity onPress={() => {
                        const nextDrops = drops.map((d2, idx) => (idx === i ? { ...d2, status: 'declined' } : d2));
                        onDropChange(calculator.id, nextDrops);
                        logDropUnselected(dp, i);
                      }}>
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
                  value={formatAmountInput(dropText)}
                  onChangeText={(t) => setDropText(stripAmount(t))}
                  onSubmitEditing={openDrop}
                  onBlur={
                    Platform.OS === 'ios' && !NUMERIC_KEYBOARD_HAS_RETURN_KEY
                      ? openDrop
                      : undefined
                  }
                  placeholder="Enter price..."
                  placeholderTextColor="#919EAB"
                  keyboardType={NUMERIC_KEYBOARD}
                  returnKeyType="done"
                  autoFocus
                />
              </View>
            </View>
          )}

          </View>

          {/* Drop + Result Lead buttons */}
          {/* Ticket 409 — once the lead is resulted from ANY calculator both actions lock
              on EVERY tab (web `QuoteResultCard`: `isLocked = isAnyJobSubmitted` on the drop
              button, `isDisabled` on Result Lead), and the resulted tab swaps Result Lead
              for a red Reset Job Builder. The reference screenshots show exactly this: on a
              NON-resulted tab both buttons are greyed; on the resulted one the drop is greyed
              beside a vivid red Reset. */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              disabled={jobLock.isAnySubmitted}
              onPress={() => {
                if (showDropInput) {
                  openDrop();
                } else {
                  setDropText('');
                  setShowDropInput(true);
                }
              }}
              style={{ flex: 1, minHeight: 64, paddingVertical: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: jobLock.isAnySubmitted ? '#CBD5E1' : '#1976D2', backgroundColor: jobLock.isAnySubmitted ? '#F1F5F9' : '#fff', opacity: jobLock.isAnySubmitted ? 0.5 : 1 }}
            >
              <Text style={{ fontSize: 12, fontWeight: '900', color: jobLock.isAnySubmitted ? '#94A3B8' : '#1976D2' }}>
                {`+ ${['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][drops.length] || `${drops.length + 1}th`} Drop`}
              </Text>
            </TouchableOpacity>

            {jobLock.isSubmittedTab ? (
              <TouchableOpacity
                onPress={() => onResetJobBuilder?.()}
                style={{ flex: 1, minHeight: 64, paddingVertical: 8, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EF4444' }}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff', marginLeft: 8 }}>Reset Job Builder</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                disabled={jobLock.isAnySubmitted}
                onPress={openResultChooser}
                style={{ flex: 1, minHeight: 64, paddingVertical: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: jobLock.isAnySubmitted ? '#CBD5E1' : '#F97316', backgroundColor: jobLock.isAnySubmitted ? '#F1F5F9' : '#fff', opacity: jobLock.isAnySubmitted ? 0.5 : 1 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="document-text-outline" size={16} color={jobLock.isAnySubmitted ? '#94A3B8' : '#EA580C'} style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 12, fontWeight: '900', color: jobLock.isAnySubmitted ? '#94A3B8' : '#EA580C' }}>Result Lead</Text>
                </View>
                                {/* Web parity (QuoteResultCard.js:964 `{!isRehashed && …}`): on a rehash
                    the price isn't carried forward from the original appointment — the rep
                    enters it in the result modal — so the button shows no locked figure. */}
                {!isRehashed && (
                  <Text style={{ fontSize: 14, fontWeight: '900', color: jobLock.isAnySubmitted ? '#94A3B8' : '#EA580C' }}>
                    {finalPrice > 0 ? fmt(finalPrice) : ''}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <PaymentPlanModal
        visible={showPlanPicker}
        selected={method}
        price={priceNum}
        plans={plans}
        categories={pricing.categories}
        onSelect={(key) => {
          if (key !== method) {
            if (WELLS_FARGO_HIGH_KEYS.includes(key) && priceNum > 0 && priceNum < WF_HIGH_MIN_PRICE) {
              FlashMessage.warning(`Payment plan changed - this Wells Fargo plan requires a minimum end price of $${WF_HIGH_MIN_PRICE.toLocaleString()}. Please update the end price.`);
            } else if (calculator.isRolloutConfirmed && priceNum > 0) {
              FlashMessage.warning(`Payment method updated - the rollout price $${priceNum.toLocaleString()} is already confirmed.`);
            }
          }
          logPaymentMethodChanged(key);
          onPaymentMethodChange(calculator.id, key);
          setShowPlanPicker(false);
        }}
        onClose={() => setShowPlanPicker(false)}
      />

      <DropOutcomeModal
        visible={showDropModal}
        dropPrice={pendingDrop}
        screensCount={screensCount}
        screensCost={rolloutResult.screensCost}
        method={activeMethod}
        calculatorMethod={method}
        existingDrop={pendingDropIndex >= 0 ? drops[pendingDropIndex] : null}
        isLowesLead={isLowesLead}
        plans={plans}
        dropAddCategories={pricing.dropAddCategories}
        onSecure={secureDrop}
        onDecline={declineDrop}
        onPlanSelected={logDropPlanSelected}
        onClose={() => { setShowDropModal(false); setPendingDropIndex(-1); }}
      />

      <ResultJobChooser
        visible={showChooser}
        name={calculator.title}
        isFullPackage={packageInfo.isFullPackage}
        packageExtras={packageInfo.extras}
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

export function RolloutView({ calculators, verticals, pricingConfig, pricing, isLowesLead = false, isRehashed = false, leadId, appointmentId, onBack, onConfirmRollouts, onResultJob, onPriceCommit, onDismissScopeWarning, onPaymentMethodChange, onDropChange, onDiscountChange, onDownPaymentChange, onRendersChange, onOneYearMonthlyChange, onRolloutsConfirmedDone, activeTabId, onTabSelect, submittedCalculatorId = null, onResetJobBuilder }: RolloutViewProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [prices, setPrices] = useState<Record<string, number>>({});
  const effectivePrice = (c: CalculatorTab) => prices[c.id] ?? c.price ?? 0;
  const logTiersFor = (c: CalculatorTab) =>
    computeLogTiers(c.entries, verticals || [], pricingConfig);
  const scopeChangedOf = (c: CalculatorTab) =>
    effectivePrice(c) > 0 && !!c.priceScopeSig && scopeSignature(c.entries || {}) !== c.priceScopeSig;
  const visibleCalculators = useMemo(() => rolloutCalculators(calculators), [calculators]);
  const packageByCalcId = useMemo(() => {
    const map: Record<string, { isFullPackage: boolean; extras: string }> = {};
    visibleCalculators.forEach((c) => {
      map[c.id] = describeFullPackage(c.entries || {}, verticals || []);
    });
    return map;
  }, [visibleCalculators, verticals]);
  const [packageInfoVisible, setPackageInfoVisible] = useState(false);
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const openPackageInfo = useCallback((rect: PackageAnchorRect | null) => {
    setPackageAnchor(rect);
    setPackageInfoVisible(true);
  }, []);
  const allConfirmed = allRolloutsConfirmed(visibleCalculators);
  const allHavePrices = visibleCalculators.length > 0 && visibleCalculators.every((c) => effectivePrice(c) > 0);
  const enteredCount = visibleCalculators.filter((c) => effectivePrice(c) > 0).length;
  const progress = visibleCalculators.length > 0 ? (enteredCount / visibleCalculators.length) * 100 : 0;
  const selectedCalc = visibleCalculators.find((c) => c.id === activeTabId) || visibleCalculators[0];
  const lockOf = useCallback(
    (calcId: string): CalculatorLockState => {
      if (!submittedCalculatorId) {
        return { isSubmittedTab: false, isAnySubmitted: false, isLockedByOtherTab: false };
      }
      const isSubmittedTab = String(calcId) === String(submittedCalculatorId);
      return { isSubmittedTab, isAnySubmitted: true, isLockedByOtherTab: !isSubmittedTab };
    },
    [submittedCalculatorId]
  );

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
    const tiers = computeLogTiers(calc.entries, verticals || [], pricingConfig);
    const uid = user?._id || user?.id;
    if (uid) {
      logRolloutChange({
        userId: uid,
        leadId,
        calculator: { id: calc.id, title: calc.title, appointmentId: (calc as any).appointmentId || appointmentId },
        tiers,
        percentageOfRollout: markupLabel(enteredPrice, tiers),
        change: {
          fieldName: 'rolloutAutoConfirmed', fieldLabel: 'Rollout Auto-Confirmed',
          fieldValue: enteredPrice, fieldCategory: 'rollout', oldValue: '', newValue: enteredPrice,
          autoConfirmed: true, timeSinceLastChange: Math.round(elapsed / 1000),
          action: 'rollout auto-confirmed (10 min inactivity)',
        },
      }).catch(() => {});
    }
    onConfirmRolloutsRef.current?.([
      { id: calc.id, price: enteredPrice, pricemarkup: markupLabel(enteredPrice, tiers) },
    ]);
  }, [prices, pricing, user, verticals, pricingConfig, leadId, appointmentId]);

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

  const categoryMeta = useMemo(() => {
    const map: Record<string, { label: string; style: CatStyle }> = {};
    (verticals || []).forEach((v) => (v.categories || []).forEach((cat) => {
      const named = CATEGORY_STYLE_MAP[(cat.name || '').toLowerCase()] || CATEGORY_STYLE_MAP[(cat.label || '').toLowerCase()];
      map[cat.id] = { label: cat.label, style: resolveSchemaStyle({ icon: cat.icon, color: cat.color }, named) };
    }));
    return map;
  }, [verticals]);

  const [scrollOffset, setScrollOffset] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const summaryTabsScrollViewRef = useRef<ScrollView>(null);
  // The inline drop-price / end-price / down-payment inputs use the in-app number pad, which
  // `KeyboardAwareScrollView` (keyboard-frame driven) never scrolls for: bring the focused one up.
  const quoteScrollRef = useRef<any>(null);
  const quoteContentRef = useRef<View>(null);
  useNumPadScrollIntoView(quoteScrollRef, quoteContentRef, 16);

  return (
    <PhotoPeekScrollLockProvider>
    {/* `View`, not `KeyboardAvoidingView` — its `behavior="padding"` shrank this whole
        column whenever the keyboard opened, which is what let the footer below the
        `KeyboardAwareScrollView` visually land on top of a just-focused field (ticket:
        "the button is looking up and hiding the drop price field"). The library's
        `KeyboardAwareScrollView` already keeps the focused input above the keyboard on
        its own; stacking a padding `KeyboardAvoidingView` around it double-compensates
        instead of helping. Same deliberate choice `DynamicDealEditScreen` documents at
        its own `KeyboardAwareScrollView`s. */}
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#DFE3E8', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={onBack} style={{ padding: 8, marginRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DFE3E8', borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
          <Ionicons name="arrow-back" size={18} color="#212B36" />
        </TouchableOpacity>
        {/*
          Rollout tab strip geometry — do NOT put a fixed `height` back on this row.

          Reported by a client as "rollouts cut off … the bar adjusts vertically":
          the calculator titles rendered with their top half sliced away. The strip
          was `height: 40` with `alignItems: 'center'`, so the horizontal ScrollView
          was NOT stretched to that 40 — its cross size fell back to its content, and
          each tab's `height: '100%'` resolved against the ScrollView's content
          container, which has no definite height, so it collapsed to `auto` and the
          tab hugged its own text. A label taller than 40 was then centred inside a
          40pt box and overflowed symmetrically, top and bottom, and got clipped.

          Nothing in the app caps font scaling (`App.tsx` injects a fontFamily only,
          `allowFontScaling` stays on), so any device with the OS text size raised
          renders a line box past 40 — which is why this reproduces for the client
          and not for us at the default scale.

          The strip is now stretch-aligned and `minHeight`, so it GROWS instead of
          clipping, and the label carries an explicit line box plus a scale cap so it
          cannot grow without bound.
        */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'stretch', minHeight: 40 }}>
          <View style={{ flex: 1, position: 'relative', flexDirection: 'row', alignItems: 'stretch' }}>
            <ScrollView
              ref={summaryTabsScrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ alignItems: 'stretch' }}
              scrollEventThrottle={16}
              onScroll={(e) => setScrollOffset(e.nativeEvent.contentOffset.x)}
              onContentSizeChange={(w) => setContentWidth(w)}
              onLayout={(e) => setScrollViewWidth(e.nativeEvent.layout.width)}
            >
              {visibleCalculators.map((calc) => {
                const isActive = calc.id === selectedCalc?.id;
                const hasLockedDrop = (calc.dropPrice || []).some((d: any) => d.status === 'accepted');
                const needsReview = scopeChangedOf(calc);
                return (
                  <TouchableOpacity key={calc.id} onPress={() => onTabSelect?.(calc.id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', paddingHorizontal: 12, paddingVertical: 4, borderBottomWidth: 2, borderBottomColor: isActive ? '#16A34A' : 'transparent' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {hasLockedDrop && (
                        <Ionicons name="lock-closed" size={12} color={isActive ? '#16A34A' : '#94A3B8'} style={{ marginRight: 6 }} />
                      )}
                      {/* Same swap as the calculator step's footer tab: the package icon
                          stands for the four-part name, and the ⓘ carries the breakdown
                          the letters used to spell out. An inactive tab's ⓘ is greyed
                          with the rest of the tab so it doesn't out-shout the selected one. */}
                      {packageByCalcId[calc.id]?.isFullPackage ? (
                        <FullPackageTitle
                          isFullPackage
                          extras={packageByCalcId[calc.id]?.extras}
                          size={14}
                          color={isActive ? '#212B36' : '#637381'}
                          iconColor={isActive ? '#16A34A' : '#94A3B8'}
                          infoColor={isActive ? '#00B8D9' : '#94A3B8'}
                          onInfo={openPackageInfo}
                        />
                      ) : (
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          style={{ fontSize: 14, includeFontPadding: false, fontWeight: '900', color: isActive ? '#212B36' : '#637381' }}
                        >
                          {calc.title}
                        </Text>
                      )}
                      {needsReview && (
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#F59E0B', marginLeft: 6 }} />
                      )}
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

      {/* `KeyboardAwareScrollView`, not `PeekAwareScrollView` — this content never renders a
          `PhotoPeekPressable` (no photos in the quote card), so the peek-lock machinery was
          dead weight here, and swapping it out locally avoids touching the shared component
          other screens rely on. Ticket: "the button is looking up and hiding the drop price
          field" — Rollout End Price, Add Down Payment and the inline drop-price input all
          live in this one scroll view with no way to bring a focused field above the keyboard;
          `KeyboardAwareScrollView` does that automatically for whichever one is focused,
          instead of a hand-rolled `scrollToEnd` that only helped the bottom-most field. */}
      <KeyboardAwareScrollView ref={quoteScrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View ref={quoteContentRef} collapsable={false} style={{ maxWidth: 600, alignSelf: 'center', width: '100%' }}>
          {selectedCalc ? (
            <PremiumQuoteCard key={selectedCalc.id} calculator={selectedCalc}
              initialPrice={effectivePrice(selectedCalc)}
              categoryMeta={categoryMeta}
              isLowesLead={isLowesLead}
              isRehashed={isRehashed}
              leadId={leadId}
              appointmentId={appointmentId}
              pricing={pricing}
              verticals={verticals || []}
              pricingConfig={pricingConfig}
              scopeChanged={scopeChangedOf(selectedCalc)}
              lockState={lockOf(selectedCalc.id)}
              onResetJobBuilder={onResetJobBuilder}
              onDismissScopeWarning={() => onDismissScopeWarning?.(selectedCalc.id)}
              onShowPackageInfo={openPackageInfo}
              onPriceChange={(id, price, pricemarkup) => {
                setPrices((p) => ({ ...p, [id]: price }));
                rolloutLastChangedRef.current = { ...rolloutLastChangedRef.current, [id]: Date.now() };
                onPriceCommit?.(id, price, pricemarkup);
              }}
              onResult={(id, result, price, paymentMethod, downPayment) => onResultJob?.(id, result, price, paymentMethod, downPayment)}
              onPaymentMethodChange={(id, m) => {
                onPaymentMethodChange?.(id, m);
                rolloutLastChangedRef.current = { ...rolloutLastChangedRef.current, [id]: Date.now() };
              }}
              onDropChange={(id, drops) => onDropChange?.(id, drops)}
              onDiscountChange={(id, d) => onDiscountChange?.(id, d)}
              onDownPaymentChange={(id, dp) => onDownPaymentChange?.(id, dp)}
              onRendersChange={(id, renders) => onRendersChange?.(id, renders)}
              onOneYearMonthlyChange={(id, plan) => onOneYearMonthlyChange?.(id, plan)} />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 80 }}>
              <Ionicons name="cube-outline" size={44} color="#CBD5E1" />
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#637381', marginTop: 12, marginBottom: 8 }}>No Calculators</Text>
              <Text style={{ fontSize: 14, color: '#94A3B8' }}>Add calculators to see pricing</Text>
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>

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
              const confirmed = pending.map((c) => ({
                id: c.id,
                price: effectivePrice(c),
                pricemarkup: markupLabel(effectivePrice(c), logTiersFor(c)),
              }));
              const uidC = user?._id || user?.id;
              if (uidC) {
                pending.forEach((c) => {
                  const p = effectivePrice(c);
                  const tiers = logTiersFor(c);
                  logRolloutChange({
                    userId: uidC,
                    leadId,
                    calculator: { id: c.id, title: c.title, appointmentId: (c as any).appointmentId || appointmentId },
                    tiers,
                    percentageOfRollout: markupLabel(p, tiers),
                    change: {
                      fieldName: 'rolloutConfirmed', fieldLabel: 'Rollout Confirmed',
                      fieldValue: p, fieldCategory: 'rollout', oldValue: '', newValue: p,
                      action: 'rollout confirmed',
                    },
                  }).catch(() => {});
                });
              }
              onConfirmRollouts?.(confirmed);
              FlashMessage.success('Rollouts confirmed', 'Tap “Jobs Built — Back to Tools” when ready.');
            }} disabled={!allHavePrices} style={{ minWidth: 200, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, backgroundColor: allHavePrices ? '#4CBB17' : 'rgba(145,158,171,0.12)' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', textAlign: 'center', color: allHavePrices ? '#fff' : 'rgba(145,158,171,0.4)' }}>Confirm Rollouts</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* All rollouts confirmed → the jobs are built; a single CTA takes the rep back
          to the Lead Center tools to present (map / pitch book / Investment Center). */}
      {visibleCalculators.length > 0 && allConfirmed && (
        <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 16 }}>
          <TouchableOpacity
            onPress={() => onRolloutsConfirmedDone?.()}
            style={{ maxWidth: 1200, alignSelf: 'center', width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#4CBB17', borderRadius: 12, paddingVertical: 15 }}
          >
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Jobs Built — Back to Tools</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Full-package contents — the ⓘ on a package tab in the strip above, or on the
          quote card heading. Anchored near the TOP here (the calculator step anchors
          its copy near the bottom) because that is where this screen's strip sits. */}
      <FullPackageInfoModal
        visible={packageInfoVisible}
        onClose={() => setPackageInfoVisible(false)}
        anchorRect={packageAnchor}
      />
    </View>
    </PhotoPeekScrollLockProvider>
  );
}
