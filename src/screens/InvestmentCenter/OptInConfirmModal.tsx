import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { LinearTransition, FadeOut } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../theme/ThemeProvider';
import {
  MODAL_BLUR_AMOUNT,
  MODAL_SCRIM,
  MODAL_CARD_SHADOW,
} from '../DynamicDealCenter/components/modal-chrome';
import { SwipeDeleteAction } from '../DynamicDealCenter/components/SwipeDeleteAction';
import { formatAmountInput, stripAmount } from '../DynamicDealCenter/utils/format-amount';
import { DealPlan, PayCategory, planLabelOf, planProviderAbbr } from '../DynamicDealCenter/hooks/useDealPricing';
import { NUMERIC_KEYBOARD } from '../../utils/keyboard-type';
import { AddPlanModal } from './AddPlanModal';
import type { MethodBadge, PlanOption } from '../../utils/opt-in-methods';

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

interface Props {
  visible: boolean;
  price: number;
  downPayment?: number;
  /** The down-payment field is the card's own: same text, same show flag, same commit. */
  downText: string;
  showDown: boolean;
  onDownTextChange: (text: string) => void;
  onShowDown: (show: boolean) => void;
  onCommitDown: () => void;
  method?: string;
  /** The basic method always listed as its own row, even after a plan is picked. */
  basicMethodKey?: string;
  badges: readonly MethodBadge[];
  options: readonly PlanOption[];
  plans: Record<string, DealPlan>;
  categories: PayCategory[];
  addedPlanKeys: string[];
  /** Base for the picker's monthly figures and minimum-price checks. */
  addPlanPrice: number;
  onSelectMethod: (key: string) => void;
  onAddPlan: (key: string) => void;
  onRemovePlan: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The In-Home "Secure This Price" popup, laid out like the rollout's `DropOutcomeModal`.
 *
 * ⚠️ IT OWNS NO DEAL STATE. Method, plans and down payment all belong to `InvestmentPanel`, and every
 * control here calls the card's own handler, so the two can never disagree and offline behaves
 * exactly as a tap on the card does. Only `showPicker` is local.
 *
 * ⚠️ `AddPlanModal` is `inline`: an overlay inside this tree, never a second native Modal (CLAUDE.md
 * section 6).
 */
export function OptInConfirmModal({
  visible, price, downPayment, downText, showDown, onDownTextChange, onShowDown, onCommitDown,
  method, basicMethodKey, badges, options, plans, categories, addedPlanKeys, addPlanPrice,
  onSelectMethod, onAddPlan, onRemovePlan, onConfirm, onClose,
}: Props) {
  const { isDark } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  useEffect(() => {
    if (!visible) setShowPicker(false);
  }, [visible]);

  const pick = (key: string) => {
    if (key !== method) onSelectMethod(key);
  };
  const addPlan = (key: string) => {
    setShowPicker(false);
    onAddPlan(key);
  };
  const balance = Math.max(0, (price || 0) - (downPayment || 0));
  const basicSelected = !!basicMethodKey && method === basicMethodKey;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => (showPicker ? setShowPicker(false) : onClose())}
    >
      {/* An inert backdrop, as on the drop popup: this card now holds a form, and a stray tap beside
          a plan row must not cancel the opt-in. The close button and Decline are the ways out. */}
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={isDark ? 'dark' : 'light'}
          blurAmount={MODAL_BLUR_AMOUNT}
          reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
          pointerEvents="none"
        />
        <View style={MODAL_SCRIM} pointerEvents="none" />
        <View style={{ backgroundColor: '#fff', borderRadius: 40, padding: 24, maxHeight: '88%', ...MODAL_CARD_SHADOW }}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="Close"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ position: 'absolute', top: 16, right: 16, zIndex: 2, width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={18} color="#64748B" />
          </TouchableOpacity>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Header: shield + SECURE THIS PRICE + price + method badges */}
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Ionicons name="shield-checkmark" size={24} color="#31D076" />
              </View>
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 2, marginBottom: 8 }}>SECURE THIS PRICE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 34, fontWeight: '900', color: '#1C252E' }}>{fmt(price)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {badges.map((b) => {
                    const sel = method === b.key;
                    return (
                      <TouchableOpacity
                        key={b.key}
                        onPress={() => pick(b.key)}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 2, borderColor: sel ? '#31D076' : '#E2E8F0', backgroundColor: sel ? '#31D076' : '#fff' }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '900', color: sel ? '#fff' : '#94A3B8' }}>{b.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Add Down Payment, then Down Payment + Balance */}
            {showDown ? (
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                <View style={{ flex: 1, backgroundColor: '#fff', borderWidth: 2, borderColor: '#0F172A', borderRadius: 16, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 }}>
                  <Text style={{ position: 'absolute', top: -8, left: 12, backgroundColor: '#fff', paddingHorizontal: 4, fontSize: 10, fontWeight: '900', color: '#0F172A' }}>Down Payment</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A', marginRight: 4 }}>$</Text>
                    <TextInput
                      style={{ flex: 1, fontSize: 16, fontWeight: '900', color: '#0F172A', padding: 0 }}
                      value={formatAmountInput(downText)}
                      onChangeText={(t) => onDownTextChange(stripAmount(t))}
                      onEndEditing={onCommitDown}
                      onBlur={onCommitDown}
                      placeholder="0"
                      placeholderTextColor="#94A3B8"
                      keyboardType={NUMERIC_KEYBOARD}
                      returnKeyType="done"
                    />
                  </View>
                </View>
                <View style={{ flex: 1, backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#F1F5F9', borderRadius: 16, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, opacity: 0.7 }}>
                  <Text style={{ position: 'absolute', top: -8, left: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 4, fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>Balance</Text>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: '#94A3B8' }}>{fmt(balance)}</Text>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => onShowDown(true)} style={{ alignSelf: 'center', marginBottom: 24, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E2E8F0', borderRadius: 16, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="add" size={16} color="#919EAB" />
                <Text style={{ marginLeft: 4, fontSize: 14, fontWeight: '700', color: '#919EAB' }}>Add Down Payment</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 1, backgroundColor: '#F1F5F9', width: '100%', marginBottom: 20 }} />

            <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>Monthly Options</Text>

            {!!basicMethodKey && (
              <TouchableOpacity
                onPress={() => pick(basicMethodKey)}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityState={{ selected: basicSelected }}
                style={{ marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 2, borderColor: basicSelected ? '#31D076' : '#F1F5F9', backgroundColor: basicSelected ? '#fff' : '#F8FAFC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <View style={{ flex: 1, marginRight: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: basicSelected ? '#0F172A' : '#94A3B8', marginRight: 6 }}>{planLabelOf(plans, basicMethodKey)}</Text>
                  {basicSelected && <SelectedTag />}
                </View>
                <Radio on={basicSelected} />
              </TouchableOpacity>
            )}

            {/* ⚠️ A bare <GestureHandlerRootView> gets `flex: 1` from the library, which lets this list
                grow inside the ScrollView. It exists only to give `Swipeable` a root in this native
                tree. Do NOT drop the style prop. */}
            <GestureHandlerRootView style={{ flexGrow: 0, flexShrink: 0, width: '100%' }}>
              {options.map((p) => {
                const plan = plans[p.key];
                const sel = method === p.key;
                const abbr = planProviderAbbr(plan, p.key);
                const name = plan?.label?.split('(')[0]?.trim() || p.terms;
                return (
                  <Animated.View key={p.key} layout={LinearTransition} exiting={FadeOut}>
                    <Swipeable
                      renderRightActions={(_prog, drag) => <SwipeDeleteAction drag={drag} onDelete={() => onRemovePlan(p.key)} />}
                      rightThreshold={40}
                      onSwipeableWillOpen={() => onRemovePlan(p.key)}
                    >
                      <TouchableOpacity
                        onPress={() => pick(p.key)}
                        activeOpacity={0.9}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        style={{ marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 2, borderColor: sel ? '#31D076' : '#F1F5F9', backgroundColor: sel ? '#fff' : '#F8FAFC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            {!!abbr && (
                              <View style={{ backgroundColor: sel ? '#0F172A' : '#CBD5E1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginRight: 6 }}>
                                <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>{abbr}</Text>
                              </View>
                            )}
                            <Text numberOfLines={2} style={{ flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8' }}>{name}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                            <Text style={{ fontSize: 20, fontWeight: '900', color: sel ? '#0F172A' : '#94A3B8' }}>{fmt(p.monthly)}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginLeft: 2 }}>/mo</Text>
                            {sel && <View style={{ marginLeft: 10, alignSelf: 'center' }}><SelectedTag /></View>}
                          </View>
                        </View>
                        <Radio on={sel} />
                      </TouchableOpacity>
                    </Swipeable>
                  </Animated.View>
                );
              })}
            </GestureHandlerRootView>

            <TouchableOpacity onPress={() => setShowPicker(true)} style={{ height: 52, borderWidth: 2, borderStyle: 'dashed', borderColor: '#31D076', borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0FDF4', marginBottom: 20 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#31D076' }}>+ Add Plan</Text>
            </TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={onClose} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onConfirm} style={{ flex: 1, height: 52, borderRadius: 16, backgroundColor: '#31D076', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff' }}>Secure This Price</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
        <AddPlanModal
          inline
          visible={showPicker}
          price={addPlanPrice}
          plans={plans}
          categories={categories}
          added={addedPlanKeys}
          onAdd={addPlan}
          onClose={() => setShowPicker(false)}
        />
      </View>
    </Modal>
  );
}

function SelectedTag() {
  return (
    <View style={{ backgroundColor: '#31D076', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff' }}>SELECTED</Text>
    </View>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: on ? '#31D076' : '#E2E8F0', backgroundColor: on ? '#fff' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
      {on && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#31D076' }} />}
    </View>
  );
}
