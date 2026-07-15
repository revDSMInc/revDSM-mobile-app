import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { CalculatorEntry } from '../types/calculator';
import { DealPricing, DealPlan, PayCategory, planBelowMin, belowMinMsg } from '../hooks/useDealPricing';
import { FlashMessage } from '../../../config/message';

/**
 * The full **Result Lead** outcome modal — a faithful port of the regular deal
 * center's `OutcomeModal` (`src/widgets/modals/DealCenter/OutcomeModal.tsx`): a
 * green-header sheet with a One Leg dropdown, a Result (Demo/Sale) dropdown, the
 * branch-specific fields (demo reason / sale contract-down-balance-payment), a Job
 * Summary card, Versatile/Pineapple toggles, and a "Build Job" action. Reached via
 * the small Sale/Demo chooser in the rollout; confirming proceeds to the job builder.
 */

const ONE_LEG_OPTIONS = ['No', 'MR', 'MRS'];

/**
 * Unit suffix shown before a line-item label (web parity):
 *  - "Number of Screen" is a plain count → NO unit ("3 Number of Screen").
 *  - a "ft" unit (e.g. the Lighting stories) renders as the foot mark "'"
 *    ("5' Lighting 1st Story"), never the word "ft".
 *  - any other field falls back to the foot mark when it has no unit.
 */
const unitOf = (item: { unit?: string; label?: string }) => {
  if (/number\s*of\s*screen|screen/i.test(item.label || '')) return '';
  const unit = (item.unit || '').trim();
  if (!unit || /^ft$/i.test(unit)) return "'";
  return unit;
};

// Same 19 reasons the regular outcome flow uses (ResultViews.tsx demoReasons).
// These stay STATIC intentionally: demo/result reasons have NO backend endpoint
// on either platform — the web hardcodes them everywhere too. Payment plans and
// discount tiers are the only dynamic (backend-driven) data (see useDealPricing).
const DEMO_REASONS = [
  "Can't Afford", 'Didn’t Like', 'DIY', 'Lowes Demo', 'Lowes Pending Sale',
  'Lowes Rehash', 'Moving', 'No Job', 'No Need / Want', 'No Snap Decision',
  'Other Projects', 'Rental Property', 'Rushed - No Time', 'Shop Around',
  'Talk to Spouse', 'Think About It', 'Too Much Money', 'Would Not Commit',
  'Other (Explain)',
];

interface ResultJobModalProps {
  visible?: boolean;
  calculatorTitle?: string;
  resultType?: 'sale' | 'demo' | null;
  /** prefill for the contract price (the rollout end / latest drop price) */
  initialPrice?: number;
  /** entered line items → the Job Summary card */
  entries?: Record<string, CalculatorEntry>;
  isLowesLead?: boolean;
  /** Backend-driven payment plans + discount config (static fallback). */
  pricing: DealPricing;
  onClose?: () => void;
  onConfirm?: (data: {
    resultType: 'sale' | 'demo';
    oneLeg?: string;
    contractPrice?: number;
    downPayment?: number;
    balance?: number;
    downPaymentMethod?: string;
    balancePaymentMethod?: string;
    demoReason?: string;
    reasonExplanation?: string;
    versatile?: boolean;
    pineapple?: boolean;
  }) => void;
}

/** Floating-label helper shared by every field (notched-outline look, web parity). */
function FloatingLabel({ text, error, bg = '#fff' }: { text: string; error?: boolean; bg?: string }) {
  return (
    <Text style={{ position: 'absolute', top: -8, left: 12, zIndex: 10, paddingHorizontal: 4, backgroundColor: bg, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, color: error ? '#EF4444' : '#000' }}>
      {text}
    </Text>
  );
}

/** Dropdown select — options render inline (in-flow) below the box, like the regular. */
function SelectField({ label, value, placeholder, options, onSelect, disabled, capitalize, error }: {
  label: string; value: string; placeholder: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void; disabled?: boolean; capitalize?: boolean; error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: 20, position: 'relative' }}>
      <FloatingLabel text={label} error={error} />
      <TouchableOpacity
        activeOpacity={0.8}
        disabled={disabled}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, borderColor: error ? '#EF4444' : open ? '#1C252E' : '#919EAB33', backgroundColor: disabled ? '#F4F6F8' : '#fff' }}
      >
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: selected ? (disabled ? '#919EAB' : '#1C252E') : '#919EAB', textTransform: capitalize ? 'capitalize' : 'none' }}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name={disabled ? 'lock-closed' : open ? 'chevron-up' : 'chevron-down'} size={18} color="#919EAB" />
      </TouchableOpacity>
      {open && !disabled && (
        <View style={{ borderWidth: 1, borderColor: '#1C252E', borderRadius: 8, backgroundColor: '#F8FAFC', marginTop: 4, overflow: 'hidden' }}>
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <TouchableOpacity
                key={o.value}
                onPress={() => { onSelect(o.value); setOpen(false); }}
                style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#919EAB14', backgroundColor: isSel ? '#F4F6F8' : 'transparent' }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: isSel ? '#1C252E' : '#637381', textTransform: capitalize ? 'capitalize' : 'none' }}>{o.label}</Text>
                {isSel && <Ionicons name="checkmark" size={16} color="#1C252E" />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Categorized balance-payment picker (grouped headers), like the regular outcome modal. */
function BalancePaymentField({ label, value, price, plans, categories, onSelect }: {
  label: string; value: string; price: number;
  plans: Record<string, DealPlan>; categories: PayCategory[]; onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = plans[value]?.label;
  return (
    <View style={{ marginBottom: 20, position: 'relative' }}>
      <FloatingLabel text={label} />
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, borderColor: open ? '#1C252E' : '#919EAB33', backgroundColor: '#fff' }}
      >
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: selectedLabel ? '#1C252E' : '#919EAB' }} numberOfLines={1}>{selectedLabel || 'Select Payment Method'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#919EAB" />
      </TouchableOpacity>
      {open && (
        <View style={{ borderWidth: 1, borderColor: '#1C252E', borderRadius: 8, backgroundColor: '#F8FAFC', marginTop: 4, overflow: 'hidden' }}>
          {categories.map((cat) => (
            <View key={cat.title || 'basic'}>
              {!!cat.title && (
                <View style={{ paddingHorizontal: 16, paddingVertical: 6, backgroundColor: cat.bg }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: cat.text }}>{cat.title}</Text>
                </View>
              )}
              {cat.plans.map((key) => {
                const plan = plans[key];
                if (!plan) return null;
                const belowMin = planBelowMin(plans, key, price);
                const isSel = key === value;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => {
                      if (belowMin) { FlashMessage.warning('Payment plan', belowMinMsg(plans, key, price)); return; }
                      onSelect(key); setOpen(false);
                    }}
                    style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#919EAB14', opacity: belowMin ? 0.5 : 1, backgroundColor: isSel ? '#F4F6F8' : 'transparent' }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: isSel ? '#1C252E' : '#637381' }} numberOfLines={1}>{plan.label}</Text>
                      {belowMin && plan.minPrice ? <Text style={{ fontSize: 10, color: '#0F172A', marginTop: 2 }}>Requires ${plan.minPrice.toLocaleString()}+</Text> : null}
                    </View>
                    {isSel && <Ionicons name="checkmark" size={16} color="#1C252E" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** $-prefixed money input with the floating-label look. */
function MoneyField({ label, value, onChange, editable = true }: {
  label: string; value: string; onChange?: (v: string) => void; editable?: boolean;
}) {
  return (
    <View style={{ marginBottom: 20, position: 'relative' }}>
      <FloatingLabel text={label} />
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#919EAB33', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, backgroundColor: editable ? '#fff' : '#F4F6F8' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', marginRight: 4, color: editable ? '#1C252E' : '#919EAB' }}>$</Text>
        <TextInput
          style={{ flex: 1, fontSize: 13, fontWeight: '600', color: editable ? '#1C252E' : '#919EAB', padding: 0 }}
          value={value}
          editable={editable}
          onChangeText={(t) => onChange?.(t.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          placeholderTextColor="#919EAB"
          keyboardType="numeric"
        />
      </View>
    </View>
  );
}

export function ResultJobModal({
  visible = false,
  calculatorTitle,
  resultType: initialResultType,
  initialPrice,
  entries = {},
  pricing,
  onClose,
  onConfirm,
}: ResultJobModalProps) {
  const [oneLeg, setOneLeg] = useState('No');
  const [resultType, setResultType] = useState<'sale' | 'demo'>(initialResultType || 'sale');
  const [demoReason, setDemoReason] = useState('');
  const [reasonExplanation, setReasonExplanation] = useState('');
  const [contractPrice, setContractPrice] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [downPaymentMethod, setDownPaymentMethod] = useState('');
  const [balancePaymentMethod, setBalancePaymentMethod] = useState('');
  const [versatile, setVersatile] = useState(false);
  const [pineapple, setPineapple] = useState(false);

  // Sync incoming result type + prefill the contract price each time it opens.
  useEffect(() => {
    if (!visible) return;
    setResultType(initialResultType || 'sale');
    setContractPrice(initialPrice && initialPrice > 0 ? String(Math.round(initialPrice)) : '');
    setDownPayment('');
    setDemoReason('');
    setReasonExplanation('');
  }, [visible, initialResultType, initialPrice]);

  const contractNum = parseFloat(contractPrice) || 0;
  const downNum = parseFloat(downPayment) || 0;
  const balance = Math.max(0, contractNum - downNum);

  const items = useMemo(
    () => Object.values(entries).filter((e) => e && e.inputValue > 0) as CalculatorEntry[],
    [entries]
  );

  const buildDisabled =
    !resultType ||
    (resultType === 'demo' && (!demoReason || (demoReason === 'Other (Explain)' && !reasonExplanation.trim()))) ||
    (resultType === 'sale' && !(contractNum > 0));

  const handleBuild = () => {
    if (resultType === 'sale' && downNum > contractNum) {
      FlashMessage.error('Invalid Down Payment', 'Down payment can’t be greater than the contract price.');
      return;
    }
    onConfirm?.({
      resultType,
      oneLeg,
      contractPrice: resultType === 'sale' ? contractNum || undefined : undefined,
      downPayment: resultType === 'sale' ? downNum || undefined : undefined,
      balance: resultType === 'sale' ? balance : undefined,
      downPaymentMethod: downPaymentMethod || undefined,
      balancePaymentMethod: balancePaymentMethod || undefined,
      demoReason: resultType === 'demo' ? demoReason : undefined,
      reasonExplanation: resultType === 'demo' && demoReason === 'Other (Explain)' ? reasonExplanation : undefined,
      versatile,
      pineapple,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, maxHeight: '85%', overflow: 'hidden' }}>
            {/* Header */}
            <View style={{ paddingHorizontal: 20, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#4CBB17' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>Result Lead</Text>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ paddingHorizontal: 20, paddingTop: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {!!calculatorTitle && (
                <View style={{ marginBottom: 20, padding: 12, backgroundColor: '#F4F6F8', borderRadius: 8 }}>
                  <Text style={{ fontSize: 11, color: '#919EAB' }}>Calculator</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#1C252E' }}>{calculatorTitle}</Text>
                </View>
              )}

              <SelectField
                label="One Leg"
                value={oneLeg}
                placeholder="Select One Leg"
                options={ONE_LEG_OPTIONS.map((o) => ({ value: o, label: o }))}
                onSelect={setOneLeg}
              />

              <SelectField
                label="Result"
                value={resultType}
                placeholder="Select Result"
                capitalize
                options={[{ value: 'demo', label: 'Demo' }, { value: 'sale', label: 'Sale' }]}
                onSelect={(v) => setResultType(v as 'sale' | 'demo')}
              />

              {resultType === 'demo' && (
                <>
                  <SelectField
                    label="Reason for Demo"
                    value={demoReason}
                    placeholder="Select Reason for Demo"
                    error={!demoReason}
                    options={DEMO_REASONS.map((r) => ({ value: r, label: r }))}
                    onSelect={setDemoReason}
                  />
                  {demoReason === 'Other (Explain)' && (
                    <View style={{ marginBottom: 20, position: 'relative' }}>
                      <FloatingLabel text="Explain Reason" error={!reasonExplanation.trim()} />
                      <View style={{ borderWidth: 1, borderColor: '#919EAB33', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 80, backgroundColor: '#fff' }}>
                        <TextInput
                          style={{ fontSize: 13, fontWeight: '600', color: '#1C252E', padding: 0, textAlignVertical: 'top' }}
                          value={reasonExplanation}
                          onChangeText={setReasonExplanation}
                          placeholder="Enter details..."
                          placeholderTextColor="#919EAB"
                          multiline
                          numberOfLines={3}
                        />
                      </View>
                    </View>
                  )}
                  <MoneyField label="Last Price Quoted" value={contractPrice} editable={false} />
                </>
              )}

              {resultType === 'sale' && (
                <>
                  <MoneyField label="Original Contract Price" value={contractPrice} editable={false} />
                  <View style={{ borderWidth: 1, borderColor: '#919EAB33', borderRadius: 8, paddingHorizontal: 12, paddingTop: 12, marginBottom: 16 }}>
                    <MoneyField label="Down Payment" value={downPayment} onChange={setDownPayment} />
                    <SelectField
                      label="Payment Method"
                      value={downPaymentMethod}
                      placeholder="Select Payment Method"
                      options={pricing.outcomeDownPaymentMethods}
                      onSelect={setDownPaymentMethod}
                    />
                  </View>
                  <View style={{ borderWidth: 1, borderColor: '#919EAB33', borderRadius: 8, paddingHorizontal: 12, paddingTop: 12, marginBottom: 16 }}>
                    <MoneyField label="Balance" value={String(balance)} editable={false} />
                    <BalancePaymentField
                      label="Payment Method"
                      value={balancePaymentMethod}
                      price={balance}
                      plans={pricing.plans}
                      categories={pricing.categories}
                      onSelect={setBalancePaymentMethod}
                    />
                  </View>
                </>
              )}

              {/* Job Summary */}
              <View style={{ backgroundColor: '#F7F6FD', borderRadius: 16, padding: 16, marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: '#E8E6F8' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                      <Ionicons name="clipboard" size={16} color="#4CBB17" />
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C252E' }}>Job Summary</Text>
                  </View>
                  <View style={{ backgroundColor: '#E5D9FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#6B46C1' }}>{items.length} Item{items.length === 1 ? '' : 's'}</Text>
                  </View>
                </View>
                {items.length === 0 ? (
                  <Text style={{ fontSize: 12, color: '#94A3B8', fontWeight: '600', paddingVertical: 8 }}>No items</Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {items.map((item, i) => (
                      <View key={item.fieldId || i} style={{ backgroundColor: '#fff', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#F4F6F8', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                          <Ionicons name="cube" size={14} color="#637381" />
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#1C252E', flex: 1 }}>
                          {item.inputValue}{unitOf(item)} {item.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Versatile / Pineapple */}
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                <TouchableOpacity onPress={() => setVersatile((v) => !v)} style={{ flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFAB00', opacity: versatile ? 1 : 0.55 }}>
                  <Text style={{ fontWeight: '700', fontSize: 11, color: '#212B36' }}>Versatile</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPineapple((v) => !v)} style={{ flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFAB00', opacity: pineapple ? 1 : 0.55 }}>
                  <Text style={{ fontWeight: '700', fontSize: 11, color: '#212B36' }}>Pineapple</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            {/* Footer — Build Job */}
            <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#919EAB14' }}>
              <TouchableOpacity
                disabled={buildDisabled}
                onPress={handleBuild}
                style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: buildDisabled ? '#919EAB' : '#4CBB17' }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 }}>Build Job</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
