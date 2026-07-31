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
import { dedupeDrops } from '../utils/drop-prices';
import { FlashMessage } from '../../../config/message';
import { useAuth } from '../../../hooks/useAuth';
import { SettingsService } from '../../../services/api/SettingsService';
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
import { logRolloutChange } from '../../../utils/activity-log/rollout-log-meta';
import { unitSuffix, labelWithSection, buildSectionLabelMap } from '../utils/item-format';
import { RevRenderSlots, type RenderPair } from './RevRenderSlots';
import { OneYearMonthlyPlan, type OneYearMonthlyValue } from './OneYearMonthlyPlan';
import { scopeSignature } from '../utils/scope-signature';

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
  /** Job-scope fingerprint the entered price was priced against (drives the
   *  "Job Scope was changed" warning). Empty when no price has been entered. */
  priceScopeSig?: string;
  paymentMethod?: string;
  dropPrice?: any[];
  downPayment?: number;
  discountPercentage?: number;
  /** RevRender before/after pairs bound to this calculator's job build. */
  selectedRenders?: any[];
  /** 1-Year Program monthly-payment selection (persisted for the Investment Center). */
  oneYearMonthlyPlan?: OneYearMonthlyValue;
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
  /** Lead id — threaded into the rollout/drop activity logs (web parity). */
  leadId?: string;
  /** Appointment id — the CalcTab does NOT carry it, so the rollout/drop logs must
   *  receive it here or they ship `appointmentId: undefined` and the portal can't
   *  group them into the "Rollout & Drops" module (web keys on `calculator.appointmentId`). */
  appointmentId?: string;
  onBack?: () => void;
  onConfirmRollouts?: (confirmed: Array<{ id: string; price: number; pricemarkup?: string }>) => void;
  onResultJob?: (calculatorId: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => void;
  /** Persist the entered end price on the calculator so it survives back-to-calculator
   *  edits (spec: never delete the user's entered end prices) and snapshots its scope. */
  onPriceCommit?: (id: string, price: number, pricemarkup?: string) => void;
  /** Dismiss the "Job Scope was changed" warning (re-baseline the scope snapshot). */
  onDismissScopeWarning?: (id: string) => void;
  /** Persist a calculator's payment plan (auto-saves like a field change). */
  onPaymentMethodChange?: (id: string, method: string) => void;
  /** Persist a calculator's drop-price list. */
  onDropChange?: (id: string, drops: any[]) => void;
  /** Persist a calculator's pre-order discount % (result-section selector). */
  onDiscountChange?: (id: string, discount: number) => void;
  /** Persist a calculator's rollout down payment. */
  onDownPaymentChange?: (id: string, downPayment: number) => void;
  /** Persist the RevRender pairs the rep bound to this calculator's job build. */
  onRendersChange?: (id: string, renders: any[]) => void;
  /** Persist the 1-Year Program monthly-payment selection. */
  onOneYearMonthlyChange?: (id: string, plan: OneYearMonthlyValue) => void;
  /** Fired after the rep taps Confirm Rollouts — the flow returns to the Lead
   *  Center tools so they can present (map / pitch book) and open Investment Center. */
  onRolloutsConfirmedDone?: () => void;
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
                  const min = plan.minPrice || 0;
                  // A min-price plan (e.g. Wells Fargo "jobs over $7,500") is ALWAYS
                  // selectable — including BEFORE any end price is entered — matching the
                  // regular rollout picker (`CalculatorSummary`) and web. The shared
                  // `planBelowMin` only flags an ENTERED price below the minimum
                  // (price > 0 && price < min), so at price 0 nothing is locked: the rep
                  // picks the plan first, THEN types the end price. (The earlier build
                  // wrongly treated price 0 as below-min and DISABLED these rows — the
                  // "enter end price first" lock the ticket is about.)
                  const belowMin = planBelowMin(plans, key, price);
                  const isSel = key === selected;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        // Below-min = a price IS entered and it's under the plan minimum:
                        // warn instead of selecting (regular-rollout + Add-Plan parity). At
                        // price 0 belowMin is false, so every plan selects freely; a later
                        // below-min end price is caught by the end-price validation.
                        if (belowMin) { FlashMessage.warning('Payment plan', belowMinMsg(plans, key, price)); return; }
                        onSelect(key);
                      }}
                      style={{
                        padding: 14, borderRadius: 12, borderWidth: 1.5, marginBottom: 8,
                        // Below-min rows read as GREY/muted so they're clearly distinct from
                        // the white, selectable active options.
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

function DropOutcomeModal({ visible, dropPrice, method, calculatorMethod, existingDrop, isLowesLead, plans, dropAddCategories, onSecure, onDecline, onPlanSelected, onClose }: {
  visible: boolean;
  dropPrice: number;
  method: string;
  /** The lead / calculator BASE payment method (deal-center pick, e.g. AMEX). Kept
   * separate from `method` (which is the active/pre-select plan and can become a
   * secured drop's financing plan) so the lead's method always shows as its own row,
   * even when Displaying a drop that was secured with a different (financing) plan. */
  calculatorMethod: string;
  /** When reopening an already-recorded drop (Display), its saved values seed the
   * modal so the previously-chosen plan / down payment are shown, not a blank form. */
  existingDrop?: any | null;
  isLowesLead: boolean;
  plans: Record<string, DealPlan>;
  dropAddCategories: PayCategory[];
  onSecure: (data: { paymentMethod: string; paymentMethods: string[]; downPayment: number; balance: number }) => void;
  onDecline: (data: { paymentMethod: string; paymentMethods: string[]; downPayment: number; balance: number }) => void;
  /** Fired when the rep ADDS a financing plan → `drop price plan selected` rollout log. */
  onPlanSelected?: (planKey: string) => void;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const badges = isLowesLead
    ? [{ key: 'lowes_ach', label: 'ACH' }, { key: 'lowes_cc', label: 'CC' }]
    : [{ key: 'check', label: 'CK' }, { key: 'mcVisaDscvr', label: 'CC' }];

  const [selectedPlan, setSelectedPlan] = useState(calculatorMethod);
  const [addedPlans, setAddedPlans] = useState<string[]>(isFinancing(plans, calculatorMethod) ? [calculatorMethod] : []);
  // The payment method chosen on the lead / rollout card — kept SEPARATELY from
  // `selectedPlan` so it stays displayed as its own row even after the rep picks a
  // different plan in the popup (it must not be replaced by the newly-selected one).
  const [leadMethod, setLeadMethod] = useState(method);
  const [downText, setDownText] = useState('');
  const [showDown, setShowDown] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Seed the modal each time it opens: from the saved drop when re-displaying an
  // existing one, otherwise from the calculator's current payment method. Without
  // this an already-secured drop reopened empty (dropped its plan + down payment).
  useEffect(() => {
    if (!visible) return;
    // A NEW drop defaults to ONLY the lead's method (`calculatorMethod`, e.g. AMEX) —
    // it must NOT carry over the plan a PREVIOUS drop was secured with (that came in
    // via `method`/activeMethod). Displaying an existing drop still seeds from that
    // drop's own saved method + plans.
    const savedMethod = existingDrop?.paymentMethod || calculatorMethod;
    const savedDown = Number(existingDrop?.downPayment) || 0;
    // Restore EVERY plan the rep chose for this drop (Display parity): a secured/
    // declined drop persists its full `paymentMethods` list, so reopening it shows
    // all of them in Monthly Options — not just the one selected plan. Falls back
    // to the single saved method for older records that stored only `paymentMethod`.
    const savedPlans: string[] = (
      Array.isArray(existingDrop?.paymentMethods) && existingDrop.paymentMethods.length
        ? existingDrop.paymentMethods
        : [savedMethod]
    ).filter((k: string) => isFinancing(plans, k));
    setSelectedPlan(savedMethod);
    setAddedPlans(savedPlans);
    // The lead's method is always the calculator's BASE method (`calculatorMethod`),
    // independent of the plan the rep selects AND of a secured drop's financing plan
    // (which flows through `method`). So Displaying a financing-secured drop still
    // shows the lead's basic method (e.g. AMEX) as its own row.
    setLeadMethod(calculatorMethod);
    setDownText(savedDown > 0 ? String(savedDown) : '');
    setShowDown(savedDown > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, method, calculatorMethod, existingDrop]);

  const down = parseFloat(downText) || 0;
  const balance = Math.max(0, dropPrice - down);
  const downExceeds = down > dropPrice;
  const canSecure = !!selectedPlan && !downExceeds;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  // The rep can add MULTIPLE plans to Monthly Options — adding appends to the
  // list (deduped) and marks the new one selected; each can still be removed via
  // swipe. Only the currently-selected plan is what Secure/Decline records.
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
                              <Text style={{ fontSize: 13, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8', marginRight: 6 }} numberOfLines={1}>{planName}</Text>
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
                <TouchableOpacity onPress={() => onDecline({ paymentMethod: selectedPlan, paymentMethods: addedPlans.filter((k) => isFinancing(plans, k)), downPayment: down, balance })} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={!canSecure} onPress={() => onSecure({ paymentMethod: selectedPlan, paymentMethods: addedPlans.filter((k) => isFinancing(plans, k)), downPayment: down, balance })} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: canSecure ? '#31D076' : '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
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
  // animationType="none" so the drop → chooser hand-off is instant: the dimmed
  // backdrop is up on the same frame the drop modal disappears, never revealing the
  // un-dimmed background (web parity — the drop dialog uses timeout:0).
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
  // animationType="none" so decline → this modal is instant with no background flash.
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

function PremiumQuoteCard({ calculator, initialPrice, categoryMeta, isLowesLead, pricing, verticals, pricingConfig, leadId, appointmentId, scopeChanged = false, onDismissScopeWarning, onPriceChange, onResult, onPaymentMethodChange, onDropChange, onDiscountChange, onDownPaymentChange, onRendersChange, onOneYearMonthlyChange }: {
  calculator: CalculatorTab; initialPrice?: number;
  categoryMeta: Record<string, { label: string; style: CatStyle }>;
  isLowesLead: boolean;
  pricing: DealPricing;
  verticals: CalculatorSchema[];
  pricingConfig?: PricingConfig | null;
  leadId?: string;
  appointmentId?: string;
  /** true when this calc's job scope changed after the price was entered. */
  scopeChanged?: boolean;
  /** dismiss the scope-changed warning (re-baselines the snapshot). */
  onDismissScopeWarning?: () => void;
  onPriceChange: (id: string, price: number, pricemarkup?: string) => void;
  onResult: (id: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => void;
  onPaymentMethodChange: (id: string, method: string) => void;
  onDropChange: (id: string, drops: any[]) => void;
  onDiscountChange: (id: string, discount: number) => void;
  onDownPaymentChange: (id: string, downPayment: number) => void;
  onRendersChange: (id: string, renders: any[]) => void;
  onOneYearMonthlyChange: (id: string, plan: OneYearMonthlyValue) => void;
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
  // Tiers the rollout LOGS anchor markup on — the SAME fee-adjusted, $200-floored
  // COST/PAR/RETAIL the markup anchors on. WEB PARITY (`calculateMarkup`): the
  // anchors ALWAYS use the `check` method, so they are INDEPENDENT of the selected
  // payment plan (unlike the displayed `tiers` below, which are fee-inflated by
  // `method`). `computeCalculatorTiers` derivation still fixes retail-only schemas so
  // the markup snaps to the right tier ("COST + 100%", not "PAR + 49%").
  const logTiers = useMemo(
    () => computeLogTiers(calculator.entries, verticals, pricingConfig),
    [calculator.entries, verticals, pricingConfig],
  );
  // The "default" 1-Year monthly plan: the rep's default payment method if it's a
  // financing plan, else the standard ~9.99% APR financing plan, else the first
  // financing plan available (web resolves the same 9.99% default in OneYearMonthlyPlan).
  const defaultOneYearKey = useMemo(() => {
    const financingKeys = Object.keys(plans).filter((k) => isFinancing(plans, k));
    if (user?.defaultPaymentMethod && isFinancing(plans, user.defaultPaymentMethod)) return user.defaultPaymentMethod;
    return (
      financingKeys.find((k) => Math.round((plans[k]?.apr || 0) * 100) / 100 === 9.99) ||
      financingKeys.find((k) => (plans[k]?.apr || 0) > 0) ||
      financingKeys[0] ||
      method
    );
  }, [plans, user?.defaultPaymentMethod, method]);
  const drops: any[] = calculator.dropPrice || [];
  const acceptedDrop = drops.find((d) => d.status === 'accepted');
  const activeMethod = acceptedDrop?.paymentMethod || method;
  const activeDownPayment = Number(acceptedDrop?.downPayment) || 0;

  // ── Rollout activity logs the portal timeline renders (web parity) ──────────
  const logCalculator = { id: calculator.id, title: calculator.title, appointmentId: (calculator as any).appointmentId || appointmentId };

  // Fire the "end price entered" log once per DISTINCT committed price (web guards on
  // `Number(price) === Number(calculator.price)`), not on every blur — otherwise
  // re-blurring the same value spams duplicate portal rows. This is the FIRST rollout
  // price log the portal shows under CONFIRMED ROLLOUTS.
  const loggedPriceRef = useRef<number | null>(calculator.price ? Number(calculator.price) : null);
  const logEndPriceEntered = () => {
    const p = parseFloat(endPrice) || 0;
    // Web `handleBlurPrice`: a focus-out with no change → do nothing.
    if (loggedPriceRef.current === p) return;
    // Web returns BEFORE saving/logging when the price is invalid (below cost, below a
    // Wells-Fargo-High minimum, or under the plan minimum) — the inline error already
    // shows it. Don't persist the markup and don't fire the log for an invalid price.
    if (p > 0 && priceErr) return;
    const prev = loggedPriceRef.current;
    loggedPriceRef.current = p;
    // Web parity: persist the pricemarkup alongside the price (handleBlurPrice's
    // updateLfCalculator({ price, pricemarkup, isRolloutConfirmed:false })), so the
    // calculator's stored markup tracks the entered end price — not only at confirm.
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
  };

  // Web `handlePaymentMethodChange` → `payment method changed` (or, once the rollout
  // is confirmed, `payment method changed for drop`). Portal reads `newPaymentMethodLabel`.
  const logPaymentMethodChanged = (newKey: string) => {
    const uid = user?._id || user?.id;
    const oldKey = method;
    if (!uid || newKey === oldKey) return;
    const isConfirmed = !!(calculator as any).isRolloutConfirmed;
    const currentPrice = parseFloat(endPrice) || Number(calculator.price) || 0;
    // Web parity: `fireRolloutLog` anchors this log on the calculator's CURRENT
    // (pre-change) method — web reads the stale `calculator.paymentMethod` because the
    // update hasn't re-rendered yet. `logTiers` (keyed on the current `method`) is
    // exactly that OLD-plan tier set, so use it to match web. (Web logs the payment-
    // method change against the price BEFORE the plan switched, NOT the new plan's
    // fee — matching that here.)
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

  // Web `handleSelectPlan` → `drop price plan selected` (portal "Added Payment Plan"
  // row). Fired when the rep adds a financing plan inside the drop-price modal.
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

  // Numeric markup percent (web `calculateMarkupNumber`) — the integer % a price sits
  // above its anchor tier. Used for the drop-unselect log's extra numeric fields.
  const markupPercentOf = (price: number, t: { cost: number; par: number; retail: number }) => {
    const cost = Math.round(t.cost) || 0;
    const par = Math.round(t.par) || 0;
    const retail = Math.round(t.retail) || 0;
    const anchor = price >= retail ? retail : price >= par ? par : cost;
    return anchor ? Math.round(((price - anchor) / anchor) * 100) : 0;
  };

  // Web `handleUnselectSecured` → `drop price unselected` rollout log. Un-securing a
  // drop marks it declined (kept in the list) and logs it — mobile previously updated
  // the drop status but fired no log, so the un-secure never reached the portal.
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

  // COST/PAR/RETAIL are recomputed LIVE from the entered quantities × the current
  // schema field prices (web `getCalculationResult` parity) — NOT from the stored
  // the stored raw totals, which for a blank-tier schema (only retail priced) carried
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
  // Web parity (`PremiumQuoteCard.js:274`): the per-screen price comes from the
  // schema's `number_of_screen` field, NOT a constant. This was omitted, so
  // `computeRolloutResult` silently applied its legacy $75 fallback and the
  // rollout disagreed with web whenever a company priced screens differently.
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

  // Web parity (ViewAllCalculators onDownPaymentChange → queueRolloutLog): a `down
  // payment entered` rollout log, deduped on the same value so re-blurring doesn't
  // re-log. Tiers/markup anchor on the calc's method (like web), and the markup is of
  // the DOWN-PAYMENT amount (web `calculateMarkup(dp, calculator)`), not the end price.
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
    logDownPaymentEntered(v);
  };

  const clearDownPayment = () => {
    setDownText('');
    setShowDownInput(false);
    onDownPaymentChange(calculator.id, 0);
    logDownPaymentEntered(0);
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
    // Client requirement: a drop must be SAVED THE INSTANT it is entered. The rep may
    // leave the app before hitting Secure/Decline — so record it as `declined` right
    // now (persisted via the calculator auto-save). When the rep returns it lists as a
    // Declined drop with its Display button, ready to re-open and Secure. Secure/Decline
    // then edit THIS entry in place (via `pendingDropIndex`), never appending a
    // duplicate. Declining never demotes other drops (single-accepted is a Secure-only
    // rule).
    //
    // NO activity log fires here — web parity: web only logs `drop price secured` /
    // `drop price declined` on the EXPLICIT action, never on entering the price.
    // Logging on entry produced BOTH a `declined` AND a `secured` log for one drop when
    // the rep then secured it. The entry only PERSISTS the row; Secure/Decline log.
    const pricemarkup = markupLabel(v, logTiers);
    const declined = { price: v, dropedPrice: v, status: 'declined', pricemarkup };
    const next = dedupeDrops([...drops, declined]);
    // The row to edit later: the just-added one, or the identical existing row if
    // dedupe collapsed it (same price/status/plan/down = the same negotiation round).
    let newIndex = next.indexOf(declined);
    if (newIndex < 0) {
      newIndex = next.findIndex(
        (d: any) => Math.round(Number(d?.price ?? d?.dropedPrice ?? 0)) === Math.round(v) && d?.status === 'declined'
      );
    }
    if (newIndex < 0) newIndex = next.length - 1;
    onDropChange(calculator.id, next);
    setPendingDrop(v);
    setPendingDropIndex(newIndex); // Secure/Decline edit this persisted row in place
    setShowDropModal(true);
    setShowDropInput(false);
    setDropText('');
  };

  // Resolve which existing drop a Secure/Decline should EDIT in place (vs. append a
  // NEW one). Each drop ACTION is its own numbered negotiation round: opening a fresh
  // drop via "+ Nth Drop" APPENDS a new entry — "1st Dropped Price", "2nd Dropped
  // Price", … — even at the same price, so the rep sees every round. Re-negotiating an
  // existing row via its Display button edits THAT row in place.
  //
  // DUPLICATION GUARD: `openDrop` now persists the pending drop as a `declined` twin the
  // instant it's entered (client save-on-close). So Secure/Decline must convert THAT
  // twin, never append a second row beside it. Trust `pendingDropIndex` when it still
  // points to a row at the price being actioned; otherwise adopt the existing declined
  // twin for this price (last one, i.e. the round just entered). Only when neither
  // exists (no twin at all) do we return -1 to append — a genuinely new price.
  const resolveDropTargetIndex = () => {
    const priceOf = (d: any) => Math.round(Number(d?.price ?? d?.dropedPrice ?? 0));
    const target = Math.round(Number(pendingDrop));
    if (
      pendingDropIndex >= 0 &&
      pendingDropIndex < drops.length &&
      priceOf(drops[pendingDropIndex]) === target
    ) {
      return pendingDropIndex;
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      if (priceOf(drops[i]) === target && drops[i]?.status === 'declined') return i;
    }
    return -1;
  };

  // Secure the pending drop → record it accepted (single-accepted: demote any
  // previously-accepted drop to declined, matching web `handleSecurePrice`), then
  // open the Result Lead outcome modal carrying the drop price.
  const secureDrop = (data: { paymentMethod: string; paymentMethods?: string[]; downPayment: number; balance: number }) => {
    // Web drop shape (ViewAllCalculators.js:797) carries `dropedPrice`, `status`,
    // `paymentMethod`, `pricemarkup` (the markup label), `downPayment`, `balance`.
    const pricemarkup = markupLabel(pendingDrop, logTiers);
    const targetIndex = resolveDropTargetIndex();
    const accepted = { price: pendingDrop, dropedPrice: pendingDrop, status: 'accepted', pricemarkup, ...data };
    // Edit in place (preserving any existing `_id`, web `...item`) when targeting an
    // existing drop; demote every OTHER accepted drop (single-accepted rule).
    const next = drops.map((d, idx) => {
      if (idx === targetIndex) return { ...d, ...accepted };
      return d.status === 'accepted' ? { ...d, status: 'declined' } : d;
    });
    if (targetIndex < 0) next.push(accepted); // genuinely-new price → append
    onDropChange(calculator.id, dedupeDrops(next));
    // Web parity (ViewAllCalculators.js:1147): `drop price secured` rollout log.
    const uidS = user?._id || user?.id;
    if (uidS) {
      // Web parity (handleSecurePrice `lastDroppedPrice`): the transition's OLD value is
      // the price BEFORE this drop — the previous drop, or the rollout end price for the
      // first — NOT the just-entered drop. `openDrop` already appended the pending drop
      // (save-on-entry), so read the entry BEFORE `targetIndex`. The portal draws the
      // yellow `old → new` arrow only when old ≠ new, which is what surfaces this log.
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
          // Old-price markup for the yellow "old → new" arrow (stripped in logRolloutChange).
          oldPercentageOfRollout: markupLabel(Number(lastDrop) || 0, logTiers),
          isSecured: true, isDeclined: false, dropNumber, dropPrice: pendingDrop,
          paymentPlanKey: data.paymentMethod, paymentPlanLabel: planLabelOf(pricing.plans, data.paymentMethod),
          action: 'drop price secured',
        },
      }).catch(() => {});
      // Web `handleSecurePrice` also fires `drop price plan selected on secure`
      // (portal "Selected Payment Plan" row) when the secured drop uses a financing plan.
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
    // Web parity: securing a drop opens the Sale/Demo chooser (→ outcome modal).
    setChooserPrice(pendingDrop);
    setChooserDown(Number(data.downPayment) || 0);
    setShowChooser(true);
  };

  // Decline the pending drop → record it declined (web shows a "Price Declined"
  // confirmation; the drop then lists as Declined and Result Lead stays available).
  const declineDrop = (data: { paymentMethod: string; paymentMethods?: string[]; downPayment: number; balance: number }) => {
    const pricemarkup = markupLabel(pendingDrop, logTiers);
    const targetIndex = resolveDropTargetIndex();
    const declined = { price: pendingDrop, dropedPrice: pendingDrop, status: 'declined', pricemarkup, ...data };
    // Edit the existing entry in place (preserving `_id`) or append a new declined
    // one; declining never demotes other drops (only Secure enforces single-accepted).
    const next = targetIndex >= 0
      ? drops.map((d, idx) => (idx === targetIndex ? { ...d, ...declined } : d))
      : [...drops, declined];
    onDropChange(calculator.id, dedupeDrops(next));
    // Web parity (ViewAllCalculators.js:944): `drop price declined` rollout log.
    const uidD = user?._id || user?.id;
    if (uidD) {
      // Web parity (handleDeclinePrice `lastDroppedPrice`): OLD value is the price BEFORE
      // this drop — the previous drop, or the rollout end price for the first — NOT the
      // just-entered drop. `openDrop` appended the pending drop (save-on-entry), so read
      // the entry BEFORE `targetIndex`; the portal draws the yellow arrow only when
      // old ≠ new.
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
          // Old-price markup for the yellow "old → new" arrow (stripped in logRolloutChange).
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

  // The resolved `method` can be a key that ISN'T offered for this lead/company —
  // e.g. a saved user default of `check` on a company whose dynamic plans have no
  // `check`, or a Lowe's-only key on a standard lead. Showing that stale label on a
  // selector whose dropdown doesn't list it is confusing, so when the method isn't
  // one of the AVAILABLE options we prompt "Select payment method" instead.
  const methodCategory = pricing.categories.find((c) => c.plans.includes(method));
  const methodAvailable = !!plans[method] && !!methodCategory;

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
            <View key={tier.label} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: tier.isRetail ? 1.5 : 1, borderColor: tier.isRetail ? '#16A34A' : '#DFE3E8', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 }}>
              <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4, color: '#94A3B8', textTransform: 'uppercase' }}>{tier.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: tier.isRetail ? '#16A34A' : '#212B36' }}>{fmt(tier.value)}</Text>
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
                onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); logEndPriceEntered(); }}
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
                        keyboardType="numeric"
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
            {/* Reuse the computed screensCost rather than re-deriving it — a second
                copy of the math is exactly how this drifted from the schema price. */}
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#16A34A' }}>{fmt(rolloutResult.screensCost)}</Text>
          </View>

          {/* Drops list with old-UI View/Unselect/Display */}
          {drops.map((d, i) => {
            const ordinal = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][i] || `${i + 1}th`;
            // Web parity (`ViewAllCalculators.js:472-473` hydration): secured and
            // declined are INDEPENDENT positive tests — `status === 'accepted'` and
            // `status === 'declined'`. Mobile derived secured as `!declined`, which is
            // strictly weaker: a drop with a missing/unknown status rendered SECURED
            // while the demotion (`=== 'accepted'`, line ~866) and the tab lock icon
            // both ignored it, so it could never be cleared.
            const declined = d.status === 'declined';
            const secured = d.status === 'accepted';
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
                      // Unselect DECLINES the secured drop (keeps it in the list, marked
                      // declined) — it does NOT remove it. Mirrors the regular rollout's
                      // handleUnselectDrop ({ secured:false, declined:true }); here the
                      // dynamic drop model uses status='declined'. Was filtering the drop
                      // out entirely, losing the record.
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
        onSelect={(key) => {
          // Web parity (CalculatorSummary.handlePaymentPlanSelect): warn via a toast
          // when the method is switched on a rollout whose price is already locked —
          // the dynamic flow previously changed it silently with no feedback.
          if (key !== method) {
            if (WELLS_FARGO_HIGH_KEYS.includes(key) && priceNum > 0 && priceNum < WF_HIGH_MIN_PRICE) {
              FlashMessage.warning(`Payment plan changed - this Wells Fargo plan requires a minimum end price of $${WF_HIGH_MIN_PRICE.toLocaleString()}. Please update the end price.`);
            } else if (calculator.isRolloutConfirmed && priceNum > 0) {
              FlashMessage.warning(`Payment method updated - the rollout price $${priceNum.toLocaleString()} is already confirmed.`);
            }
          }
          // Log FIRST (reads the still-current `method` as the old key), then apply
          // the change and close. This was previously duplicated — onPaymentMethodChange
          // / setShowPlanPicker were each called twice.
          logPaymentMethodChanged(key);
          onPaymentMethodChange(calculator.id, key);
          setShowPlanPicker(false);
        }}
        onClose={() => setShowPlanPicker(false)}
      />

      <DropOutcomeModal
        visible={showDropModal}
        dropPrice={pendingDrop}
        // Pre-select the ACTIVE payment method when opening a fresh drop: the plan
        // from the currently-accepted drop if one exists, else the calculator's
        // method. So the popup opens with the method the rep is already on (shown in
        // the rollout card / used on the last secured drop) highlighted — they can
        // still switch it, and Secure/Decline saves whatever is selected.
        method={activeMethod}
        // Base lead/calculator method (e.g. AMEX) — always shown as its own row,
        // even when Displaying a drop secured with a different financing plan.
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

export function RolloutView({ calculators, verticals, pricingConfig, pricing, isLowesLead = false, leadId, appointmentId, onBack, onConfirmRollouts, onResultJob, onPriceCommit, onDismissScopeWarning, onPaymentMethodChange, onDropChange, onDiscountChange, onDownPaymentChange, onRendersChange, onOneYearMonthlyChange, onRolloutsConfirmedDone, activeTabId, onTabSelect }: RolloutViewProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [prices, setPrices] = useState<Record<string, number>>({});
  // Effective end price for a calculator: the freshly-entered value, else the
  // one already persisted on the tab (e.g. from a duplicated calculator).
  const effectivePrice = (c: CalculatorTab) => prices[c.id] ?? c.price ?? 0;
  // Fee-adjusted, $200-floored COST/PAR/RETAIL a calculator's rollout LOGS anchor
  // markup on — matches the card tiles (web `calculateMarkup`), not the raw stored
  // `totals`. Used for the confirm-bar `rollout confirmed` log AND the persisted
  // `pricemarkup` (computed here because the hook lacks pricingConfig/plans).
  const logTiersFor = (c: CalculatorTab) =>
    computeLogTiers(c.entries, verticals || [], pricingConfig);
  // A priced calculator whose job scope changed AFTER the price was entered (the live
  // scope no longer matches the snapshot taken at pricing time). Drives the per-calc
  // "Job Scope was changed. Please review the Rollout End Price." warning — the price
  // itself is never cleared. Only fires when a snapshot exists (a price was entered).
  const scopeChangedOf = (c: CalculatorTab) =>
    effectivePrice(c) > 0 && !!c.priceScopeSig && scopeSignature(c.entries || {}) !== c.priceScopeSig;
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
    // Anchor the persisted `pricemarkup` on the `check`-based, floored tiers
    // (web `calculateMarkup`), NOT the raw stored `totals` — same as the logs.
    const tiers = computeLogTiers(calc.entries, verticals || [], pricingConfig);
    // Web parity (ViewAllCalculators.autoConfirmCalculator): fire the `rollout
    // auto-confirmed (10 min inactivity)` rollout log. The manual Confirm bar logs
    // `rollout confirmed` inline, but auto-confirm bypasses that path — so without this
    // an auto-confirmed calculator produced NO confirmation log at all.
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
                // Amber dot flags a tab whose job scope changed after pricing, so the rep
                // can spot which rollout to review without opening each one.
                const needsReview = scopeChangedOf(calc);
                return (
                  <TouchableOpacity key={calc.id} onPress={() => onTabSelect?.(calc.id)} style={{ flexDirection: 'row', alignItems: 'center', height: '100%', paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: isActive ? '#16A34A' : 'transparent' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {hasLockedDrop && (
                        <Ionicons name="lock-closed" size={12} color={isActive ? '#16A34A' : '#94A3B8'} style={{ marginRight: 6 }} />
                      )}
                      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '900', color: isActive ? '#212B36' : '#637381' }}>{calc.title}</Text>
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ maxWidth: 600, alignSelf: 'center', width: '100%' }}>
          {selectedCalc ? (
            <PremiumQuoteCard key={selectedCalc.id} calculator={selectedCalc}
              initialPrice={effectivePrice(selectedCalc)}
              categoryMeta={categoryMeta}
              isLowesLead={isLowesLead}
              leadId={leadId}
              appointmentId={appointmentId}
              pricing={pricing}
              verticals={verticals || []}
              pricingConfig={pricingConfig}
              scopeChanged={scopeChangedOf(selectedCalc)}
              onDismissScopeWarning={() => onDismissScopeWarning?.(selectedCalc.id)}
              onPriceChange={(id, price, pricemarkup) => {
                setPrices((p) => ({ ...p, [id]: price }));
                rolloutLastChangedRef.current = { ...rolloutLastChangedRef.current, [id]: Date.now() };
                // Persist the entered price on the tab so it survives a back-to-calculator
                // edit (and snapshot the scope it was priced against). The hook debounces
                // the save, so per-keystroke calls coalesce. `pricemarkup` is passed only
                // on blur (web parity: persisted alongside the price by handleBlurPrice).
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
              const confirmed = pending.map((c) => ({
                id: c.id,
                price: effectivePrice(c),
                pricemarkup: markupLabel(effectivePrice(c), logTiersFor(c)),
              }));
              // Web parity (ViewAllCalculators.js:1559): one `rollout confirmed`
              // rollout log per calculator being confirmed.
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
              // Just confirm — STAY on the rollout screen. Navigating away here raced
              // the calculators' debounced save (the screen unmounted before the PUT
              // flushed, so the confirmed price could be lost). Once every rollout is
              // confirmed, the "Jobs Built — Back to Tools" button below appears and is
              // the only thing that navigates to the tools menu.
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
    </KeyboardAvoidingView>
  );
}
