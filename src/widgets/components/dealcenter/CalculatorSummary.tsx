import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, SharedValue } from 'react-native-reanimated';
import { paymentPlans } from '../../../utils/calculator/payment-plans';
import {
  validatePriceForPaymentMethod,
  WELLS_FARGO_HIGH_KEYS,
  WF_HIGH_MIN_PRICE,
} from '../../../utils/calculator/payment-method-validation';
import {
  getRolloutPaymentCategories,
  getDropAddPlanCategories,
  isPlanBelowMinPrice,
  getBelowMinMessage,
} from '../../../utils/calculator/lowes-payment-util';
import Feather from 'react-native-vector-icons/Feather';
import { PALETTE } from '../../../theme/theme';
import Doc from '../../../assets/svgs/icons/doc';
import JobService from '../../../services/api/JobService';
import { LeadService } from '../../../services/api/leads';

import { useCalculatorSummary } from '../../../hooks/useCalculatorSummary';
import { useTheme } from '../../../theme/ThemeProvider';
import { BlurView } from '@react-native-community/blur';

const getOrdinal = (n: number) => {
  const j = n % 10,
    k = n % 100;
  if (j === 1 && k !== 11) return n + 'st';
  if (j === 2 && k !== 12) return n + 'nd';
  if (j === 3 && k !== 13) return n + 'rd';
  return n + 'th';
};

const alpha = (hex: string, opacity: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export const CalculatorSummary = ({
  activeCalc,
  results,
  calculators,
  setCalculators,
  setActiveIdx,
  activeIdx,
  setCurrentView,
  openPicker,
  handleStatusSelect,
  updateActive,
  handleSave,
  insets,
  refresh,
  onClose,
  handleAddJobToTracker,
  onGoToTracker,
  isAlreadyInTracker,
  lead,
  jobBuilderState,
  handleResetJobBuilder,
}: any) => {
  const { colors, isDark } = useTheme();
  const isLowesLead = lead?.lowesLead === true;
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);

  const rolloutEndPrice = Number(activeCalc.price) || 0;

  const handlePaymentPlanSelect = (method: string) => {
    const oldMethod = activeCalc.inputs.paymentPlan;
    const currentPrice = rolloutEndPrice;
    const isConfirmedWithPrice = !!activeCalc.isRolloutConfirmed && currentPrice > 0;

    if (WELLS_FARGO_HIGH_KEYS.includes(method) && currentPrice > 0 && currentPrice < WF_HIGH_MIN_PRICE) {
      Alert.alert(
        'Payment plan',
        `Payment plan changed — this Wells Fargo plan requires a minimum end price of $${WF_HIGH_MIN_PRICE.toLocaleString()}. Please update the end price.`
      );
    } else if (isConfirmedWithPrice && method !== oldMethod) {
      Alert.alert(
        'Payment plan',
        `Payment method updated — the rollout price $${currentPrice.toLocaleString()} is already confirmed.`
      );
    }

    if (isPlanBelowMinPrice(method, currentPrice)) {
      Alert.alert('Payment plan', getBelowMinMessage(method, currentPrice));
      return;
    }
    const methodValidation = validatePriceForPaymentMethod(currentPrice, method);
    if (currentPrice > 0 && !methodValidation.isValid) {
      Alert.alert('Payment plan', methodValidation.message);
      return;
    }

    updateActive({ inputs: { paymentPlan: method } });
    handleSave();
    setShowPaymentPicker(false);
  };
  const dpInputRef = useRef<TextInput>(null);
  const {
    error,
    setError,
    isConfirming,
    showResultModal,
    setShowResultModal,
    showDropModal,
    setShowDropModal,
    showDropInput,
    setShowDropInput,
    selectedPlan,
    setSelectedPlan,
    isPlanPickerVisible,
    setIsPlanPickerVisible,
    dropValue,
    setDropValue,
    currentDiscount,
    setCurrentDiscount,
    handleAddDrop,
    handleUnselectDrop,
    handlePriceChange,
    handlePriceBlur,
    priceText,
    handleConfirmAll,
    calculateMonthly,
    handleDiscountChange,
    displayDrop,
    setDisplayDrop,
    downPayment,
    setDownPayment,
    showDownPaymentInput,
    setShowDownPaymentInput,
    addedPlans,
    setAddedPlans,
    tempPlan,
    setTempPlan,
  } = useCalculatorSummary(
    activeCalc,
    results,
    calculators,
    updateActive,
    handleSave,
    refresh,
    isLowesLead,
    setCalculators
  );

  const isSaved = Number(activeCalc.price) > 0;
  const screensCount = Number(activeCalc.inputs.ckToInstallers) || 0;
  const endPrice = Number(activeCalc.price) || 0;

  // Source of truth: jobBuilderState is freshly fetched from the API via useDealOutcome,
  // matching the actual lead payload: lead.jobBuilder.status === 'submitted' && lead.jobBuilder.calculatorId
  // We prioritize the API-fetched jobBuilderState to avoid stale data from the lead object.
  const isJobBuilderSubmitted = jobBuilderState?.status === 'submitted' || lead?.jobBuilder?.status === 'submitted';

  // If endPrice is 0, use results.total (Retail) as the base.
  // Note: results.total already includes screens, so we don't add them again in the fallback case.
  const activeDrop =
    (activeCalc.dropPrice || []).length > 0
      ? activeCalc.dropPrice[activeCalc.dropPrice.length - 1]
      : null;
  const effectiveEndPrice = activeDrop ? activeDrop.dropedPrice : endPrice;
  const priceWithScreens =
    (effectiveEndPrice > 0 ? effectiveEndPrice : results.total) + screensCount * 75;

  const msrp = priceWithScreens / (1 - (currentDiscount + 10) / 100);
  const srVetDiscount = msrp * 0.1;
  const preOrderDiscountVal = msrp * (currentDiscount / 100);
  const oneYearGrandTotal = msrp - srVetDiscount;
  const preOrderGrandTotal = msrp - srVetDiscount - preOrderDiscountVal;

  const confirmedCount = calculators.filter((c: any) => c.price > 0).length;
  const totalCount = calculators.length;
  const progressPct = (confirmedCount / totalCount) * 100;
  const allCalculatorsConfirmed = calculators.every((c: any) => c.price > 0);

  const isDuplicate = calculators.some((c: any, idx: number) => {
    if (idx === activeIdx) return false;
    const sameGutter =
      c.inputs?.gutter5DsE === activeCalc.inputs?.gutter5DsE &&
      c.inputs?.gutter6Ft1 === activeCalc.inputs?.gutter6Ft1 &&
      c.inputs?.gutter7DsE === activeCalc.inputs?.gutter7DsE;
    const samePlan = c.inputs?.paymentPlan === activeCalc.inputs?.paymentPlan;
    const sameMarkup = c.inputs?.markup === activeCalc.inputs?.markup;
    return sameGutter && samePlan && sameMarkup;
  });
  const scrollViewRef = useRef<ScrollView>(null);

  const fCurrency = (num: number) => `$${Math.round(num).toLocaleString()}`;

  const getPlanCategory = (planKey: string) => {
    if (!planKey || planKey === 'check' || planKey === 'mcVisaDscvr' || planKey === 'amex')
      return 'Basic Options';
    if (planKey.startsWith('greensky')) return 'GreenSky Plans';
    if (['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'].includes(planKey))
      return 'Wells Fargo High (>$7,500)';
    if (planKey.startsWith('wf')) return 'Wells Fargo Plans';
    if (planKey === 'concora') return 'Concora Credit';
    return 'Payment Method';
  };

  useEffect(() => {
    if (showDropInput) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [showDropInput]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View className="flex-1 bg-background">
        {/* Top Header & Tabs */}
        <View className="px-5 pt-4 pb-2 border-b border-border bg-card flex-row items-center">
          <TouchableOpacity
            onPress={() => setCurrentView('form')}
            className="p-2 mr-3 items-center justify-center border border-border rounded-xl bg-card shadow-sm"
          >
            <Feather name="arrow-left" size={18} color={colors.text} />
          </TouchableOpacity>

          <View
            className={`flex-1 flex-row items-center ${calculators.length > 1 ? 'h-10' : 'h-12'}`}
          >
            {calculators.length <= 3 ? (
              <View className="flex-1 flex-row">
                {calculators.map((calc: any, idx: number) => {
                  const isLocked = !!calc.dropPrice?.find((d: any) => d.status === 'accepted');
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setActiveIdx(idx)}
                      className={`flex-1 flex-row items-center justify-center h-full border-b-2 ${idx === activeIdx ? 'border-green-500' : 'border-transparent'
                        }`}
                    >
                      {isLocked && (
                        <Ionicons
                          name="lock-closed"
                          size={10}
                          color={idx === activeIdx ? '#16A34A' : '#94A3B8'}
                          style={{ marginRight: 4 }}
                        />
                      )}
                      <Text
                        numberOfLines={1}
                        className={`font-black  ${calculators.length > 1 ? 'text-[10px]' : 'text-sm'
                          } ${idx === activeIdx ? 'text-text-primary' : 'text-text-secondary'}`}
                      >
                        {calc.name || `R${idx + 1}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
                {calculators.map((calc: any, idx: number) => {
                  const isLocked = !!calc.dropPrice?.find((d: any) => d.status === 'accepted');
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setActiveIdx(idx)}
                      className={`flex-row items-center h-full px-4 border-b-2 ${idx === activeIdx ? 'border-green-500' : 'border-transparent'
                        }`}
                    >
                      <View className="flex-row items-center">
                        {isLocked && (
                          <Ionicons
                            name="lock-closed"
                            size={12}
                            color={idx === activeIdx ? '#16A34A' : '#94A3B8'}
                            style={{ marginRight: 6 }}
                          />
                        )}
                        <Text
                          className={`text-sm font-black  ${idx === activeIdx ? 'text-text-primary' : 'text-text-secondary'
                            }`}
                        >
                          {calc.name || `Rollout ${idx + 1}`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-5 py-6">
            <View
              className={`bg-card rounded-3xl p-5 border-2 ${isSaved ? 'border-green-500 bg-green-500/10' : 'border-border'
                }`}
            >
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-xs font-semibold text-text-primary">{activeCalc.name}</Text>
                {activeCalc.isRolloutConfirmed ? (
                  <View className="bg-green-600 px-2 py-1 rounded-md flex-row items-center">
                    <Ionicons name="lock-closed" size={10} color="white" />
                    <Text className="text-[10px] font-black text-white  ml-1">Confirmed</Text>
                  </View>
                ) : (
                  !isSaved && (
                    <View className="bg-[#FF990F] px-1 py-1 rounded-md">
                      <Text className="text-[10px] font-semibold text-white">Required</Text>
                    </View>
                  )
                )}
              </View>

              <View className="mb-6">
                <View className="flex-row items-center gap-6 mb-5">
                  <Text className="text-sm font-medium text-text-primary">Payment Method</Text>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-xs text-text-secondary">Set as Default</Text>
                    <View className="w-8 h-5 bg-green-500 rounded-full items-end justify-center px-1">
                      <View className="w-3 h-3 bg-white rounded-full" />
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => !isJobBuilderSubmitted && setShowPaymentPicker(true)}
                  disabled={isJobBuilderSubmitted}
                  className="min-h-[56px] bg-card border border-border rounded-2xl px-4 py-3 flex-row items-center justify-between shadow-sm"
                >
                  <View className="flex-1 pr-4">
                    <Text className="text-[8px] font-black text-text-secondary  tracking-widest mb-0.5">
                      {getPlanCategory(activeCalc.inputs.paymentPlan)}
                    </Text>
                    <Text className="text-sm font-black text-text-primary">
                      {paymentPlans[activeCalc.inputs.paymentPlan]?.label || 'Check (0% Fee)'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={16} color="#637381" />
                </TouchableOpacity>
              </View>

              <View className="mb-6 bg-[#F8F7FF] rounded-[32px] border border-[#E5D9FF] p-5">
                <View className="flex-row items-center justify-end mb-4">
                  <View className="bg-[#E5D9FF] px-4 py-2 rounded-xl">
                    <Text className="text-[12px] font-extrabold text-[#6B46C1] tracking-wider">
                      {results.items.length} items
                    </Text>
                  </View>
                </View>

                <View className="flex-row flex-wrap gap-2 mb-4">
                  {Array.from(
                    new Set(results.items.map((i: any) => i.category || 'Additional Services'))
                  ).map((category: any) => {
                    const categoryStyles: Record<
                      string,
                      { color: string; icon: string; bg: string }
                    > = {
                      Gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
                      LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
                      Soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
                      Fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
                      Lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
                      'Additional Services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
                      Miscellaneous: { color: '#FFAB00', icon: 'ellipsis-horizontal-circle', bg: '#FFF8E6' },
                    };
                    const style = categoryStyles[category] || {
                      color: '#637381',
                      icon: 'list',
                      bg: '#F4F6F8',
                    };

                    return (
                      <View
                        key={category}
                        className="flex-row items-center px-3 py-1.5 rounded-full"
                        style={{ backgroundColor: style.bg }}
                      >
                        <Ionicons name={style.icon} size={12} color={style.color} />
                        <Text
                          className="ml-1.5 text-[10px] font-black tracking-tight"
                          style={{ color: style.color }}
                        >
                          {category}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                <View className="gap-3">
                  {results.items.map((item: any, i: number) => {
                    const categoryStyles: Record<
                      string,
                      { color: string; icon: string; bg: string }
                    > = {
                      Gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
                      LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
                      Soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
                      Fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
                      Lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
                      'Additional Services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
                      Miscellaneous: { color: '#FFAB00', icon: 'ellipsis-horizontal-circle', bg: '#FFF8E6' },
                    };
                    const style = categoryStyles[item.category] || {
                      color: '#637381',
                      icon: 'list',
                      bg: '#F4F6F8',
                    };

                    return (
                      <View
                        key={i}
                        className="flex-row items-center bg-white rounded-2xl p-4 shadow-sm border border-[#F4F6F8]"
                      >
                        <View
                          className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                          style={{ backgroundColor: style.bg }}
                        >
                          <Ionicons name={style.icon} size={18} color={style.color} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-bold text-[#1C252E]">
                            {item.value}
                            {item.unit || "'"} {item.label}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row gap-2 mb-6">
                {[
                  { label: 'Cost', value: results.price50 },
                  { label: 'Par', value: results.price65 },
                  { label: 'Retail', value: results.price100 },
                ].map((tier, i) => (
                  <View
                    key={i}
                    className="flex-1 bg-card border border-border rounded-xl px-3 py-2.5 items-center shadow-sm"
                  >
                    <Text className="text-[9px] font-black text-text-secondary uppercase tracking-widest mb-1">
                      {tier.label}
                    </Text>
                    <Text className="text-sm font-black text-text-primary">
                      ${Math.round(tier.value).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>

              <View>
                <Text
                  className={`text-[10px] font-black  mb-2 ml-1 tracking-widest ${isSaved ? 'text-green-600' : 'text-amber-500'
                    }`}
                >
                  Rollout End Price
                </Text>
                <View
                  className={`flex-row items-center bg-card border rounded-2xl px-4 h-16 shadow-sm ${error
                    ? 'border-red-500'
                    : activeDrop
                      ? 'border-green-500'
                      : isSaved
                        ? 'border-green-500'
                        : 'border-border'
                    }`}
                >
                  <Text
                    className={`text-xl font-black mr-2 ${activeDrop || isSaved ? 'text-green-600' : 'text-text-secondary'
                      }`}
                  >
                    $
                  </Text>
                  <TextInput
                    className={`flex-1 font-black text-lg ${activeDrop || activeCalc.isRolloutConfirmed
                      ? 'text-green-600'
                      : 'text-text-primary'
                      }`}
                    value={activeDrop || activeCalc.isRolloutConfirmed ? String(effectiveEndPrice || '') : priceText}
                    placeholder="Enter End Price"
                    placeholderTextColor="#919EAB"
                    keyboardType="numeric"
                    editable={!activeCalc.isRolloutConfirmed && !activeDrop && !isJobBuilderSubmitted}
                    onChangeText={handlePriceChange}
                    onEndEditing={handlePriceBlur}
                  />
                  {activeDrop || activeCalc.isRolloutConfirmed ? (
                    <View className="flex-row items-center bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                      <Ionicons name="lock-closed" size={12} color="#16A34A" />
                      <Text className="text-[10px] font-black text-green-600  ml-1.5 tracking-wider">
                        LOCKED
                      </Text>
                    </View>
                  ) : null}
                </View>
                {error && !showDropInput && (
                  <Text className="text-[10px] font-bold text-red-500 mt-2 ml-1 ">{error}</Text>
                )}
              </View>


            </View>

            {/* New Result Section - Only show when price is entered and NOT confirmed */}
            {endPrice > 0 && !error && !activeCalc.isRolloutConfirmed && (
              <View className="mt-8">
                {/* Target Price Card */}
                <View className="bg-card rounded-3xl border border-border shadow-sm overflow-hidden mb-6">
                  <View className="flex-row">
                    <View className="flex-1 py-6 items-center border-r border-border">
                      <Text className="text-[10px] font-bold text-text-secondary  mb-1">
                        End Price w/ Screens
                      </Text>
                      <Text className="text-3xl font-black text-green-600">
                        {fCurrency(priceWithScreens)}
                      </Text>
                    </View>
                    <View className="flex-1 p-5 justify-center">
                      <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-[10px] font-bold text-text-secondary ">
                          Pre Order {'\n'} Discount
                        </Text>
                        <View className="flex-row items-center">
                          <Text className="text-[8px] font-bold text-text-secondary mr-1 ">
                            Default
                          </Text>
                          <TouchableOpacity
                            onPress={() =>
                              updateActive({
                                inputs: {
                                  isDefaultDiscount: !activeCalc.inputs.isDefaultDiscount,
                                },
                              })
                            }
                            className={`w-7 h-4 rounded-full items-center justify-center px-0.5 ${activeCalc.inputs.isDefaultDiscount
                              ? 'bg-green-500 items-end'
                              : 'bg-surface items-start'
                              }`}
                          >
                            <View className="w-3 h-3 bg-card rounded-full" />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View className="flex-row gap-2">
                        {[15, 20, 25].map((d) => (
                          <TouchableOpacity
                            key={d}
                            onPress={() => handleDiscountChange(d)}
                            className={`flex-1 h-10 rounded-xl items-center justify-center border ${currentDiscount === d
                              ? 'bg-green-500/10 border-green-500/20'
                              : 'bg-card border-border'
                              }`}
                          >
                            <Text
                              className={`text-xs font-black ${currentDiscount === d ? 'text-green-600' : 'text-text-secondary'
                                }`}
                            >
                              {d}%
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>
                </View>

                <View className="border border-[#919EAB33] rounded-3xl p-5 mb-6">
                  <Text className="text-[10px] font-black text-black  text-center tracking-widest">
                    MSRP
                  </Text>
                  <Text className="text-xl font-black text-[#4CAF50] mb-2 text-center">
                    {fCurrency(msrp)}
                  </Text>
                </View>

                {/* Comparison Boxes */}
                <View className="flex-row gap-4 mb-6">
                  {/* 1 Year Program */}
                  <View className="flex-1 bg-card rounded-3xl border border-border p-5 shadow-sm">
                    <Text className="text-xs font-black text-text-primary mb-6  tracking-wider">
                      1 Year Program
                    </Text>

                    <View className="flex-row justify-between mb-3">
                      <Text className="text-xs font-medium text-text-secondary">Total</Text>
                      <Text className="text-xs font-black text-text-primary">
                        {fCurrency(msrp)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between mb-6 pb-6 border-b border-border">
                      <Text className="text-xs font-medium text-green-600">10% Sr + Vet</Text>
                      <Text className="text-xs font-black text-green-600">
                        -{fCurrency(srVetDiscount)}
                      </Text>
                    </View>

                    <View className="flex-row justify-between">
                      <Text className="text-xs font-black text-text-secondary ">Grand Total</Text>
                      <Text className="text-sm font-black text-text-primary">
                        {fCurrency(oneYearGrandTotal)}
                      </Text>
                    </View>
                  </View>

                  {/* In Home Pre Order */}
                  <View className="flex-1 bg-card rounded-3xl border-2 border-green-500 p-5 shadow-sm overflow-hidden">
                    <View className="absolute top-0 left-0 right-0 h-10 bg-green-500 items-center justify-center">
                      <Text className="text-[10px] font-black text-white  tracking-widest">
                        In Home Pre Order
                      </Text>
                    </View>
                    <View className="mt-8">
                      <View className="flex-row justify-between mb-2">
                        <Text className="text-[10px] font-medium text-text-secondary">Total</Text>
                        <Text className="text-[10px] font-black text-text-primary">
                          {fCurrency(msrp)}
                        </Text>
                      </View>
                      <View className="flex-row justify-between mb-2">
                        <Text className="text-[10px] font-medium text-green-600">10% Sr + Vet</Text>
                        <Text className="text-[10px] font-black text-green-600">
                          -{fCurrency(srVetDiscount)}
                        </Text>
                      </View>
                      <View className="flex-row justify-between mb-4 pb-4 border-b border-border">
                        <Text className="text-[10px] font-medium text-green-600">
                          {currentDiscount}% Discount
                        </Text>
                        <Text className="text-[10px] font-black text-green-600">
                          -{fCurrency(preOrderDiscountVal)}
                        </Text>
                      </View>

                      <View className="flex-row justify-between mb-4">
                        <Text className="text-[10px] font-black text-text-secondary ">
                          Grand total
                        </Text>
                        <Text className="text-base font-black text-green-600">
                          {fCurrency(preOrderGrandTotal)}
                        </Text>
                      </View>

                      <View className="items-center">
                        <Text className="text-lg font-black text-blue-400 mb-1">
                          {fCurrency(calculateMonthly(preOrderGrandTotal))}/mo
                        </Text>
                        <Text className="text-[8px] text-text-secondary text-center px-2">
                          {paymentPlans[activeCalc.inputs.paymentPlan]?.label ||
                            '1019 (12 months no interest option)'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            )}

            {/* Locked State View (Summary only) */}
            {activeCalc.isRolloutConfirmed && (
              <View className="mt-8">
                {/* Installers Check */}
                <View className="bg-white border border-slate-100 rounded-2xl p-4 flex-row justify-between items-center shadow-sm mb-6">
                  <Text className="text-xs font-bold text-slate-800">
                    Check to installers (screens)
                  </Text>
                  <Text className="text-lg font-black text-green-600">
                    {fCurrency(screensCount * 75)}
                  </Text>
                </View>

                {/* <View className="bg-green-500/10 rounded-3xl p-6 border border-green-500/20 items-center mb-8">
                  <Text className="text-sm font-black text-green-600  tracking-widest mb-2">
                    Final Secured Price
                  </Text>
                  <Text className="text-5xl font-black text-green-700">
                    {fCurrency(activeCalc.price)}
                  </Text>
                </View> */}

                {/* Drops List and Input positioned below the main card */}
                {activeCalc.dropPrice && activeCalc.dropPrice.length > 0 && (
                  <View className="mt-8">
                    {activeCalc.dropPrice.map((drop: any, idx: number) => {
                      const isSecured = drop.status === 'accepted';
                      return (
                        <View key={idx} className="mb-6">
                          <View className="flex-row items-center justify-between mb-2 px-1">
                            <View className="flex-row items-center">
                              <Text className="text-[11px] font-black text-green-600 mr-2  tracking-tight">
                                {getOrdinal(idx + 1)} Dropped Price
                              </Text>
                              {isSecured && (
                                <View className="bg-green-600 px-2 py-0.5 rounded-md">
                                  <Text className="text-[8px] font-black text-white ">
                                    ✓ SECURED
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View className="flex-row items-center gap-4">
                              <TouchableOpacity onPress={() => setDisplayDrop(drop)}>
                                <Text
                                  className={`text-[11px] font-bold ${isSecured ? 'text-green-600' : 'text-slate-500'
                                    }`}
                                >
                                  View
                                </Text>
                              </TouchableOpacity>
                              {isSecured && (
                                <TouchableOpacity onPress={() => handleUnselectDrop(idx)}>
                                  <Text className="text-[11px] font-bold text-orange-500">
                                    Unselect
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>

                          <View
                            className={`bg-white border-2 rounded-xl p-3 flex-row items-center justify-between ${isSecured ? 'border-green-500' : 'border-slate-200'
                              }`}
                          >
                            <Text
                              className={`text-xl font-black ${isSecured ? 'text-green-600' : 'text-slate-400'
                                }`}
                            >
                              {fCurrency(drop.dropedPrice)}
                            </Text>
                            <View className="flex-row items-center gap-4">
                              <TouchableOpacity
                                onPress={() => setDisplayDrop(drop)}
                                className={`px-6 py-2 rounded-lg ${isSecured ? 'bg-[#22C55E]' : 'bg-slate-200'
                                  }`}
                              >
                                <Text
                                  className={`text-xs font-black ${isSecured ? 'text-white' : 'text-slate-500'
                                    }`}
                                >
                                  Display
                                </Text>
                              </TouchableOpacity>
                              <Text
                                className={`text-[10px] font-black  ${isSecured ? 'text-green-600' : 'text-slate-400'
                                  }`}
                              >
                                {isSecured ? 'SECURED' : 'LOCKED'}
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Inline Drop Input */}
                {showDropInput && (
                  <View className="mt-2 mb-6">
                    <View className="bg-[#F4F6F8] border border-border rounded-xl px-4 h-14 flex-row items-center">
                      <Text className="text-slate-400 font-bold mr-2">$</Text>
                      <TextInput
                        className="flex-1 text-slate-900 font-bold text-sm"
                        placeholder="Enter price..."
                        placeholderTextColor="#919EAB"
                        keyboardType="numeric"
                        autoFocus
                        value={dropValue}
                        onChangeText={(v) => {
                          setDropValue(v);
                          if (error) setError(null);
                        }}
                        onSubmitEditing={() => {
                          const num = Number(dropValue.replace(/[^0-9.]/g, ''));
                          const costPrice = Math.round(results.price50);
                          const endPrice = Number(activeCalc.price) || 0;

                          if (num > 0) {
                            if (num < costPrice) {
                              setError(
                                `Drop price cannot be less than cost ($${costPrice.toLocaleString()})`
                              );
                              return;
                            }
                            if (endPrice > 0 && num > endPrice) {
                              setError(
                                `Drop price cannot exceed rollout end price ($${endPrice.toLocaleString()})`
                              );
                              return;
                            }
                            if (!selectedPlan) {
                              const initialPlan = isLowesLead
                                ? activeCalc.inputs.paymentPlan?.startsWith('lowes')
                                  ? activeCalc.inputs.paymentPlan
                                  : 'lowes_ach'
                                : activeCalc.inputs.paymentPlan;
                              setSelectedPlan(initialPlan);
                              if (!addedPlans.includes(initialPlan)) {
                                setAddedPlans([initialPlan]);
                              }
                            }
                            setShowDropModal(true);
                            setShowDropInput(false);
                          }
                        }}
                      />
                    </View>
                    {error && (
                      <View className="bg-red-50 p-2 rounded-lg mt-2 ml-1 border border-red-100">
                        <Text className="text-[10px] font-bold text-red-500">{error}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Bottom Action Buttons per Screenshot */}
                <View className="flex-row gap-4 mb-20">
                  {/* Drop button — disabled when job builder has been submitted */}
                  <TouchableOpacity
                    disabled={isJobBuilderSubmitted}
                    onPress={() => {
                      if (showDropInput) {
                        const num = Number(dropValue.replace(/[^0-9.]/g, ''));
                        const costPrice = Math.round(results.price50);
                        const endPrice = Number(activeCalc.price) || 0;

                        if (num > 0) {
                          if (num < costPrice) {
                            setError(
                              `Drop price cannot be less than cost ($${costPrice.toLocaleString()})`
                            );
                            return;
                          }
                          if (endPrice > 0 && num > endPrice) {
                            setError(
                              `Drop price cannot exceed rollout end price ($${endPrice.toLocaleString()})`
                            );
                            return;
                          }
                          if (!selectedPlan) {
                            const initialPlan = isLowesLead
                              ? activeCalc.inputs.paymentPlan?.startsWith('lowes')
                                ? activeCalc.inputs.paymentPlan
                                : 'lowes_ach'
                              : activeCalc.inputs.paymentPlan;
                            setSelectedPlan(initialPlan);
                            if (!addedPlans.includes(initialPlan)) {
                              setAddedPlans([initialPlan]);
                            }
                          }
                          setShowDropModal(true);
                          setShowDropInput(false);
                        }
                      } else {
                        setDropValue('');
                        setShowDropInput(true);
                        if (error) setError(null);
                      }
                    }}
                    className="flex-1 h-14 rounded-2xl items-center justify-center border-2"
                    style={{
                      borderColor: isJobBuilderSubmitted ? '#CBD5E1' : '#1976D2',
                      backgroundColor: isJobBuilderSubmitted ? '#F1F5F9' : 'white',
                      opacity: isJobBuilderSubmitted ? 0.5 : 1,
                    }}
                  >
                    <Text
                      style={{ color: isJobBuilderSubmitted ? '#94A3B8' : '#1976D2' }}
                      className="font-black text-xs"
                    >
                      {`+ ${getOrdinal((activeCalc.dropPrice?.length || 0) + 1)} Drop`}
                    </Text>
                  </TouchableOpacity>

                  {/* Result Lead / Reset Job Builder */}
                  {isJobBuilderSubmitted ? (
                    <TouchableOpacity
                      onPress={handleResetJobBuilder}
                      className="flex-1 h-14 rounded-2xl items-center justify-center flex-row"
                      style={{ backgroundColor: '#EF4444' }}
                    >
                      <Ionicons name="refresh" size={16} color="white" />
                      <Text className="text-white font-black text-xs ml-2">Reset Job Builder</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowResultModal(true)}
                      className="flex-1 h-14 bg-white border-2 border-orange-500 rounded-2xl items-center justify-center"
                    >
                      <View className="flex-row items-center">
                        <Ionicons name="document-text-outline" size={16} color="orange" />
                        <Text className="text-orange-600 font-black text-xs ml-2">Result Lead</Text>
                      </View>
                      <Text className="text-orange-600 font-black text-sm">
                        {fCurrency(
                          activeCalc.dropPrice && activeCalc.dropPrice.length > 0
                            ? activeCalc.dropPrice[activeCalc.dropPrice.length - 1].dropedPrice
                            : activeCalc.price
                        )}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View className="mb-20" />
              </View>
            )}
          </View>
        </ScrollView>

        {/* Progress Footer */}
        {!activeCalc.isRolloutConfirmed && (
          <View
            className="px-6 py-6 border-t border-border bg-card"
            style={{ paddingBottom: Platform.OS === 'ios' ? 0 : insets.bottom + 10 }}
          >
            <View className="flex-row items-center mb-4">
              <View className="flex-1 mr-3">
                <View className="flex-row items-center mb-1.5">
                  <Text className="text-sm font-black text-text-primary">
                    {confirmedCount}/{totalCount} entered
                  </Text>
                  <Text className="text-sm font-black text-text-secondary ml-3">
                    {Math.round(progressPct)}%
                  </Text>
                </View>
                <View className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <View className="h-full bg-green-500" style={{ width: `${progressPct}%` }} />
                </View>
              </View>

              <TouchableOpacity
                disabled={!allCalculatorsConfirmed || !!error || isConfirming}
                className={`h-11 px-6 rounded-xl items-center justify-center shadow-lg ${allCalculatorsConfirmed && !error
                  ? 'bg-green-600 shadow-green-600/30'
                  : 'bg-surface shadow-none'
                  }`}
                onPress={handleConfirmAll}
              >
                <Text
                  className={`text-[10px] font-black  tracking-widest ${allCalculatorsConfirmed && !error ? 'text-white' : 'text-text-secondary'
                    }`}
                >
                  {isConfirming ? 'Confirming...' : 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Payment Method Picker Modal */}
        <Modal visible={showPaymentPicker} transparent animationType="fade">
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.6)',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <View className="bg-white rounded-[32px] overflow-hidden max-h-[80%] shadow-2xl">
              <View className="p-6 border-b border-slate-100 flex-row justify-between items-center bg-slate-50">
                <Text className="text-lg font-black text-slate-900">Payment Plan</Text>
                <TouchableOpacity onPress={() => setShowPaymentPicker(false)} className="p-2">
                  <Ionicons name="close" size={24} color="#637381" />
                </TouchableOpacity>
              </View>

              <ScrollView className="p-4" showsVerticalScrollIndicator={false}>
                {getRolloutPaymentCategories(isLowesLead).map((cat) => (
                  <View key={cat.title} className="mb-4">
                    <View className={`px-4 py-2 mb-2 rounded-lg ${cat.bg}`}>
                      <Text className={`text-[10px] font-black tracking-widest ${cat.text}`}>
                        {cat.title}
                      </Text>
                    </View>
                    {cat.plans.map((key) => {
                      const plan = paymentPlans[key];
                      if (!plan) return null;
                      const belowMin = isPlanBelowMinPrice(key, rolloutEndPrice);
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => {
                            if (belowMin) {
                              Alert.alert('Payment plan', getBelowMinMessage(key, rolloutEndPrice));
                              return;
                            }
                            handlePaymentPlanSelect(key);
                          }}
                          className={`px-4 py-3.5 mb-2 rounded-xl border ${activeCalc.inputs.paymentPlan === key
                            ? 'bg-green-50 border-green-500'
                            : belowMin
                              ? 'bg-slate-100 border-slate-200 opacity-60'
                              : 'bg-white border-slate-200'
                            }`}
                        >
                          <Text
                            className={`text-sm font-bold ${activeCalc.inputs.paymentPlan === key
                              ? 'text-green-700'
                              : 'text-slate-800'
                              }`}
                          >
                            {plan.label}
                          </Text>
                          {plan.minPrice && (
                            <Text
                              className={`text-[10px] font-bold mt-1 ${belowMin ? 'text-red-500' : 'text-slate-400'
                                }`}
                            >
                              Requires ${plan.minPrice?.toLocaleString()}+
                              {rolloutEndPrice > 0
                                ? ` (current: $${rolloutEndPrice.toLocaleString()})`
                                : ' — enter end price first'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity
                onPress={() => setShowPaymentPicker(false)}
                className="mt-5 h-14 bg-slate-900 rounded-2xl items-center justify-center"
              >
                <Text className="text-white font-black text-sm ">Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Result Lead Modal */}
        <Modal visible={showResultModal} transparent animationType="fade">
          <View className="flex-1 justify-center px-5">
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setShowResultModal(false)}
            >
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={isDark ? 'dark' : 'light'}
                blurAmount={10}
                reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
              />
            </TouchableOpacity>

            <View className="bg-card rounded-2xl p-4 shadow-2xl">
              <View className="flex-row justify-center items-center">
                <View className="p-4 mb-6 bg-[#FFF0D9] rounded-xl">
                  <Doc />
                </View>
              </View>
              <Text className="text-base font-medium text-text-primary text-center mb-3">
                Result Job {activeCalc.name}
              </Text>
              <Text className="text-sm text-[#999999] text-center mb-6">
                Most recent price:{' '}
                {fCurrency(
                  activeCalc.dropPrice && activeCalc.dropPrice.length > 0
                    ? activeCalc.dropPrice[activeCalc.dropPrice.length - 1].dropedPrice
                    : activeCalc.price
                )}
              </Text>

              <View className="gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setShowResultModal(false);
                    handleStatusSelect('sale');
                  }}
                  className="rounded-lg flex-row justify-center items-center py-3"
                  style={{
                    backgroundColor: PALETTE.primary.main,
                  }}
                >
                  <Text className="text-base font-bold text-[#FFFFFF]">Sale</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowResultModal(false);
                    handleStatusSelect('demo');
                  }}
                  className="rounded-lg flex-row justify-center items-center py-3 bg-[#FF9800]"
                >
                  <Text className="text-base font-bold text-[#FFFFFF]">Demo</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => setShowResultModal(false)}
                className="rounded-lg mt-3 py-3 border border-border"
              >
                <Text className="text-center text-base font-bold text-text-primary">Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={showDropModal} transparent animationType="fade">
          <View className="flex-1 bg-black/60 justify-center px-5">
            <View className="bg-white rounded-[40px] p-6 shadow-2xl">
              {/* Header: Icon + UPDATED PRICE + CK/CC badges */}
              <View className="items-center mb-6">
                <View className="w-12 h-12 rounded-full bg-green-50 items-center justify-center mb-4">
                  <Ionicons name="checkmark" size={24} color="#31D076" />
                </View>
                <Text className="text-[10px] font-black text-slate-400  tracking-[2px] mb-2">
                  UPDATED PRICE
                </Text>

                <View className="flex-row items-center gap-4">
                  <Text className="text-4xl font-black text-[#1C252E]">
                    {fCurrency(Number(dropValue) || 0)}
                  </Text>
                  <View className="flex-row items-center gap-2">
                    {(isLowesLead
                      ? [
                        { key: 'lowes_ach', label: 'ACH' },
                        { key: 'lowes_cc', label: 'CC' },
                      ]
                      : [
                        { key: 'check', label: 'CK' },
                        { key: 'mcVisaDscvr', label: 'CC' },
                      ]
                    ).map((badge) => (
                      <TouchableOpacity
                        key={badge.key}
                        onPress={() => setSelectedPlan(badge.key)}
                        className={`px-3 py-1.5 rounded-lg border-2 ${selectedPlan === badge.key
                          ? 'bg-[#31D076] border-[#31D076]'
                          : 'bg-white border-slate-200'
                          }`}
                      >
                        <Text
                          className={`text-[11px] font-black ${selectedPlan === badge.key ? 'text-white' : 'text-slate-400'
                            }`}
                        >
                          {badge.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {!showDownPaymentInput ? (
                  <TouchableOpacity
                    onPress={() => setShowDownPaymentInput(true)}
                    className="mt-4 px-5 py-2 border-2 border-dashed border-slate-200 rounded-2xl flex-row items-center"
                  >
                    <Ionicons name="add" size={16} color="#919EAB" />
                    <Text className="ml-1 text-sm font-bold text-[#919EAB]">Add Down Payment</Text>
                  </TouchableOpacity>
                ) : (
                  <View className="flex-row gap-3 mt-6 w-full">
                    <View className="flex-1">
                      <Pressable
                        onPress={() => dpInputRef.current?.focus()}
                        className="bg-white border-2 border-slate-900 rounded-2xl px-3 py-2"
                      >
                        <Text className="text-[10px] font-black text-slate-900 absolute -top-2 left-3 bg-white px-1">
                          Down Payment
                        </Text>
                        <View className="flex-row items-center">
                          <Text className="text-sm font-bold text-slate-900 mr-1">$</Text>
                          <TextInput
                            ref={dpInputRef}
                            className="flex-1 h-8 font-black text-base text-slate-900 p-0"
                            keyboardType="numeric"
                            value={String(downPayment || '')}
                            onChangeText={(t) => setDownPayment(Number(t.replace(/[^0-9]/g, '')))}
                            placeholder="0"
                          />
                        </View>
                      </Pressable>
                    </View>
                    <View className="flex-1">
                      <View className="bg-slate-50 border-2 border-slate-100 rounded-2xl px-3 py-2 opacity-60">
                        <Text className="text-[10px] font-black text-slate-400 absolute -top-2 left-3 bg-white px-1">
                          Balance
                        </Text>
                        <View className="flex-row items-center">
                          <Text className="text-sm font-bold text-slate-400 mr-1">$</Text>
                          <Text className="text-base font-black text-slate-400">
                            {Math.max(0, (Number(dropValue) || 0) - downPayment).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}
              </View>

              <View className="h-[1px] bg-slate-100 w-full mb-6" />

              {/* Monthly Options */}
              <View className="mb-6">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-[10px] font-black text-slate-400  tracking-widest uppercase">
                    Monthly Options
                  </Text>
                  {addedPlans.length > 0 && (
                    <View className="flex-row items-center bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                      <Ionicons name="chevron-back" size={10} color="#FF5630" />
                      <Text className="text-[8px] font-black text-[#FF5630] uppercase ml-0.5">
                        swipe to delete
                      </Text>
                    </View>
                  )}
                </View>

                <ScrollView className="max-h-60" showsVerticalScrollIndicator={false}>
                  {addedPlans.map((planKey, idx) => {
                    const plan = paymentPlans[planKey];
                    const balance = Math.max(0, (Number(dropValue) || 0) - downPayment);
                    const monthly = calculateMonthly(balance, planKey);
                    const isSelected = selectedPlan === planKey;
                    const dropPriceNum = Number(dropValue) || 0;
                    const belowMin = !!(plan?.minPrice && dropPriceNum > 0 && dropPriceNum < plan.minPrice);

                    const planCode = planKey.replace(/^[a-z]+/, '').toUpperCase();
                    const planTitle = planCode || plan.label.split('(')[0].trim();
                    const planDesc = plan.label.includes('(')
                      ? plan.label.split('(')[1].split(')')[0]
                      : plan.label;

                    const renderRightActions = (
                      prog: SharedValue<number>,
                      drag: SharedValue<number>
                    ) => {
                      const styleAnimation = useAnimatedStyle(() => ({
                        transform: [{ translateX: drag.value + 80 }],
                      }));

                      return (
                        <View className="w-20 ml-2">
                          <Animated.View style={styleAnimation}>
                            <TouchableOpacity
                              onPress={() => {
                                const newPlans = addedPlans.filter((k) => k !== planKey);
                                setAddedPlans(newPlans);
                                if (selectedPlan === planKey) {
                                  setSelectedPlan(newPlans[0] || (isLowesLead ? 'lowes_ach' : 'check'));
                                }
                              }}
                              className="bg-[#FF5630] h-full rounded-2xl items-center justify-center"
                            >
                              <Text className="text-white font-black text-xs">Delete</Text>
                            </TouchableOpacity>
                          </Animated.View>
                        </View>
                      );
                    };

                    return (
                      <Swipeable
                        key={planKey}
                        renderRightActions={renderRightActions}
                        rightThreshold={40}
                      >
                        <TouchableOpacity
                          onPress={() => {
                            if (belowMin) {
                              Alert.alert(
                                'Minimum price',
                                `This plan requires a minimum price of $${plan.minPrice.toLocaleString()} (Entered: $${dropPriceNum.toLocaleString()}).`
                              );
                              return;
                            }
                            setSelectedPlan(planKey);
                          }}
                          className={`mb-3 p-4 rounded-2xl border-2 flex-row items-center justify-between ${isSelected
                            ? 'bg-white border-[#31D076]'
                            : belowMin
                              ? 'bg-slate-100 border-slate-200 opacity-50'
                              : 'bg-slate-50 border-slate-100'
                            }`}
                        >
                          <View className="flex-1">
                            <View className="flex-row items-center gap-2 mb-1">
                              <Text
                                className={`text-base font-black ${isSelected ? 'text-slate-900' : 'text-slate-400'
                                  }`}
                              >
                                {planTitle}
                              </Text>
                              {isSelected && (
                                <View className="bg-[#31D076] px-1.5 py-0.5 rounded-md">
                                  <Text className="text-[8px] font-black text-white">SELECTED</Text>
                                </View>
                              )}
                            </View>
                            <Text
                              className="text-[10px] font-medium text-slate-400 mb-2"
                              numberOfLines={1}
                            >
                              {planDesc}
                            </Text>
                            <View className="flex-row items-baseline">
                              <Text
                                className={`text-xl font-black ${isSelected ? 'text-slate-900' : 'text-slate-400'
                                  }`}
                              >
                                ${Math.round(monthly).toLocaleString()}
                              </Text>
                              <Text className="text-xs font-bold text-slate-400 ml-1">/mo</Text>
                            </View>
                            {belowMin && (
                              <Text className="text-[10px] font-bold text-red-500 mt-1">
                                ${plan.minPrice.toLocaleString()}+ req.
                              </Text>
                            )}
                          </View>

                          <View
                            className={`w-7 h-7 rounded-full border-2 items-center justify-center ${isSelected
                              ? 'border-[#31D076] bg-white'
                              : 'border-slate-200 bg-slate-100'
                              }`}
                          >
                            {isSelected && <View className="w-4 h-4 rounded-full bg-[#31D076]" />}
                          </View>
                        </TouchableOpacity>
                      </Swipeable>
                    );
                  })}

                  <TouchableOpacity
                    onPress={() => {
                      setTempPlan(null);
                      setIsPlanPickerVisible(true);
                    }}
                    className="h-14 border-2 border-dashed border-[#31D076] rounded-2xl items-center justify-center bg-green-50/30"
                  >
                    <Text className="text-[#31D076] font-black text-sm">+ Add Plan</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>

              <View className="flex-row gap-4 mt-2">
                <TouchableOpacity
                  onPress={() => {
                    handleAddDrop('declined');
                    setShowDropModal(false);
                  }}
                  className="flex-1 h-14 bg-[#FF5630] rounded-2xl items-center justify-center shadow-lg shadow-red-100"
                >
                  <Text className="text-white font-black text-base">Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={!selectedPlan}
                  onPress={() => {
                    handleAddDrop('accepted');
                    setShowDropModal(false);
                    setShowResultModal(true);
                  }}
                  className={`flex-1 h-14 rounded-2xl items-center justify-center shadow-lg ${!selectedPlan ? 'bg-slate-200' : 'bg-[#31D076] shadow-green-100'
                    }`}
                >
                  <Text
                    className={`font-black text-base ${!selectedPlan ? 'text-slate-400' : 'text-white'
                      }`}
                  >
                    Secure This Price
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>{' '}
          <Modal visible={isPlanPickerVisible} transparent animationType="fade">
            <View className="flex-1 bg-black/40 justify-center px-8">
              <View className="bg-white rounded-[24px] overflow-hidden shadow-2xl max-h-[70%]">
                <View className="flex-row justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
                  <Text className="text-sm font-black text-[#1C252E]">Add Payment Plan</Text>
                  <TouchableOpacity
                    onPress={() => setIsPlanPickerVisible(false)}
                    className="w-6 h-6 bg-white rounded-full items-center justify-center border border-slate-200"
                  >
                    <Ionicons name="close" size={16} color="#919EAB" />
                  </TouchableOpacity>
                </View>

                <ScrollView className="px-4 py-4" showsVerticalScrollIndicator={false}>
                  {getDropAddPlanCategories(isLowesLead).map((cat, ci) => {
                    const dropPriceNum = Number(dropValue) || 0;
                    return (
                      <View key={ci} className="mb-4">
                        <View
                          className={`px-3 py-1 rounded-md mb-2 inline-block self-start ${cat.bg}`}
                        >
                          <Text
                            className={`text-[10px] font-black uppercase tracking-wider ${cat.text}`}
                          >
                            {cat.title}
                          </Text>
                        </View>
                        <View className="gap-1.5">
                          {cat.plans.map((key) => {
                            const plan = paymentPlans[key];
                            if (!plan) return null;
                            const isSelected = tempPlan === key;
                            const belowMin = isPlanBelowMinPrice(key, dropPriceNum);
                            return (
                              <TouchableOpacity
                                key={key}
                                onPress={() => {
                                  if (belowMin) {
                                    Alert.alert(
                                      'Payment plan',
                                      getBelowMinMessage(key, dropPriceNum)
                                    );
                                    return;
                                  }
                                  setTempPlan(key);
                                }}
                                className={`p-3 rounded-xl border ${isSelected
                                  ? 'bg-green-50 border-[#31D076]'
                                  : belowMin
                                    ? 'bg-slate-100 border-slate-100 opacity-60'
                                    : 'bg-white border-slate-100'
                                  }`}
                              >
                                <Text
                                  className={`font-bold text-[11px] ${isSelected ? 'text-[#31D076]' : 'text-slate-900'
                                    }`}
                                >
                                  {plan.label}
                                </Text>
                                {plan.minPrice && (
                                  <Text
                                    className={`text-[9px] font-bold mt-1 ${belowMin ? 'text-red-500' : 'text-slate-400'
                                      }`}
                                  >
                                    ${plan.minPrice?.toLocaleString()}+ req.
                                  </Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>

                <View className="flex-row gap-3 p-4 border-t border-slate-100">
                  <TouchableOpacity
                    onPress={() => setIsPlanPickerVisible(false)}
                    className="flex-1 h-10 border border-slate-200 rounded-xl items-center justify-center"
                  >
                    <Text className="text-slate-400 font-bold text-xs">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!tempPlan}
                    onPress={() => {
                      if (tempPlan && !addedPlans.includes(tempPlan)) {
                        setAddedPlans([...addedPlans, tempPlan]);
                        setSelectedPlan(tempPlan);
                      }
                      setIsPlanPickerVisible(false);
                    }}
                    className={`flex-1 h-10 rounded-xl items-center justify-center ${!tempPlan ? 'bg-slate-200' : 'bg-[#31D076]'
                      }`}
                  >
                    <Text className="text-white font-black text-xs">Add Plan</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </Modal>

        {/* Customer Display Modal (Web Parity) */}
        <Modal visible={!!displayDrop} transparent animationType="fade">
          <View className="flex-1 bg-black/60 justify-center px-6">
            <View className="bg-white rounded-[40px] p-8 shadow-2xl">
              {/* Header Icon */}
              <View className="items-center mb-6">
                <View className="w-14 h-14 rounded-full bg-green-50 items-center justify-center mb-4">
                  <Ionicons name="checkmark" size={30} color="#22C55E" />
                </View>

                <Text className="text-[10px] font-black text-slate-400 tracking-[1.5px] uppercase mb-2">
                  Updated Price
                </Text>

                <View className="flex-row items-center gap-3">
                  <Text className="text-5xl font-black text-[#1C252E]">
                    {fCurrency(displayDrop?.dropedPrice || 0)}
                  </Text>
                  <View className="flex-row items-center gap-1.5">
                    <View className="px-3 py-1.5 rounded-lg bg-[#22C55E] border border-[#22C55E]">
                      <Text className="text-[11px] font-black text-white">CK</Text>
                    </View>
                    <View className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white">
                      <Text className="text-[11px] font-black text-slate-400">CC</Text>
                    </View>
                  </View>
                </View>

                {/* Add Down Payment Button */}
                <TouchableOpacity className="mt-5 w-full h-12 border-2 border-dashed border-slate-200 rounded-2xl items-center justify-center flex-row">
                  <Ionicons name="add" size={16} color="#919EAB" />
                  <Text className="ml-1 text-sm font-bold text-[#919EAB]">Add Down Payment</Text>
                </TouchableOpacity>
              </View>

              <View className="h-[1px] bg-slate-100 w-full mb-6" />

              <View className="mb-8">
                <Text className="text-[10px] font-black text-slate-400 tracking-[1px] uppercase mb-4">
                  Monthly Options
                </Text>

                <TouchableOpacity className="w-full h-14 border-2 border-dashed border-[#22C55E] rounded-2xl items-center justify-center">
                  <Text className="text-[#22C55E] font-black text-base">+ Add Plan</Text>
                </TouchableOpacity>
              </View>

              <View className="flex-row gap-4">
                <TouchableOpacity
                  onPress={() => setDisplayDrop(null)}
                  className="flex-1 h-16 bg-[#EF4444] rounded-3xl items-center justify-center shadow-lg shadow-red-100"
                >
                  <Text className="text-white font-black text-lg">Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDisplayDrop(null)}
                  className="flex-1 h-16 bg-[#22C55E] rounded-3xl items-center justify-center shadow-lg shadow-green-100"
                >
                  <Text className="text-white font-black text-lg">Secure This Price</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
};
