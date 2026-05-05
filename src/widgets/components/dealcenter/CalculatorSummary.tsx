import React, { useState } from 'react';
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
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { paymentPlans } from '../../../utils/calculator/payment-plans';
import Feather from 'react-native-vector-icons/Feather';
import { PALETTE } from '../../../theme/theme';
import Doc from '../../../assets/svgs/icons/doc';

import { useCalculatorSummary } from '../../../hooks/useCalculatorSummary';
import { useTheme } from '../../../theme/ThemeProvider';

export const CalculatorSummary = ({
  activeCalc,
  results,
  calculators,
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
}: any) => {
  const { colors } = useTheme();
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
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
    handleConfirmAll,
    calculateMonthly,
    handleDiscountChange,
    displayDrop,
    setDisplayDrop,
  } = useCalculatorSummary(activeCalc, results, calculators, updateActive, handleSave, refresh);

  const isSaved = Number(activeCalc.price) > 0;
  const screensCount = Number(activeCalc.inputs.ckToInstallers) || 0;
  const endPrice = Number(activeCalc.price) || 0;
  // If endPrice is 0, use results.total (Retail) as the base.
  // Note: results.total already includes screens, so we don't add them again in the fallback case.
  const securedDrop = (activeCalc.dropPrice || []).find((d: any) => d.status === 'accepted');
  const effectiveEndPrice = securedDrop ? securedDrop.dropedPrice : endPrice;
  const priceWithScreens = (effectiveEndPrice > 0 ? effectiveEndPrice : results.total) + screensCount * 75;

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

  const fCurrency = (num: number) => `$${Math.round(num).toLocaleString()}`;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View className="flex-1 bg-background">
        {/* Top Header & Tabs */}
        <View className="px-5 pt-4 pb-2 border-b border-border bg-card">
          <View className="flex-row items-center gap-3 mb-4">
            <TouchableOpacity
              onPress={() => setCurrentView('form')}
              className="p-2 items-center justify-center border border-border rounded-xl bg-card shadow-sm"
            >
              <Feather name="arrow-left" size={18} color={colors.text} />
            </TouchableOpacity>
            <View className="flex-row items-center">
              <Text className="text-sm font-black text-text-primary">Rollout</Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            <View className="flex-row gap-4 h-10 items-center">
              {calculators.map((calc: any, idx: number) => {
                const isLocked = calc.isRolloutConfirmed;
                const isOtherDuplicate = calculators.some((other: any, oIdx: number) => {
                  if (oIdx === idx) return false;
                  return (
                    other.inputs?.gutter5DsE === calc.inputs?.gutter5DsE &&
                    other.inputs?.gutter6Ft1 === calc.inputs?.gutter6Ft1 &&
                    other.inputs?.gutter7DsE === calc.inputs?.gutter7DsE &&
                    other.inputs?.paymentPlan === calc.inputs?.paymentPlan &&
                    other.inputs?.markup === calc.inputs?.markup
                  );
                });

                return (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setActiveIdx(idx)}
                    className={`flex-row items-center h-full px-4 border-b-2 ${
                      idx === activeIdx ? 'border-green-500' : 'border-transparent'
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
                        className={`text-sm font-black uppercase ${
                          idx === activeIdx ? 'text-text-primary' : 'text-text-secondary'
                        }`}
                      >
                        {calc.name || `Rollout ${idx + 1}`}
                      </Text>
                      {isOtherDuplicate && (
                        <View className="ml-2">
                          <Feather name="alert-triangle" size={12} color="#CA8A04" />
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-5 py-6">
            <View
              className={`bg-card rounded-3xl p-5 border-2 ${
                isSaved ? 'border-green-500 bg-green-500/10' : 'border-border'
              }`}
            >
              <View className="flex-row items-center justify-between mb-6">
                <Text className="text-xs font-semibold text-text-primary">{activeCalc.name}</Text>
                {activeCalc.isRolloutConfirmed ? (
                  <View className="bg-green-600 px-2 py-1 rounded-md flex-row items-center">
                    <Ionicons name="lock-closed" size={10} color="white" />
                    <Text className="text-[10px] font-black text-white uppercase ml-1">
                      Confirmed
                    </Text>
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
                  onPress={() => !activeCalc.isRolloutConfirmed && setShowPaymentPicker(true)}
                  disabled={activeCalc.isRolloutConfirmed}
                  className="h-14 bg-card border border-border rounded-2xl px-4 flex-row items-center justify-between shadow-sm"
                >
                  <View>
                    <Text className="text-[8px] font-black text-text-secondary uppercase tracking-widest mb-0.5">
                      Select Payment Method
                    </Text>
                    <Text className="text-sm font-black text-text-primary">
                      {paymentPlans[activeCalc.inputs.paymentPlan]?.label || 'Check (0% Fee)'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={16} color="#637381" />
                </TouchableOpacity>
              </View>

              <View className="mb-6">
                {Object.entries(
                  results.items.reduce((acc: any, item: any) => {
                    const cat = item.category || 'Additional Services';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(item);
                    return acc;
                  }, {})
                ).map(([category, items]: any) => {
                  const categoryStyles: Record<string, { color: string; icon: string }> = {
                    Gutters: { color: '#00B8D9', icon: 'home' },
                    LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark' },
                    Soffit: { color: '#00B8D9', icon: 'build' },
                    Fascia: { color: '#8E33FF', icon: 'layers' },
                    'Additional Services': { color: '#FFAB00', icon: 'add-circle' },
                  };
                  const style = categoryStyles[category] || { color: '#637381', icon: 'list' };

                  return (
                    <View key={category} className="mb-4">
                      <View className="mb-2 flex-row items-center">
                        <Text
                          className="text-[9px] font-black text-white px-2 py-1 rounded-md uppercase tracking-tighter"
                          style={{ backgroundColor: style.color }}
                        >
                          {category}
                        </Text>
                      </View>

                      <View className="gap-1">
                        {items.map((item: any, i: number) => (
                          <View
                            key={i}
                            className="flex-row items-center gap-3 py-1.5 px-1 border-b border-border last:border-0"
                          >
                            <View
                              className="w-7 h-7 rounded-full items-center justify-center"
                              style={{ backgroundColor: style.color + '15' }}
                            >
                              <Ionicons name={style.icon} size={14} color={style.color} />
                            </View>
                            <View className="flex-1">
                              <View className="flex-row items-baseline">
                                <Text className="text-sm font-black text-text-primary mr-2">
                                  {item.value}
                                  {item.unit || "'"}
                                </Text>
                                <Text className="text-[11px] font-medium text-text-secondary uppercase tracking-tight">
                                  {item.label}
                                </Text>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
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
                  className={`text-[10px] font-black uppercase mb-2 ml-1 tracking-widest ${
                    isSaved ? 'text-green-600' : 'text-amber-500'
                  }`}
                >
                  Rollout End Price
                </Text>
                <View
                  className={`flex-row items-center bg-card border rounded-2xl px-4 h-16 shadow-sm ${
                    error ? 'border-red-500' : securedDrop ? 'border-green-500' : isSaved ? 'border-green-500' : 'border-border'
                  }`}
                >
                  <Text
                    className={`text-xl font-black mr-2 ${
                      securedDrop || isSaved ? 'text-green-600' : 'text-text-secondary'
                    }`}
                  >
                    $
                  </Text>
                  <TextInput
                    className={`flex-1 font-black text-lg ${
                      securedDrop || activeCalc.isRolloutConfirmed ? 'text-green-600' : 'text-text-primary'
                    }`}
                    value={effectiveEndPrice ? String(effectiveEndPrice) : ''}
                    placeholder="Enter End Price"
                    placeholderTextColor="#919EAB"
                    keyboardType="numeric"
                    editable={!activeCalc.isRolloutConfirmed && !securedDrop}
                    onChangeText={handlePriceChange}
                  />
                  {(securedDrop || activeCalc.isRolloutConfirmed) ? (
                    <View className="flex-row items-center bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                      <Ionicons name="lock-closed" size={12} color="#16A34A" />
                      <Text className="text-[10px] font-black text-green-600 uppercase ml-1.5 tracking-wider">
                        LOCKED
                      </Text>
                    </View>
                  ) : null}
                </View>
                {error && (
                  <Text className="text-[10px] font-bold text-red-500 mt-2 ml-1 uppercase">
                    {error}
                  </Text>
                )}
                {isDuplicate && (
                  <View className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex-row items-center">
                    <Feather name="alert-triangle" size={20} color="#CA8A04" />
                    <View className="ml-3 flex-1">
                      <Text className="text-xs font-black text-yellow-700 uppercase tracking-tight">
                        Duplicate Calculator detected
                      </Text>
                      <Text className="text-[10px] text-yellow-600 font-medium mt-0.5">
                        This calculator has the same measurements and plan as another one.
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Target Price Card and MSRP are above this */}
            </View>

            {/* New Result Section - Only show when price is entered and NOT confirmed */}
            {endPrice > 0 && !error && !activeCalc.isRolloutConfirmed && (
              <View className="mt-8">
                {/* Target Price Card */}
                <View className="bg-card rounded-3xl border border-border shadow-sm overflow-hidden mb-6">
                  <View className="flex-row">
                    <View className="flex-1 py-6 items-center border-r border-border">
                      <Text className="text-[10px] font-bold text-text-secondary uppercase mb-1">
                        End Price w/ Screens
                      </Text>
                      <Text className="text-3xl font-black text-green-600">
                        {fCurrency(priceWithScreens)}
                      </Text>
                    </View>
                    <View className="flex-1 p-5 justify-center">
                      <View className="flex-row items-center justify-between mb-3">
                        <Text className="text-[10px] font-bold text-text-secondary uppercase">
                          Pre Order {'\n'} Discount
                        </Text>
                        <View className="flex-row items-center">
                          <Text className="text-[8px] font-bold text-text-secondary mr-1 uppercase">
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
                            className={`w-7 h-4 rounded-full items-center justify-center px-0.5 ${
                              activeCalc.inputs.isDefaultDiscount
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
                            className={`flex-1 h-10 rounded-xl items-center justify-center border ${
                              currentDiscount === d
                                ? 'bg-green-500/10 border-green-500/20'
                                : 'bg-card border-border'
                            }`}
                          >
                            <Text
                              className={`text-xs font-black ${
                                currentDiscount === d ? 'text-green-600' : 'text-text-secondary'
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

                <View className="bg-[#4CAF50] rounded-3xl p-5 mb-6">
                  <Text className="text-xl font-black text-white mb-2 text-center">
                    {fCurrency(msrp)}
                  </Text>
                  <Text className="text-[10px] font-black text-white/70 uppercase text-center tracking-widest">
                    MSRP
                  </Text>
                </View>

                {/* Comparison Boxes */}
                <View className="flex-row gap-4 mb-6">
                  {/* 1 Year Program */}
                  <View className="flex-1 bg-card rounded-3xl border border-border p-5 shadow-sm">
                    <Text className="text-xs font-black text-text-primary mb-6 uppercase tracking-wider">
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
                      <Text className="text-xs font-black text-text-secondary uppercase">
                        Grand Total
                      </Text>
                      <Text className="text-sm font-black text-text-primary">
                        {fCurrency(oneYearGrandTotal)}
                      </Text>
                    </View>
                  </View>

                  {/* In Home Pre Order */}
                  <View className="flex-1 bg-card rounded-3xl border-2 border-green-500 p-5 shadow-sm overflow-hidden">
                    <View className="absolute top-0 left-0 right-0 h-10 bg-green-500 items-center justify-center">
                      <Text className="text-[10px] font-black text-white uppercase tracking-widest">
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
                        <Text className="text-[10px] font-black text-text-secondary uppercase">
                          Grand total
                        </Text>
                        <Text className="text-base font-black text-green-600">
                          {fCurrency(preOrderGrandTotal)}
                        </Text>
                      </View>

                      <View className="items-center">
                        <Text className="text-lg font-black text-green-600 mb-1">
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

                {/* Installers Check */}
                <View className="bg-green-500/10 rounded-2xl p-4 flex-row justify-between items-center border border-green-500/20 mb-10">
                  <Text className="text-xs font-bold text-green-800">
                    Check to installers (screens)
                  </Text>
                  <Text className="text-lg font-black text-green-600">
                    {fCurrency(screensCount * 75)}
                  </Text>
                </View>
              </View>
            )}

            {/* Locked State View (Summary only) */}
            {activeCalc.isRolloutConfirmed && (
              <View className="mt-8">
                {/* <View className="bg-green-500/10 rounded-3xl p-6 border border-green-500/20 items-center mb-8">
                  <Text className="text-sm font-black text-green-600 uppercase tracking-widest mb-2">
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
                              <Text className="text-[11px] font-black text-green-600 mr-2 uppercase tracking-tight">
                                {idx === 0 ? '1st' : '2nd'} Dropped Price
                              </Text>
                              {isSecured && (
                                <View className="bg-green-600 px-2 py-0.5 rounded-md">
                                  <Text className="text-[8px] font-black text-white uppercase">
                                    ✓ SECURED
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View className="flex-row items-center gap-4">
                              <TouchableOpacity onPress={() => setDisplayDrop(drop)}>
                                <Text className={`text-[11px] font-bold ${isSecured ? 'text-green-600' : 'text-slate-500'}`}>View</Text>
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

                          <View className={`bg-white border-2 rounded-xl p-3 flex-row items-center justify-between ${
                            isSecured ? 'border-green-500' : 'border-slate-200'
                          }`}>
                            <Text className={`text-xl font-black ${isSecured ? 'text-green-600' : 'text-slate-400'}`}>
                              {fCurrency(drop.dropedPrice)}
                            </Text>
                            <View className="flex-row items-center gap-4">
                              <TouchableOpacity
                                onPress={() => setDisplayDrop(drop)}
                                className={`px-6 py-2 rounded-lg ${isSecured ? 'bg-[#22C55E]' : 'bg-slate-200'}`}
                              >
                                <Text className={`text-xs font-black ${isSecured ? 'text-white' : 'text-slate-500'}`}>Display</Text>
                              </TouchableOpacity>
                              <Text className={`text-[10px] font-black uppercase ${isSecured ? 'text-green-600' : 'text-slate-400'}`}>
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
                        onChangeText={setDropValue}
                        onBlur={() => {
                          if (Number(dropValue) > 0) {
                            if (!selectedPlan) {
                              setSelectedPlan(activeCalc.inputs.paymentPlan);
                            }
                            setShowDropModal(true);
                          }
                          setShowDropInput(false);
                        }}
                      />
                    </View>
                  </View>
                )}

                {/* Bottom Action Buttons per Screenshot */}
                <View className="flex-row gap-4 mb-20">
                  <TouchableOpacity
                    onPress={() => {
                      setDropValue('');
                      setShowDropInput(true);
                    }}
                    className="flex-1 h-14 bg-white border-2 border-[#1976D2] rounded-2xl items-center justify-center"
                  >
                    <Text className="text-[#1976D2] font-black uppercase text-xs">
                      + {(activeCalc.dropPrice?.length || 0) > 0 ? '2nd' : '1st'} Drop
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowResultModal(true)}
                    className="flex-1 h-14 bg-white border-2 border-orange-500 rounded-2xl items-center justify-center"
                  >
                    <View className="flex-row items-center">
                      <Ionicons name="document-text-outline" size={16} color="orange" />
                      <Text className="text-orange-600 font-black uppercase text-xs ml-2">
                        Result Lead
                      </Text>
                    </View>
                    <Text className="text-orange-600 font-black text-sm">
                      {fCurrency(
                        activeCalc.dropPrice?.find((d: any) => d.status === 'accepted')
                          ?.dropedPrice || activeCalc.price
                      )}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Progress Footer */}
        {!activeCalc.isRolloutConfirmed && (
          <View
            className="px-6 py-6 border-t border-border bg-card"
            style={{ paddingBottom: insets.bottom + 10 }}
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
                className={`h-11 px-6 rounded-xl items-center justify-center shadow-lg ${
                  allCalculatorsConfirmed && !error
                    ? 'bg-green-600 shadow-green-600/30'
                    : 'bg-surface shadow-none'
                }`}
                onPress={handleConfirmAll}
              >
                <Text
                  className={`text-[10px] font-black uppercase tracking-widest ${
                    allCalculatorsConfirmed && !error ? 'text-white' : 'text-text-secondary'
                  }`}
                >
                  {isConfirming ? 'Confirming...' : 'Confirm'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Payment Method Picker Modal */}
        <Modal visible={showPaymentPicker} transparent animationType="slide">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <View className="bg-white rounded-t-[32px] p-6 pb-10">
              <View className="w-12 h-1 bg-slate-200 self-center rounded-full mb-4" />
              <Text className="text-lg font-black text-slate-900 mb-4">Select Payment Method</Text>
              <ScrollView className="max-h-[500px]" showsVerticalScrollIndicator={false}>
                {/* Basic */}
                {[
                  { value: 'check', label: 'Check (0% Fee)' },
                  { value: 'mcVisaDscvr', label: 'MC/VISA/DSCVR (3.00% Fee)' },
                  { value: 'amex', label: 'AMEX (5.00% Fee)' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => {
                      updateActive({ inputs: { paymentPlan: opt.value } });
                      setShowPaymentPicker(false);
                    }}
                    className={`px-4 py-3 mb-1 rounded-xl border ${
                      activeCalc.inputs.paymentPlan === opt.value
                        ? 'bg-green-50 border-green-400'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <Text className={`text-sm font-semibold ${
                      activeCalc.inputs.paymentPlan === opt.value ? 'text-green-700' : 'text-slate-800'
                    }`}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}

                {/* GreenSky */}
                <View className="px-3 py-2 mt-3 mb-1 rounded-md" style={{ backgroundColor: '#d9ead3' }}>
                  <Text className="text-xs font-black text-slate-800">GreenSky Plans</Text>
                </View>
                {['greensky2511', 'greensky2521', 'greensky2531', 'greensky1599', 'greensky1509', 'greensky2011'].map((key) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => {
                      updateActive({ inputs: { paymentPlan: key } });
                      setShowPaymentPicker(false);
                    }}
                    className={`px-4 py-3 mb-1 rounded-xl border ${
                      activeCalc.inputs.paymentPlan === key
                        ? 'bg-green-50 border-green-400'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <Text className={`text-sm font-semibold ${
                      activeCalc.inputs.paymentPlan === key ? 'text-green-700' : 'text-slate-800'
                    }`}>{paymentPlans[key]?.label}</Text>
                  </TouchableOpacity>
                ))}

                {/* Wells Fargo */}
                <View className="px-3 py-2 mt-3 mb-1 rounded-md" style={{ backgroundColor: '#f4cccc' }}>
                  <Text className="text-xs font-black text-slate-800">Wells Fargo Plans</Text>
                </View>
                {['wf1148', 'wf1019', 'wf1157', 'wf1197', 'wf2225', 'wf3198', 'wf1529', 'wf4073', 'wf4079', 'wf4091', 'wf4103', 'wf4115'].map((key) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => {
                      updateActive({ inputs: { paymentPlan: key } });
                      setShowPaymentPicker(false);
                    }}
                    className={`px-4 py-3 mb-1 rounded-xl border ${
                      activeCalc.inputs.paymentPlan === key
                        ? 'bg-green-50 border-green-400'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <Text className={`text-sm font-semibold ${
                      activeCalc.inputs.paymentPlan === key ? 'text-green-700' : 'text-slate-800'
                    }`}>{paymentPlans[key]?.label}</Text>
                  </TouchableOpacity>
                ))}

                {/* Wells Fargo High */}
                <View className="px-3 py-2 mt-3 mb-1 rounded-md" style={{ backgroundColor: '#f4cccc' }}>
                  <Text className="text-xs font-black text-slate-800">Wells Fargo Plans (Jobs over $7,500)</Text>
                </View>
                {['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'].map((key) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => {
                      updateActive({ inputs: { paymentPlan: key } });
                      setShowPaymentPicker(false);
                    }}
                    className={`px-4 py-3 mb-1 rounded-xl border ${
                      activeCalc.inputs.paymentPlan === key
                        ? 'bg-green-50 border-green-400'
                        : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <Text className={`text-sm font-semibold ${
                      activeCalc.inputs.paymentPlan === key ? 'text-green-700' : 'text-slate-800'
                    }`}>{paymentPlans[key]?.label}</Text>
                  </TouchableOpacity>
                ))}

                {/* Concora */}
                <View className="px-3 py-2 mt-3 mb-1 rounded-md" style={{ backgroundColor: '#c9daf8' }}>
                  <Text className="text-xs font-black text-slate-800">Concora Credit</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    updateActive({ inputs: { paymentPlan: 'concora' } });
                    setShowPaymentPicker(false);
                  }}
                  className={`px-4 py-3 mb-1 rounded-xl border ${
                    activeCalc.inputs.paymentPlan === 'concora'
                      ? 'bg-green-50 border-green-400'
                      : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  <Text className={`text-sm font-semibold ${
                    activeCalc.inputs.paymentPlan === 'concora' ? 'text-green-700' : 'text-slate-800'
                  }`}>{paymentPlans['concora']?.label}</Text>
                </TouchableOpacity>
              </ScrollView>
              <TouchableOpacity
                onPress={() => setShowPaymentPicker(false)}
                className="mt-5 h-14 bg-slate-900 rounded-2xl items-center justify-center"
              >
                <Text className="text-white font-black text-sm uppercase">Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Result Lead Modal */}
        <Modal visible={showResultModal} transparent animationType="fade">
          <TouchableOpacity
            className="flex-1 bg-black/40 justify-center px-5"
            activeOpacity={1}
            onPress={() => setShowResultModal(false)}
          >
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
                How would you like to result this lead?
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
                  <View>
                    <Text className="text-base font-bold text-[#FFFFFF]">Sale</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setShowResultModal(false);
                    handleStatusSelect('demo');
                  }}
                  className="rounded-lg flex-row justify-center items-center py-3"
                  style={{
                    backgroundColor: '#FF9800',
                  }}
                >
                  <View>
                    <Text className="text-base font-bold text-[#FFFFFF]">Demo</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => setShowResultModal(false)}
                className="rounded-lg mt-3 py-3 border border-border"
              >
                <Text className="text-center text-base font-bold text-text-primary">Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal visible={showDropModal} transparent animationType="fade">
          <View className="flex-1 bg-black/60 justify-center px-5">
            <View className="bg-card rounded-[32px] p-6 shadow-2xl">
              {/* Header: Icon + UPDATED PRICE + CK/CC badges */}
              <View className="items-center mb-6">
                <View className="w-16 h-16 rounded-full bg-green-50 items-center justify-center mb-4">
                  <Ionicons name="checkmark-circle" size={40} color="#31D076" />
                </View>
                <Text className="text-[10px] font-black text-text-secondary uppercase tracking-[2px] mb-3">
                  UPDATED PRICE
                </Text>
                {/* Price + CK/CC badge row — exactly like web app */}
                <View className="flex-row items-center" style={{ gap: 16 }}>
                  <Text className="text-4xl font-black text-text-primary">
                    {fCurrency(Number(dropValue) || 0)}
                  </Text>
                  <View style={{ gap: 6 }}>
                    {/* CK Badge */}
                    <TouchableOpacity
                      onPress={() => setSelectedPlan('check')}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 8,
                        minWidth: 38,
                        alignItems: 'center',
                        backgroundColor: selectedPlan === 'check' ? '#31D076' : 'transparent',
                        borderWidth: 1.5,
                        borderColor: selectedPlan === 'check' ? '#31D076' : '#D1D5DB',
                      }}
                    >
                      <Text style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: selectedPlan === 'check' ? '#fff' : '#9CA3AF',
                      }}>CK</Text>
                    </TouchableOpacity>
                    {/* CC Badge */}
                    <TouchableOpacity
                      onPress={() => setSelectedPlan('mcVisaDscvr')}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 8,
                        minWidth: 38,
                        alignItems: 'center',
                        backgroundColor: selectedPlan === 'mcVisaDscvr' ? '#31D076' : 'transparent',
                        borderWidth: 1.5,
                        borderColor: selectedPlan === 'mcVisaDscvr' ? '#31D076' : '#D1D5DB',
                      }}
                    >
                      <Text style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: selectedPlan === 'mcVisaDscvr' ? '#fff' : '#9CA3AF',
                      }}>CC</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View className="h-[1px] bg-border w-full mb-5" />

              {/* Monthly Options — web parity plan rows */}
              <View className="mb-6">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-[11px] font-black text-text-secondary uppercase tracking-widest">
                    Monthly Options
                  </Text>
                  <TouchableOpacity
                    onPress={() => setIsPlanPickerVisible(true)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 20,
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: '#31D076',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#31D076' }}>+ Add Plan</Text>
                  </TouchableOpacity>
                </View>

                {selectedPlan && paymentPlans[selectedPlan]?.type === 'financing' && (
                  <View
                    style={{
                      borderWidth: 2,
                      borderColor: '#31D076',
                      borderRadius: 16,
                      backgroundColor: '#F0FFF4',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      marginBottom: 6,
                    }}
                  >
                    {/* Plan label primary: monthly payment */}
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        {calculateMonthly(Number(dropValue) || 0, selectedPlan) > 0 ? (
                          <View className="flex-row items-baseline">
                            <Text style={{ fontSize: 20, fontWeight: '900', color: '#1F2D52', lineHeight: 24 }}>
                              {fCurrency(calculateMonthly(Number(dropValue) || 0, selectedPlan))}
                            </Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#919EAB', marginLeft: 2 }}>/mo</Text>
                          </View>
                        ) : (
                          <Text style={{ fontSize: 15, fontWeight: '800', color: '#1F2D52' }} numberOfLines={1}>
                            {paymentPlans[selectedPlan]?.label?.split('(')[0]?.trim()}
                          </Text>
                        )}
                        {/* APR / Term sub-label */}
                        {(() => {
                          const plan = paymentPlans[selectedPlan];
                          const aprMatch = (plan?.label || '').match(/(\d+\.?\d*)%/);
                          const apr = aprMatch ? `${aprMatch[1]}% APR` : null;
                          const term = plan?.duration ? `${plan.duration} Mo` : null;
                          return (apr || term) ? (
                            <View className="flex-row items-center mt-1" style={{ gap: 6 }}>
                              {apr && <Text style={{ fontSize: 11, fontWeight: '700', color: selectedPlan ? '#1F2D52' : '#9CA3AF' }}>{apr}</Text>}
                              {term && <Text style={{ fontSize: 10, fontWeight: '600', color: '#9CA3AF' }}>{term}</Text>}
                            </View>
                          ) : null;
                        })()}
                      </View>
                      {/* Selected check circle */}
                      <View style={{
                        width: 28, height: 28, borderRadius: 14,
                        backgroundColor: '#31D076',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Ionicons name="checkmark" size={16} color="#fff" />
                      </View>
                    </View>
                  </View>
                )}

                {(!selectedPlan || paymentPlans[selectedPlan]?.type !== 'financing') && (
                  <TouchableOpacity
                    onPress={() => setIsPlanPickerVisible(true)}
                    style={{
                      height: 56,
                      backgroundColor: '#F8FAFC',
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: '#CBD5E1',
                    }}
                  >
                    <Text style={{ color: '#64748B', fontWeight: '700', fontSize: 12, textTransform: 'uppercase' }}>Select Financing Plan</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View className="flex-row gap-4">
                <TouchableOpacity
                  onPress={() => {
                    handleAddDrop('declined');
                    setShowDropModal(false);
                  }}
                  className="flex-1 h-14 bg-[#FF5630] rounded-2xl items-center justify-center"
                >
                  <Text className="text-white font-black uppercase text-xs">Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={!selectedPlan}
                  onPress={() => {
                    handleAddDrop('accepted');
                    setShowDropModal(false);
                    setShowResultModal(true);
                  }}
                  className={`flex-[1.4] h-14 rounded-2xl items-center justify-center ${!selectedPlan ? 'bg-slate-200' : 'bg-[#31D076]'}`}
                >
                  <Text className={`font-black uppercase text-xs ${!selectedPlan ? 'text-slate-400' : 'text-white'}`}>Secure This Price</Text>
                </TouchableOpacity>
              </View>

            </View>
          </View>

          {/* Payment Plan Sub-Picker Modal */}
          <Modal visible={isPlanPickerVisible} transparent animationType="slide">
            <View className="flex-1 bg-black/40 justify-end">
              <View className="bg-white rounded-t-[32px] p-8 pb-12">
                <View className="w-12 h-1 bg-slate-200 self-center rounded-full mb-6" />
                <Text className="text-xl font-black text-slate-900 mb-6">Select Payment Plan</Text>
                <ScrollView className="max-h-[400px]">
                  <View className="gap-3">
                    {Object.entries(paymentPlans).map(([key, plan]) => (
                      <TouchableOpacity
                        key={key}
                        onPress={() => {
                          setSelectedPlan(key);
                          setIsPlanPickerVisible(false);
                        }}
                        className={`p-4 rounded-xl border-2 ${
                          selectedPlan === key
                            ? 'bg-green-50 border-green-500'
                            : 'bg-slate-50 border-slate-100'
                        }`}
                      >
                        <Text
                          className={`font-black text-sm ${
                            selectedPlan === key ? 'text-green-600' : 'text-slate-900'
                          }`}
                        >
                          {plan.label}
                        </Text>
                        {plan.displayMonths && (
                          <Text className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                            {plan.displayMonths}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <TouchableOpacity
                  onPress={() => setIsPlanPickerVisible(false)}
                  className="mt-6 h-14 bg-slate-900 rounded-xl items-center justify-center"
                >
                  <Text className="text-white font-black uppercase text-xs">Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </Modal>

        {/* Customer Display Modal (Web Parity) */}
        <Modal visible={!!displayDrop} transparent animationType="fade">
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 20 }}
            onPress={() => setDisplayDrop(null)}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View className="bg-card rounded-[32px] p-8 shadow-2xl border border-border">
                <View className="items-center mb-8">
                  <View className="w-20 h-20 rounded-full bg-green-50 items-center justify-center mb-6">
                    <Ionicons name="checkmark-circle" size={48} color="#31D076" />
                  </View>
                  <Text className="text-xs font-black text-text-secondary uppercase tracking-[3px] mb-2">
                    Special Offer Price
                  </Text>
                  <Text className="text-5xl font-black text-text-primary mb-2">
                    {fCurrency(displayDrop?.dropedPrice || 0)}
                  </Text>
                  <View className="bg-green-600/10 px-3 py-1 rounded-full border border-green-600/20">
                    <Text className="text-[10px] font-black text-green-600 uppercase tracking-widest">
                      {displayDrop?.status === 'accepted' ? 'Secured' : 'Recorded Scenario'}
                    </Text>
                  </View>
                </View>

                <View className="bg-slate-50 rounded-3xl p-6 border border-slate-100">
                  <Text className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Financing Option</Text>
                  <View className="flex-row items-baseline">
                    <Text className="text-3xl font-black text-text-primary mr-1">
                      {fCurrency(calculateMonthly(displayDrop?.dropedPrice || 0, displayDrop?.paymentMethod))}
                    </Text>
                    <Text className="text-sm font-bold text-text-secondary">/mo</Text>
                  </View>
                  <Text className="text-xs font-bold text-text-secondary mt-1">
                    {paymentPlans[displayDrop?.paymentMethod]?.label}
                  </Text>
                </View>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
};
