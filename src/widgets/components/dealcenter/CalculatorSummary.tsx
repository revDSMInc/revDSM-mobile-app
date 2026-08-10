import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
  ActivityIndicator,
  Alert,
  findNodeHandle,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, SharedValue, LinearTransition, SlideOutLeft, FadeOut } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import { getCalculatorBaseName } from '../../../utils/calculator/tab-naming.utils';
import { FlashMessage } from '../../../config/message';
import { paymentPlans } from '../../../utils/calculator/payment-plans';
import { calculateMonthlyPayment } from '../../../utils/calculator/calculation-utils';
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
import { LoadingOverlay } from '../../modals/DealCenter/OutcomeModal';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import { sanitizeCalculatorLogTitle } from '../../../utils/activity-log/job-builder-auto-log';
import { SettingsService } from '../../../services/api/SettingsService';

const getOrdinal = (n: number) => {
  const j = n % 10,
    k = n % 100;
  if (j === 1 && k !== 11) return n + 'st';
  if (j === 2 && k !== 12) return n + 'nd';
  if (j === 3 && k !== 13) return n + 'rd';
  return n + 'th';
};

function getPlanLabel(key: string): string {
  if (!key) return '';

  if (key === 'check') return 'CK';
  if (key === 'mcVisaDscvr') return 'MC/VISA';
  if (key === 'amex') return 'AMEX';

  if (key === 'lowes_ach') return 'ACH';
  if (key === 'lowes_cc') return 'CC';

  if (key.startsWith('greensky')) {
    return `GS ${key.replace('greensky', '')}`;
  }

  if (key.startsWith('wf')) {
    return `WF ${key.replace('wf', '')}`;
  }

  if (key.startsWith('lowes_')) {
    const number = key.replace('lowes_', '').replace('m', '');
    return `Lowes ${number}M`;
  }

  return key;
}


const alpha = (hex: string, opacity: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const isCalculatorIdentical = (c1: any, c2: any) => {
  if (!c1 || !c2) return false;
  const inputs1 = c1.inputs || {};
  const inputs2 = c2.inputs || {};
  const compareInputKeys = [
    'gutter5DsE', 'gutter6Ft1', 'gutter7DsE', 'miters', 'endCaps', 'spoutSavers',
    'versaMaxFt1', 'versa6Ft1', 'versa7Ft1', 'filter45Ft1',
    'versa6Ft2', 'versa7Ft2', 'filter45Ft2', 'versa6Ft3', 'versa7Ft3', 'filter45Ft3',
    'ckToInstallers', 'extraLabor', 'paymentPlan', 'markup', 'discountPercentage'
  ];
  for (const key of compareInputKeys) {
    const val1 = inputs1[key] === undefined || inputs1[key] === null ? '' : String(inputs1[key]).trim();
    const val2 = inputs2[key] === undefined || inputs2[key] === null ? '' : String(inputs2[key]).trim();
    if (val1 !== val2) return false;
  }
  const extras1 = c1.extras || {};
  const extras2 = c2.extras || {};
  const extraKeys = new Set([...Object.keys(extras1), ...Object.keys(extras2)]);
  const ignoreKeys = ['_id', 'id', 'createdAt', 'updatedAt'];
  for (const key of extraKeys) {
    if (ignoreKeys.includes(key)) continue;
    const val1 = extras1[key] === undefined || extras1[key] === null ? '' : String(extras1[key]).trim();
    const val2 = extras2[key] === undefined || extras2[key] === null ? '' : String(extras2[key]).trim();
    if (val1 !== val2) return false;
  }
  return true;
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
  const { user, refreshUser } = useAuth();
  const isLowesLead = lead?.lowesLead === true;
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  // Derived from user preference — mirrors web's useEffect logic:
  // isDefaultPayment = (user.defaultPaymentMethod === activeCalc.inputs.paymentPlan)
  const isDefaultPayment =
    !!user?.defaultPaymentMethod &&
    user.defaultPaymentMethod === activeCalc.inputs?.paymentPlan;

  // Derived from user preference — mirrors web's useEffect logic:
  // isDefaultDiscount = (user.defaultPercentage === calculator.discountPercentage)
  const isDefaultDiscount =
    !!user?.defaultPercentage &&
    user.defaultPercentage === activeCalc.inputs?.discountPercentage;

  const rolloutEndPrice = Number(activeCalc.price) || 0;

  const CATEGORY_ORDER = [
    'Gutters',
    'LeafFilter',
    'Soffit',
    'Fascia',
    'Lighting',
    'Additional Services',
    'Miscellaneous'
  ];

  const categoryCounts = results.items.reduce((acc: Record<string, number>, item: any) => {
    const cat = item.category || 'Additional Services';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const uniqueCategories = Array.from(
    new Set(results.items.map((i: any) => i.category || 'Additional Services'))
  ).sort((a: any, b: any) => {
    const indexA = CATEGORY_ORDER.indexOf(a);
    const indexB = CATEGORY_ORDER.indexOf(b);
    return (indexA > -1 ? indexA : 999) - (indexB > -1 ? indexB : 999);
  });

  const sortedItems = [...results.items].sort((a: any, b: any) => {
    const catA = a.category || 'Additional Services';
    const catB = b.category || 'Additional Services';
    const indexA = CATEGORY_ORDER.indexOf(catA);
    const indexB = CATEGORY_ORDER.indexOf(catB);
    return (indexA > -1 ? indexA : 999) - (indexB > -1 ? indexB : 999);
  });

  const visibleItems = selectedCat
    ? sortedItems.filter((i: any) => (i.category || 'Additional Services') === selectedCat)
    : sortedItems;

  const handlePaymentPlanSelect = (method: string) => {
    const oldMethod = activeCalc.inputs.paymentPlan;
    const currentPrice = rolloutEndPrice;
    const isConfirmedWithPrice = !!activeCalc.isRolloutConfirmed && currentPrice > 0;

    // Web parity: these are non-blocking warning toasts (enqueueSnackbar), not a
    // native Alert dialog — so the rep isn't interrupted by an OK-to-dismiss popup.
    if (WELLS_FARGO_HIGH_KEYS.includes(method) && currentPrice > 0 && currentPrice < WF_HIGH_MIN_PRICE) {
      FlashMessage.warning(
        `Payment plan changed - this Wells Fargo plan requires a minimum end price of $${WF_HIGH_MIN_PRICE.toLocaleString()}. Please update the end price.`
      );
    } else if (isConfirmedWithPrice && method !== oldMethod) {
      FlashMessage.warning(
        `Payment method updated - the rollout price $${currentPrice.toLocaleString()} is already confirmed.`
      );
    }

    if (isPlanBelowMinPrice(method, currentPrice)) {
      FlashMessage.warning(getBelowMinMessage(method, currentPrice));
      return;
    }
    const methodValidation = validatePriceForPaymentMethod(currentPrice, method);
    if (currentPrice > 0 && !methodValidation.isValid) {
      FlashMessage.warning(methodValidation.message);
      return;
    }

    updateActive({ inputs: { paymentPlan: method } });
    handleSave();
    logPaymentMethodChange(method, oldMethod);
    if (isDefaultPayment && activeCalc.isRolloutConfirmed) {
      propagateDefaultPaymentPlan(method);
    }
    setShowPaymentPicker(false);
  };
  const dpInputRef = useRef<TextInput>(null);
  const dpWrapperRef = useRef<View>(null);
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
    handleDisplayDropAction,
    handlePriceChange,
    handlePriceBlur,
    priceText,
    handleConfirmAll,
    calculateMonthly,
    handleDiscountChange,
    displayDrop,
    setDisplayDrop,
    displayDropIndex,
    setDisplayDropIndex,
    droppedPrices,
    isSaving,
    downPayment,
    setDownPayment,
    showDownPaymentInput,
    setShowDownPaymentInput,
    addedPlans,
    setAddedPlans,
    tempPlan,
    setTempPlan,
    propagateDefaultPaymentPlan,
    logPaymentMethodChange,
    logDropPlanSelect,
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

  const [showLockedDetails, setShowLockedDetails] = useState(false);
  const lockedDetailsLoggedRef = useRef(false);
  const paymentPickerLoggedRef = useRef(false);
  const dropModalLoggedRef = useRef(false);
  const [showPreOrderDownPaymentInput, setShowPreOrderDownPaymentInput] = useState(activeCalc.downPayment > 0);
  const [preOrderDownPayment, setPreOrderDownPayment] = useState(activeCalc.downPayment || 0);

  const [displayShowDownPaymentInput, setDisplayShowDownPaymentInput] = useState(false);
  const [declinedPrice, setDeclinedPrice] = useState<number | null>(null);
  const summaryTabsScrollViewRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<number, { x: number; width: number }>>({});
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const centerTab = (idx: number) => {
    const layout = tabLayouts.current[idx];
    if (layout && scrollViewWidth > 0) {
      const targetOffset = Math.max(0, layout.x - (scrollViewWidth - layout.width) / 2);
      summaryTabsScrollViewRef.current?.scrollTo({ x: targetOffset, animated: true });
    }
  };

  useEffect(() => {
    centerTab(activeIdx);
  }, [activeIdx, scrollViewWidth]);

  useEffect(() => {
    if (!showLockedDetails) {
      lockedDetailsLoggedRef.current = false;
      return;
    }
    const userId = user?._id || user?.id;
    if (!userId || lockedDetailsLoggedRef.current) return;
    lockedDetailsLoggedRef.current = true;
    logEvent('view', {
      user_id: userId,
      created_by: userId,
      module_type: 'rollout_and_drop',
      meta: {
        calculatorId: activeCalc?._id,
        appointmentId: activeCalc?.appointmentId,
        calculatorTitle: sanitizeCalculatorLogTitle(activeCalc?.name || activeCalc?.title || ''),
        action: 'rollout_locked_details_expanded',
        leadId: lead?._id || lead?.id,
      },
    });
  }, [showLockedDetails, user, activeCalc, lead]);

  useEffect(() => {
    if (!showPaymentPicker) {
      paymentPickerLoggedRef.current = false;
      return;
    }
    const userId = user?._id || user?.id;
    if (!userId || paymentPickerLoggedRef.current) return;
    paymentPickerLoggedRef.current = true;
    logEvent('view', {
      user_id: userId,
      created_by: userId,
      module_type: 'rollout_and_drop',
      meta: {
        calculatorId: activeCalc?._id,
        appointmentId: activeCalc?.appointmentId,
        calculatorTitle: sanitizeCalculatorLogTitle(activeCalc?.name || activeCalc?.title || ''),
        action: 'payment_plan_dropdown_opened',
        leadId: lead?._id || lead?.id,
      },
    });
  }, [showPaymentPicker, user, activeCalc, lead]);

  useEffect(() => {
    if (!showDropModal) {
      dropModalLoggedRef.current = false;
      return;
    }
    const userId = user?._id || user?.id;
    if (!userId || dropModalLoggedRef.current) return;
    dropModalLoggedRef.current = true;
    logEvent('view', {
      user_id: userId,
      created_by: userId,
      module_type: 'rollout_and_drop',
      meta: {
        calculatorId: activeCalc?._id,
        appointmentId: activeCalc?.appointmentId,
        calculatorTitle: sanitizeCalculatorLogTitle(activeCalc?.name || activeCalc?.title || ''),
        action: 'drop_plan_dropdown_opened',
        leadId: lead?._id || lead?.id,
      },
    });
  }, [showDropModal, user, activeCalc, lead]);

  const onTabLayout = (idx: number, event: any) => {
    const { x, width } = event.nativeEvent.layout;
    tabLayouts.current[idx] = { x, width };
    if (idx === activeIdx) {
      centerTab(idx);
    }
  };

  useEffect(() => {
    setPreOrderDownPayment(activeCalc.downPayment || 0);
    setShowPreOrderDownPaymentInput(!!activeCalc.downPayment && activeCalc.downPayment > 0);
  }, [activeCalc._id, activeCalc.downPayment]);

  const isSaved = Number(activeCalc.price) > 0;
  const screensCount = Number(activeCalc.inputs.ckToInstallers) || 0;
  const endPrice = Number(activeCalc.price) || 0;

  // Source of truth: jobBuilderState is freshly fetched from the API via useDealOutcome,
  // matching the actual lead payload: lead.jobBuilder.status === 'submitted' && lead.jobBuilder.calculatorId
  // We prioritize the API-fetched jobBuilderState to avoid stale data from the lead object.
  const resultedCalculatorId = jobBuilderState?.calculatorId || lead?.jobBuilder?.calculatorId;
  const isJobBuilderSubmitted =
    (jobBuilderState?.status === 'submitted' || lead?.jobBuilder?.status === 'submitted') &&
    !!resultedCalculatorId &&
    String(activeCalc?._id) === String(resultedCalculatorId);

  // Job was submitted from a DIFFERENT calculator — this tab should be dimmed & non-interactive
  const isJobSubmittedOnOtherCalc =
    (jobBuilderState?.status === 'submitted' || lead?.jobBuilder?.status === 'submitted') &&
    !!resultedCalculatorId &&
    String(activeCalc?._id) !== String(resultedCalculatorId);

  // If endPrice is 0, use results.total (Retail) as the base.
  // Note: results.total already includes screens, so we don't add them again in the fallback case.
  const activeDrop = droppedPrices.length > 0 ? droppedPrices[droppedPrices.length - 1] : null;
  const acceptedDrop = droppedPrices.find((d: any) => d.secured);
  // Always show the original rollout end price — dropouts do NOT change this value
  const effectiveEndPrice = endPrice;
  const priceWithScreens =
    (effectiveEndPrice > 0 ? effectiveEndPrice : results.total) + screensCount * 75;

  const msrp = priceWithScreens / (1 - (currentDiscount + 10) / 100);
  const srVetDiscount = msrp * 0.1;
  const preOrderDiscountVal = msrp * (currentDiscount / 100);
  const oneYearGrandTotal = msrp - srVetDiscount;
  const preOrderGrandTotal = msrp - srVetDiscount - preOrderDiscountVal;

  // Deferred Financing Scenarios (web parity: calculation-utils.js calculateQuote +
  // summary/DeferredScenarios.js). Only surfaced for a deferred-interest financing plan.
  const deferredInfo = useMemo(() => {
    const plan: any = paymentPlans[activeCalc?.inputs?.paymentPlan];
    if (!plan || plan.type !== 'financing' || !plan.deferredMonths || plan.deferredMonths <= 0) {
      return { show: false, scenarios: null as any };
    }
    // Financed base = the after-discounts In-Home Pre-Order grand total shown above.
    const afterDiscounts = preOrderGrandTotal;
    const loanPrincipal = afterDiscounts * (1 + (plan.pf || 0));
    const monthlyRateAfterDeferred = (plan.aprAfterDeferred || 0) / 12;
    const deferredInterest =
      loanPrincipal * ((1 + monthlyRateAfterDeferred) ** plan.deferredMonths - 1);
    const balanceAfterDeferred = loanPrincipal + deferredInterest;
    const remainingMonths = plan.totalLoanMonths - plan.deferredMonths;
    let monthlyPaymentAfterDeferred = 0;
    if (remainingMonths > 0) {
      monthlyPaymentAfterDeferred = calculateMonthlyPayment(
        balanceAfterDeferred,
        plan.aprAfterDeferred || 0,
        remainingMonths
      );
    }
    const totalPostPromoPayments = monthlyPaymentAfterDeferred * remainingMonths;
    return {
      show: true,
      scenarios: {
        scenario1: {
          totalPaidDuringPromo: afterDiscounts,
          balanceAtEndPromo: 0,
          interestCharged: 0,
          totalAmountPaid: afterDiscounts,
        },
        scenario2: {
          totalPaidDuringPromo: 0,
          balanceAtEndPromo: balanceAfterDeferred,
          interestCharged: deferredInterest,
          totalAmountPaid: totalPostPromoPayments,
        },
      },
    };
  }, [activeCalc?.inputs?.paymentPlan, preOrderGrandTotal]);

  const confirmedCount = calculators.filter((c: any) => c.price > 0).length;
  const totalCount = calculators.length;
  const progressPct = (confirmedCount / totalCount) * 100;
  const allCalculatorsConfirmed = calculators.every((c: any) => c.price > 0);

  const isDuplicate = calculators.some((c: any, idx: number) => {
    if (idx === activeIdx) return false;
    return isCalculatorIdentical(activeCalc, c);
  });
  const scrollViewRef = useRef<ScrollView>(null);
  const downPaymentInputRef = useRef<any>(null);
  const downPaymentWrapperRef = useRef<View>(null);

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
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <View className={`flex-1 ${isJobBuilderSubmitted ? 'bg-surface' : 'bg-background'}`}>
        {/* Top Header & Tabs */}
        <View className="px-5 pt-4 pb-2 border-b border-border bg-card flex-row items-center">
          <TouchableOpacity
            onPress={() => setCurrentView('form')}
            className="p-2 mr-3 items-center justify-center border border-border rounded-xl bg-card shadow-sm"
          >
            <Feather name="arrow-left" size={18} color={colors.text} />
          </TouchableOpacity>

          {/*
            Stretch-aligned with a MINIMUM height, never a fixed one — a fixed `h-10`
            here clipped the calculator titles for a client running a raised OS text
            size. See the long note on the same strip in
            `screens/DynamicDealCenter/components/RolloutView.tsx` for the mechanism;
            this is the legacy copy of it and had the identical defect.
          */}
          <View
            pointerEvents="auto"
            className="flex-1 flex-row items-stretch"
            style={{ minHeight: calculators.length > 1 ? 40 : 48 }}
          >
            <View className="flex-1 relative flex-row items-stretch">
              <ScrollView
                ref={summaryTabsScrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                className="flex-1"
                contentContainerStyle={{ alignItems: 'stretch' }}
                scrollEventThrottle={16}
                onScroll={(e) => setScrollOffset(e.nativeEvent.contentOffset.x)}
                onContentSizeChange={(w) => setContentWidth(w)}
                onLayout={(e) => setScrollViewWidth(e.nativeEvent.layout.width)}
              >
                {calculators.map((calc: any, idx: number) => {
                  const isLocked = !!calc.dropPrice?.find((d: any) => d.status === 'accepted');
                  const isTabDuplicate = calculators.some((c: any, cIdx: number) => {
                    if (idx === cIdx) return false;
                    return isCalculatorIdentical(calc, c);
                  });
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setActiveIdx(idx)}
                      onLayout={(e) => onTabLayout(idx, e)}
                      className={`flex-row items-center justify-center self-stretch px-3 py-1 border-b-2 ${idx === activeIdx ? 'border-green-500' : 'border-transparent'
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
                        {isTabDuplicate && (
                          <Ionicons
                            name="warning"
                            size={12}
                            color="#FF990F"
                            style={{ marginRight: 6 }}
                          />
                        )}
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.3}
                          style={{ includeFontPadding: false }}
                          className={`text-sm font-black  ${idx === activeIdx ? 'text-text-primary' : 'text-text-secondary'
                            }`}
                        >
                          {!getCalculatorBaseName(calc) ? '' : calc.name || `Rollout ${idx + 1}`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Left Blur/Fade Overlay */}
              {scrollOffset > 5 && (
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' }} pointerEvents="none">
                  {[1.0, 0.8, 0.6, 0.4, 0.2, 0.08].map((opacity, idx) => (
                    <View
                      key={`left-blur-${idx}`}
                      style={{
                        width: 4,
                        height: '100%',
                        opacity: opacity,
                        overflow: 'hidden',
                      }}
                    >
                      <BlurView
                        style={{
                          position: 'absolute',
                          left: -idx * 4,
                          top: 0,
                          bottom: 0,
                          width: 24,
                        }}
                        blurType={isDark ? 'dark' : 'light'}
                        blurAmount={10}
                        reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255, 255, 255, 1)'}
                      />
                      {!isDark && (
                        <View
                          style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: 'rgba(255, 255, 255, 0.45)' }
                          ]}
                        />
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Right Blur/Fade Overlay */}
              {scrollOffset + scrollViewWidth < contentWidth - 5 && (
                <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' }} pointerEvents="none">
                  {[0.08, 0.2, 0.4, 0.6, 0.8, 1.0].map((opacity, idx) => (
                    <View
                      key={`right-blur-${idx}`}
                      style={{
                        width: 4,
                        height: '100%',
                        opacity: opacity,
                        overflow: 'hidden',
                      }}
                    >
                      <BlurView
                        style={{
                          position: 'absolute',
                          left: -idx * 4,
                          top: 0,
                          bottom: 0,
                          width: 24,
                        }}
                        blurType={isDark ? 'dark' : 'light'}
                        blurAmount={10}
                        reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255, 255, 255, 1)'}
                      />
                      {!isDark && (
                        <View
                          style={[
                            StyleSheet.absoluteFill,
                            { backgroundColor: 'rgba(255, 255, 255, 0.45)' }
                          ]}
                        />
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollViewRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 60 }}
          style={(isJobBuilderSubmitted || isJobSubmittedOnOtherCalc) ? { opacity: 0.6 } : undefined}
        >
          <View className="px-5 py-6">
            <View
              pointerEvents={(isJobBuilderSubmitted || isJobSubmittedOnOtherCalc) ? 'none' : 'auto'}
              className={`bg-card rounded-3xl p-5 border-2 ${isSaved ? 'border-green-500' : 'border-border'
                }`}
            >
              <View className="flex-row items-center justify-between mb-6">
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs font-semibold text-text-primary">{activeCalc.name}</Text>
                  {isDuplicate && (
                    <View className="bg-amber-500/10 px-2 py-0.5 rounded-md flex-row items-center border border-amber-500/20">
                      <Ionicons name="warning" size={10} color="#FF990F" />
                      <Text className="text-[8px] font-black text-[#FF990F] ml-1">IDENTICAL TO ANOTHER CALCULATOR</Text>
                    </View>
                  )}
                </View>
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
                    <TouchableOpacity
                      onPress={async () => {
                        const nextVal = !isDefaultPayment;
                        // Update the calculator-level flag locally
                        updateActive({ isDefaultPayment: nextVal });
                        handleSave();
                        // Mirror web: persist to user preference API and refresh user profile
                        try {
                          await SettingsService.updateCalculatorsSetting({
                            defaultPaymentMethod: nextVal ? activeCalc.inputs.paymentPlan : null,
                          });
                          await refreshUser();
                        } catch (e) {
                          console.warn('Failed to update default payment setting', e);
                        }
                        if (nextVal && activeCalc.isRolloutConfirmed && activeCalc.inputs?.paymentPlan) {
                          propagateDefaultPaymentPlan(activeCalc.inputs.paymentPlan);
                        }
                      }}
                      className={`w-8 h-5 rounded-full justify-center px-1 ${isDefaultPayment ? 'bg-green-500 items-end' : 'bg-slate-300 items-start'
                        }`}
                    >
                      <View className="w-3 h-3 bg-white rounded-full" />
                    </TouchableOpacity>
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


              {/* Divider */}
              <View style={{ height: 1, backgroundColor: '#F1F5F9', marginBottom: 14 }} />

              {/* Category filter pills — wrapping */}
              <View style={{
                flexDirection: 'row', flexWrap: 'wrap',
                marginBottom: 14, gap: 8,
              }}>
                {uniqueCategories.map((cat: any) => {
                  const count = categoryCounts[cat] || 0;
                  const CATEGORY_STYLES: Record<string, { color: string; icon: string; bg: string }> = {
                    Gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
                    LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
                    Soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
                    Fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
                    Lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
                    'Additional Services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
                    Miscellaneous: { color: '#637381', icon: 'ellipsis-horizontal-circle', bg: '#F4F6F8' },
                  };
                  const s = CATEGORY_STYLES[cat] || { color: '#637381', icon: 'list', bg: '#F4F6F8' };
                  const isActive = selectedCat === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setSelectedCat(isActive ? null : cat)}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
                        backgroundColor: isActive ? s.color : s.bg,
                      }}
                    >
                      <Ionicons name={s.icon} size={11} color={isActive ? '#FFF' : s.color} style={{ marginRight: 4 }} />
                      <Text style={{ fontSize: 11, fontWeight: '900', color: isActive ? '#FFF' : s.color }}>
                        {cat} {count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Items */}
              {visibleItems.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                  <Ionicons name="cube-outline" size={32} color="#CBD5E1" />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginTop: 8 }}>
                    No items in this category
                  </Text>
                </View>
              ) : (
                visibleItems.map((item: any, i: number) => {
                  const CATEGORY_STYLES: Record<string, { color: string; icon: string; bg: string }> = {
                    Gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
                    LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
                    Soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
                    Fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
                    Lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
                    'Additional Services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
                    Miscellaneous: { color: '#637381', icon: 'ellipsis-horizontal-circle', bg: '#F4F6F8' },
                  };
                  const s = CATEGORY_STYLES[item.category] || { color: '#637381', icon: 'list', bg: '#F4F6F8' };
                  const isLast = i === visibleItems.length - 1;
                  return (
                    <View key={i}>
                      <View style={{
                        flexDirection: 'row', alignItems: 'center',
                        paddingVertical: 12,
                      }}>
                        <View style={{
                          width: 36, height: 36, borderRadius: 18,
                          backgroundColor: s.bg, alignItems: 'center', justifyContent: 'center',
                          marginRight: 14,
                        }}>
                          <Ionicons name={s.icon} size={17} color={s.color} />
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C252E', flex: 1 }}>
                          <Text style={{ fontWeight: '900' }}>{item.value}{item.unit || "'"}</Text>
                          {'  '}{item.label}
                        </Text>
                      </View>
                      {!isLast && (
                        <View style={{ height: 1, backgroundColor: '#F1F5F9', marginLeft: 50 }} />
                      )}
                    </View>
                  );
                })
              )}

              {/* Divider before pricing */}
              <View style={{ height: 1, backgroundColor: '#F1F5F9', marginTop: 14, marginBottom: 16 }} />


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
                {activeCalc.isRolloutConfirmed ? (
                  <TouchableOpacity
                    onPress={() => setShowLockedDetails((prev) => !prev)}
                    className="flex-row items-center justify-between bg-card border-2 border-green-500 rounded-2xl px-4 h-16 shadow-sm"
                  >
                    <View className="flex-row items-center">
                      <Text className="text-xl font-black text-green-600 mr-2">$</Text>
                      <Text className="text-xl font-black text-green-600">
                        {String(effectiveEndPrice || '')}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View className="flex-row items-center bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                        <Ionicons name="lock-closed" size={12} color="#16A34A" />
                        <Text className="text-[10px] font-black text-green-600  ml-1.5 tracking-wider">
                          LOCKED
                        </Text>
                      </View>
                      <Ionicons
                        name={showLockedDetails ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="#16A34A"
                      />
                    </View>
                  </TouchableOpacity>
                ) : (
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
                      className={`font-black mr-2 ${activeDrop || isSaved ? 'text-green-600' : 'text-text-secondary'}`}
                      style={{ fontSize: 16, lineHeight: 20 }}
                    >
                      $
                    </Text>
                    <TextInput
                      className={`flex-1 font-black p-0 ${activeDrop || activeCalc.isRolloutConfirmed
                        ? 'text-green-600'
                        : 'text-text-primary'
                        }`}
                      style={{
                        fontSize: 16,
                        padding: 0,
                        margin: 0,
                        height: 24,
                        textAlignVertical: 'center',
                      }}
                      value={activeDrop || activeCalc.isRolloutConfirmed ? String(effectiveEndPrice || '') : priceText}
                      placeholder="Enter End Price"
                      placeholderTextColor="#919EAB"
                      keyboardType="numeric"
                      editable={!activeCalc.isRolloutConfirmed && !activeDrop && !isJobBuilderSubmitted}
                      onChangeText={handlePriceChange}
                      onEndEditing={handlePriceBlur}
                      onFocus={() => {
                        setTimeout(() => {
                          scrollViewRef.current?.scrollToEnd({ animated: true });
                        }, 100);
                      }}
                    />
                    {activeDrop ? (
                      <View className="flex-row items-center bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/20">
                        <Ionicons name="lock-closed" size={12} color="#16A34A" />
                        <Text className="text-[10px] font-black text-green-600  ml-1.5 tracking-wider">
                          LOCKED
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
                {error && !showDropInput && (
                  <Text className="text-[10px] font-bold text-red-500 mt-2 ml-1 ">{error}</Text>
                )}
              </View>


            </View>

            {/* New Result Section - Only show when price is entered and NOT confirmed, OR if locked and dropdown is open */}
            {((endPrice > 0 && !error && !activeCalc.isRolloutConfirmed) ||
              (activeCalc.isRolloutConfirmed && showLockedDetails)) && (
                <View pointerEvents={(isJobBuilderSubmitted || isJobSubmittedOnOtherCalc) ? 'none' : 'auto'} className="mt-8">
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
                            <Text className="text-[8px] font-bold text-text-secondary mr-1.5">
                              Default
                            </Text>
                            <TouchableOpacity
                              disabled={!currentDiscount}
                              onPress={async () => {
                                const nextVal = !isDefaultDiscount;
                                try {
                                  await SettingsService.updateCalculatorsSetting({
                                    defaultPercentage: nextVal ? currentDiscount : null,
                                  });
                                  await refreshUser();
                                } catch (e) {
                                  console.warn('Failed to update default discount setting', e);
                                }
                              }}
                              className={`w-8 h-5 rounded-full justify-center px-1 ${isDefaultDiscount
                                ? 'bg-green-500 items-end'
                                : !currentDiscount
                                  ? 'bg-slate-200 items-start opacity-40'
                                  : 'bg-slate-300 items-start'
                                }`}
                            >
                              <View className="w-3 h-3 bg-white rounded-full shadow-sm" />
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

                        {(preOrderDownPayment > 0 || showPreOrderDownPaymentInput) ? (
                          <View style={{ opacity: preOrderDownPayment > 0 ? 1 : 0 }}>
                            <View className="flex-row justify-between mb-2">
                              <Text className="text-[10px] font-medium text-green-600">Down Payment</Text>
                              <Text className="text-[10px] font-black text-green-600">
                                -{fCurrency(preOrderDownPayment)}
                              </Text>
                            </View>
                            <View style={{ height: 1, borderStyle: 'dashed', borderWidth: 0.5, borderColor: '#CBD5E1', marginBottom: 12 }} />
                          </View>
                        ) : null}

                        {!showPreOrderDownPaymentInput ? (
                          <TouchableOpacity
                            onPress={() => {
                              setShowPreOrderDownPaymentInput(true);
                              setTimeout(() => {
                                downPaymentInputRef.current?.focus();
                              }, 150);
                            }}
                            className="mt-2 mb-4 py-2 border border-dashed border-[#2196F3] rounded-xl items-center justify-center flex-row gap-1 bg-[#2196F3]/5"
                          >
                            <Ionicons name="add" size={14} color="#2196F3" />
                            <Text className="text-[10px] font-bold text-[#2196F3]">
                              {preOrderDownPayment > 0 ? `Down Payment: ${fCurrency(preOrderDownPayment)}` : 'Add Down Payment'}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <View
                            ref={downPaymentWrapperRef}
                            collapsable={false}
                            className="mt-2 mb-4 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex-row items-center justify-between min-h-[40px]"
                          >
                            <View collapsable={false} className="flex-row items-center flex-1">
                              <Text className="text-xs font-bold text-slate-500 mr-1">$</Text>
                              <TextInput
                                ref={downPaymentInputRef}
                                autoFocus={true}
                                className="text-xs font-black text-slate-800 p-0 flex-1"
                                keyboardType="numeric"
                                value={preOrderDownPayment > 0 ? String(preOrderDownPayment) : ''}
                                placeholder="Down Payment"
                                placeholderTextColor="#919EAB"
                                style={{ paddingVertical: 0, height: 24 }}
                                onChangeText={(t) => {
                                  const val = Number(t.replace(/[^0-9]/g, ''));
                                  setPreOrderDownPayment(val);
                                }}
                                onFocus={() => {
                                  setTimeout(() => {
                                    if (downPaymentWrapperRef.current && scrollViewRef.current) {
                                      downPaymentWrapperRef.current.measureLayout(
                                        scrollViewRef.current as any,
                                        (_left: number, top: number, _width: number, _height: number) => {
                                          scrollViewRef.current?.scrollTo({ y: Math.max(0, top - 75), animated: true });
                                        },
                                        () => { }
                                      );
                                    }
                                  }, 150);
                                }}

                                onBlur={async () => {
                                  updateActive({ downPayment: preOrderDownPayment });
                                  try {
                                    await LeadService.updateCalculator(activeCalc._id, { downPayment: preOrderDownPayment });
                                  } catch (err) {
                                    console.warn('Failed to save down payment', err);
                                  }
                                  if (preOrderDownPayment === 0) {
                                    setShowPreOrderDownPaymentInput(false);
                                  }
                                }}
                              />
                            </View>
                            {preOrderDownPayment > 0 && (
                              <TouchableOpacity
                                onPress={async () => {
                                  setPreOrderDownPayment(0);
                                  setShowPreOrderDownPaymentInput(false);
                                  updateActive({ downPayment: 0 });
                                  try {
                                    await LeadService.updateCalculator(activeCalc._id, { downPayment: 0 });
                                  } catch (err) {
                                    console.warn('Failed to clear down payment', err);
                                  }
                                }}
                              >
                                <Ionicons name="close-circle" size={14} color="#FF5630" />
                              </TouchableOpacity>
                            )}
                          </View>
                        )}

                        <View className="items-center">
                          <Text className="text-lg font-black text-blue-400 mb-1">
                            {fCurrency(calculateMonthly(preOrderGrandTotal - preOrderDownPayment))}/mo
                          </Text>
                          <Text className="text-[8px] text-text-secondary text-center px-2">
                            {paymentPlans[activeCalc.inputs.paymentPlan]?.label ||
                              '1019 (12 months no interest option)'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Deferred Financing Scenarios (web parity: summary/DeferredScenarios.js) */}
                  {deferredInfo.show && deferredInfo.scenarios && (
                    <View className="rounded-3xl p-5 mb-6 border border-[#FFAB0033] bg-[#FFAB000D]">
                      <Text className="text-sm font-black text-[#B76E00] mb-4">
                        Deferred Financing Scenarios
                      </Text>

                      {/* Scenario 1: Paid Off Within Promo Period */}
                      <View className="rounded-2xl p-4 mb-4 bg-[#00B8D90D]">
                        <Text className="text-xs font-black text-[#006C9C] mb-3">
                          Scenario 1: Paid Off Within Promo Period
                        </Text>
                        <View className="flex-row justify-between mb-1.5">
                          <Text className="text-[10px] font-medium text-text-secondary">Payments During Promo:</Text>
                          <Text className="text-[10px] font-black text-text-primary">
                            ${deferredInfo.scenarios.scenario1.totalPaidDuringPromo.toFixed(2)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between mb-1.5">
                          <Text className="text-[10px] font-medium text-text-secondary">Balance at End of Promo:</Text>
                          <Text className="text-[10px] font-black text-text-primary">
                            ${deferredInfo.scenarios.scenario1.balanceAtEndPromo.toFixed(2)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between mb-1.5">
                          <Text className="text-[10px] font-medium text-text-secondary">Interest Charged:</Text>
                          <Text className="text-[10px] font-black text-text-primary">
                            ${deferredInfo.scenarios.scenario1.interestCharged.toFixed(2)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between">
                          <Text className="text-[10px] font-medium text-text-secondary">Total Amount Paid:</Text>
                          <Text className="text-[10px] font-black text-[#118D57]">
                            ${deferredInfo.scenarios.scenario1.totalAmountPaid.toFixed(2)}
                          </Text>
                        </View>
                      </View>

                      {/* Scenario 2: Not Paid Off Within Promo Period */}
                      <View className="rounded-2xl p-4 bg-[#FF56300D]">
                        <Text className="text-xs font-black text-[#B71D18] mb-3">
                          Scenario 2: Not Paid Off Within Promo Period
                        </Text>
                        <View className="flex-row justify-between mb-1.5">
                          <Text className="text-[10px] font-medium text-text-secondary">Payments During Promo:</Text>
                          <Text className="text-[10px] font-black text-text-primary">
                            ${deferredInfo.scenarios.scenario2.totalPaidDuringPromo.toFixed(2)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between mb-1.5">
                          <Text className="text-[10px] font-medium text-text-secondary">Balance at End of Promo:</Text>
                          <Text className="text-[10px] font-black text-text-primary">
                            ${deferredInfo.scenarios.scenario2.balanceAtEndPromo.toFixed(2)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between mb-1.5">
                          <Text className="text-[10px] font-medium text-text-secondary">Interest Charged (Deferred):</Text>
                          <Text className="text-[10px] font-black text-text-primary">
                            ${deferredInfo.scenarios.scenario2.interestCharged.toFixed(2)}
                          </Text>
                        </View>
                        <View className="flex-row justify-between">
                          <Text className="text-[10px] font-medium text-text-secondary">Total Amount Paid:</Text>
                          <Text className="text-[10px] font-black text-[#B71D18]">
                            ${deferredInfo.scenarios.scenario2.totalAmountPaid.toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
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
                {droppedPrices && droppedPrices.length > 0 && (
                  <View pointerEvents={(isJobBuilderSubmitted || isJobSubmittedOnOtherCalc) ? 'none' : 'auto'} className="mt-8">
                    {droppedPrices.map((drop: any, idx: number) => {
                      const isSecured = drop.secured;
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
                              {!drop.declined && (
                                <TouchableOpacity onPress={() => {
                                  if (isSecured) {
                                    setShowResultModal(true);
                                  } else {
                                    setDisplayDrop(drop);
                                    setDisplayDropIndex(idx);
                                    setDownPayment(drop.downPayment || 0);
                                    setDisplayShowDownPaymentInput(!!drop.downPayment && drop.downPayment > 0);
                                    setAddedPlans(drop.addedPlans || []);
                                    setSelectedPlan(drop.paymentMethod || '');
                                  }
                                }}>
                                  <Text
                                    className={`text-[11px] font-bold ${isSecured ? 'text-green-600' : 'text-slate-500'
                                      }`}
                                  >
                                    View
                                  </Text>
                                </TouchableOpacity>
                              )}
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
                              {fCurrency(drop.price)}
                            </Text>
                            <View className="flex-row items-center gap-4">
                              <TouchableOpacity
                                onPress={() => {
                                  setDisplayDrop(drop);
                                  setDisplayDropIndex(idx);
                                  setDownPayment(drop.downPayment || 0);
                                  setDisplayShowDownPaymentInput(!!drop.downPayment && drop.downPayment > 0);
                                  setAddedPlans(drop.addedPlans || []);
                                  setSelectedPlan(drop.paymentMethod || '');
                                }}
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
                          const costPrice = Math.round(results.costAtCheck ?? results.price50);
                          const endPrice = Number(activeCalc.price) || 0;
                          const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;

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
                            if (WELLS_FARGO_HIGH_KEYS.includes(dropPaymentMethod) && num < WF_HIGH_MIN_PRICE) {
                              setError(
                                `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`
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
                            setDisplayDrop(null);
                            setShowDropModal(true);
                            setShowDropInput(false);
                          }
                        }}
                        onBlur={() => {
                          const num = Number(dropValue.replace(/[^0-9.]/g, ''));
                          const costPrice = Math.round(results.costAtCheck ?? results.price50);
                          const endPrice = Number(activeCalc.price) || 0;
                          const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;

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
                            if (WELLS_FARGO_HIGH_KEYS.includes(dropPaymentMethod) && num < WF_HIGH_MIN_PRICE) {
                              setError(
                                `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`
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
                            setDisplayDrop(null);
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
                <View
                  className="flex-row gap-4 mb-0"
                  pointerEvents={isJobSubmittedOnOtherCalc ? 'none' : 'auto'}
                >
                  {/* Drop button — disabled when job builder has been submitted */}
                  <TouchableOpacity
                    disabled={isJobBuilderSubmitted || isJobSubmittedOnOtherCalc}
                    onPress={() => {
                      if (showDropInput) {
                        const num = Number(dropValue.replace(/[^0-9.]/g, ''));
                        const costPrice = Math.round(results.costAtCheck ?? results.price50);
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
                          const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;
                          if (WELLS_FARGO_HIGH_KEYS.includes(dropPaymentMethod) && num < WF_HIGH_MIN_PRICE) {
                            setError(
                              `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`
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
                          setDisplayDrop(null);
                          setShowDropModal(true);
                          setShowDropInput(false);
                        }
                      } else {
                        setDropValue('');
                        setShowDropInput(true);
                        setDownPayment(0);
                        setShowDownPaymentInput(false);
                        setSelectedPlan('');
                        setAddedPlans([]);
                        setDisplayDrop(null);
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
                      {`+ ${getOrdinal(droppedPrices.length + 1)} Drop`}
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
                          droppedPrices.length > 0
                            ? droppedPrices[droppedPrices.length - 1].price
                            : activeCalc.price
                        )}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Progress Footer */}
        {!activeCalc.isRolloutConfirmed && (
          <View
            className="px-6 py-6 border-t border-border bg-card"
            style={{ paddingBottom: Platform.OS === 'ios' ? insets.bottom : insets.bottom + 10 }}
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

              <ScrollView className="px-4 pt-3 pb-4" showsVerticalScrollIndicator={false}>
                {getRolloutPaymentCategories(isLowesLead).map((cat) => (
                  <View key={cat.title} className={cat.title ? 'mb-4' : 'mb-2'}>
                    {!!cat.title && (
                      <View className={`px-4 py-2 mb-2 rounded-lg ${cat.bg}`}>
                        <Text className={`text-[10px] font-black tracking-widest ${cat.text}`}>
                          {cat.title}
                        </Text>
                      </View>
                    )}
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
                          {plan.minPrice && belowMin && (
                            <Text
                              className={`text-[10px] font-bold mt-1 ${belowMin ? 'text-slate-800' : 'text-slate-400'
                                }`}
                            >
                              Requires ${plan.minPrice?.toLocaleString()}+
                              {/* {rolloutEndPrice > 0
                                ? ` (current: $${rolloutEndPrice.toLocaleString()})`
                                : ' — enter end price first'} */}
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
                className="mx-4 mb-4 h-14 bg-slate-900 rounded-2xl items-center justify-center"
              >
                <Text className="text-white font-black text-sm ">Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Price Declined Modal */}
        <Modal visible={declinedPrice !== null} transparent animationType="fade">
          <View className="flex-1 justify-center px-5">
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setDeclinedPrice(null)}
            >
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={isDark ? 'dark' : 'light'}
                blurAmount={10}
                reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
              />
            </TouchableOpacity>

            <View className="bg-white rounded-3xl p-6 shadow-2xl items-center relative">
              <TouchableOpacity
                onPress={() => setDeclinedPrice(null)}
                className="absolute top-4 right-4 w-10 h-10 bg-red-50 rounded-full items-center justify-center z-10"
              >
                <Ionicons name="close" size={24} color="#FF5630" />
              </TouchableOpacity>

              <View className="w-20 h-20 bg-red-50 rounded-full items-center justify-center mb-6 mt-4">
                <Ionicons name="close" size={40} color="#FF5630" />
              </View>

              <Text className="text-2xl font-black text-slate-900 mb-4 text-center">
                Price Declined
              </Text>

              <Text className="text-sm font-medium text-slate-500 text-center mb-8 px-4 leading-6">
                ${(declinedPrice || 0).toLocaleString()} was not accepted. What would you like to do?
              </Text>

              <View className="w-full gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setDeclinedPrice(null);
                    handleStatusSelect('demo');
                  }}
                  className="w-full h-14 bg-[#FF9800] rounded-xl items-center justify-center shadow-lg shadow-orange-100"
                >
                  <Text className="text-white font-black text-base">Result Lead</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setDeclinedPrice(null)}
                  className="w-full h-14 border-2 border-slate-200 rounded-xl items-center justify-center bg-white"
                >
                  <Text className="text-slate-500 font-black text-base">Exit</Text>
                </TouchableOpacity>
              </View>
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
                  droppedPrices.length > 0
                    ? droppedPrices[droppedPrices.length - 1].price
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


        {(() => {
          const isDisplayMode = displayDropIndex !== -1;
          const isVisible = showDropModal || isDisplayMode;
          // Web parity: use local droppedPrices for display mode, dropValue for new entry
          const currentDropPrice = isDisplayMode
            ? (droppedPrices[displayDropIndex]?.price || 0)
            : (Number(dropValue) || 0);
          // Unified down payment: both modes now use the same `downPayment` state
          const currentDownPayment = downPayment;
          const currentShowDownPaymentInput = displayShowDownPaymentInput || showDownPaymentInput;

          const handleCurrentSetDownPayment = (dp: number) => {
            setDownPayment(dp);
          };

          const handleCurrentSetShowDownPaymentInput = (show: boolean) => {
            if (isDisplayMode) {
              setDisplayShowDownPaymentInput(show);
            } else {
              setShowDownPaymentInput(show);
            }
          };

          const handleCurrentDecline = () => {
            const price = currentDropPrice;
            const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;
            const costPrice = Math.round(results.costAtCheck ?? results.price50);

            if (price < costPrice) {
              Alert.alert(
                'Invalid Price',
                `Drop price must be at least the cost price ($${costPrice.toLocaleString()}).`
              );
              return;
            }

            if (WELLS_FARGO_HIGH_KEYS.includes(dropPaymentMethod) && price < WF_HIGH_MIN_PRICE) {
              Alert.alert(
                'Invalid Price',
                `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`
              );
              return;
            }

            // Close drop modal immediately and show declined modal right away
            if (showDropModal) setShowDropModal(false);
            if (displayDropIndex !== -1) { setDisplayDrop(null); setDisplayDropIndex(-1); }
            setDeclinedPrice(price);
            // Run the async save in the background
            if (isDisplayMode) {
              handleDisplayDropAction('declined').catch((e) => console.warn('handleDisplayDropAction decline error', e));
            } else {
              handleAddDrop('declined').catch((e) => console.warn('handleAddDrop decline error', e));
            }
          };

          const handleCurrentAccept = () => {
            const price = currentDropPrice;
            const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;
            const costPrice = Math.round(results.costAtCheck ?? results.price50);

            if (price < costPrice) {
              Alert.alert(
                'Invalid Price',
                `Drop price must be at least the cost price ($${costPrice.toLocaleString()}).`
              );
              return;
            }

            if (WELLS_FARGO_HIGH_KEYS.includes(dropPaymentMethod) && price < WF_HIGH_MIN_PRICE) {
              Alert.alert(
                'Invalid Price',
                `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}`
              );
              return;
            }

            // Close drop modal immediately and show result modal right away
            if (showDropModal) setShowDropModal(false);
            if (displayDropIndex !== -1) { setDisplayDrop(null); setDisplayDropIndex(-1); }
            setShowResultModal(true);
            // Run the async save in the background
            if (isDisplayMode) {
              handleDisplayDropAction('accepted').catch((e) => console.warn('handleDisplayDropAction accept error', e));
            } else {
              handleAddDrop('accepted').catch((e) => console.warn('handleAddDrop accept error', e));
            }
          };

          const modalContent = (
            <View className="flex-1 justify-center px-5">
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => {
                  if (showDropModal) setShowDropModal(false);
                  if (displayDropIndex !== -1) { setDisplayDrop(null); setDisplayDropIndex(-1); }
                }}
              >
                <BlurView
                  style={StyleSheet.absoluteFill}
                  blurType={isDark ? 'dark' : 'light'}
                  blurAmount={10}
                  reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
                />
              </TouchableOpacity>
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
                      {fCurrency(currentDropPrice)}
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

                  {!currentShowDownPaymentInput ? (
                    <TouchableOpacity
                      onPress={() => {
                        handleCurrentSetShowDownPaymentInput(true);
                        setTimeout(() => {
                          dpInputRef.current?.focus();
                        }, 150);
                      }}
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
                          collapsable={false}
                          className="bg-white border-2 border-slate-900 rounded-2xl px-3 py-2"
                        >
                          <Text className="text-[10px] font-black text-slate-900 absolute -top-2 left-3 bg-white px-1">
                            Down Payment
                          </Text>
                          <View ref={dpWrapperRef} collapsable={false} className="flex-row items-center h-6">
                            <Text
                              className="text-base font-bold text-slate-900 mr-1"
                              style={{ includeFontPadding: false, textAlignVertical: 'center' }}
                            >
                              $
                            </Text>
                            <TextInput
                              ref={dpInputRef}
                              autoFocus={true}
                              className="flex-1 font-bold text-base text-slate-900 p-0"
                              style={{
                                padding: 0,
                                paddingVertical: 0,
                                margin: 0,
                                textAlignVertical: 'center',
                                includeFontPadding: false,
                                top: Platform.OS == 'android' ? 2 : -4,
                              }}
                              onFocus={() => {
                                setTimeout(() => {
                                  if (dpWrapperRef.current && scrollViewRef.current) {
                                    dpWrapperRef.current.measureLayout(
                                      scrollViewRef.current as any,
                                      (_left: number, top: number, _width: number, _height: number) => {
                                        scrollViewRef.current?.scrollTo({ y: Math.max(0, top - 75), animated: true });
                                      },
                                      () => { }
                                    );
                                  }
                                }, 150);
                              }}
                              keyboardType="numeric"
                              value={String(currentDownPayment || '')}
                              onChangeText={(t) => handleCurrentSetDownPayment(Number(t.replace(/[^0-9]/g, '')))}
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
                          <View className="flex-row items-center h-6">
                            <Text
                              className="text-base font-bold text-slate-400 mr-1"
                              style={{ includeFontPadding: false, textAlignVertical: 'center', lineHeight: 24 }}
                            >
                              $
                            </Text>
                            <Text
                              className="text-base font-bold text-slate-400"
                              style={{ includeFontPadding: false, textAlignVertical: 'center', lineHeight: 24 }}
                            >
                              {Math.max(0, currentDropPrice - currentDownPayment).toLocaleString()}
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
                    {addedPlans
                      .filter((p) => !['check', 'mcVisaDscvr', 'amex', 'lowes_ach', 'lowes_cc'].includes(p))
                      .map((planKey, idx) => {
                        console.log('planKey', planKey);
                        const plan = paymentPlans[planKey];
                        const balance = Math.max(0, currentDropPrice - currentDownPayment);
                        const monthly = calculateMonthly(balance, planKey);
                        const isSelected = selectedPlan === planKey;
                        const belowMin = !!(plan?.minPrice && currentDropPrice > 0 && currentDropPrice < plan.minPrice);

                        const planTitle = getPlanLabel(planKey);
                        const planDesc = plan.label.includes('(')
                          ? plan.label.split('(')[1].split(')')[0]
                          : plan.label;

                        const renderRightActions = (
                          prog: any,
                          drag: any
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
                          <Animated.View
                            key={planKey}
                            layout={LinearTransition}
                            exiting={FadeOut}
                          >
                            <Swipeable
                              renderRightActions={renderRightActions}
                              rightThreshold={40}
                              onSwipeableWillOpen={() => {
                                // We can use a slight delay if we want, or rely on exiting animation
                                const newPlans = addedPlans.filter((k) => k !== planKey);
                                setAddedPlans(newPlans);
                                if (selectedPlan === planKey) {
                                  setSelectedPlan(newPlans[0] || (isLowesLead ? 'lowes_ach' : 'check'));
                                }
                              }}
                            >
                              <TouchableOpacity
                                onPress={() => {
                                  if (belowMin) {
                                    Alert.alert(
                                      'Minimum price',
                                      `This plan requires a minimum price of $${plan.minPrice.toLocaleString()} (Entered: $${currentDropPrice.toLocaleString()}).`
                                    );
                                    return;
                                  }
                                  const oldPlan = selectedPlan || activeCalc.inputs?.paymentPlan || '';
                                  setSelectedPlan(planKey);
                                  logDropPlanSelect(planKey, currentDropPrice, oldPlan);
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
                          </Animated.View>
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
                    onPress={handleCurrentDecline}
                    className="flex-1 h-14 bg-[#FF5630] rounded-2xl items-center justify-center shadow-lg shadow-red-100"
                  >
                    <Text className="text-white font-black text-base">Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!selectedPlan}
                    onPress={handleCurrentAccept}
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

              {/* Plan Picker Modal - NESTED inside so it layers perfectly on iOS */}
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
                                const belowMin = isPlanBelowMinPrice(key, currentDropPrice);
                                return (
                                  <TouchableOpacity
                                    key={key}
                                    onPress={() => {
                                      if (belowMin) {
                                        Alert.alert(
                                          'Payment plan',
                                          getBelowMinMessage(key, currentDropPrice)
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
                                        className={`text-[9px] font-bold mt-1 ${belowMin ? 'text-slate-900' : 'text-slate-400'
                                          }`}
                                      >
                                        Requires ${plan.minPrice?.toLocaleString()}+
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
            </View>
          );

          return (
            <Modal visible={isVisible} transparent animationType="fade">
              {Platform.OS === 'android' ? (
                <GestureHandlerRootView style={{ flex: 1 }}>
                  {modalContent}
                </GestureHandlerRootView>
              ) : (
                modalContent
              )}
            </Modal>
          );
        })()}
        <LoadingOverlay visible={isSaving} message="Saving dropped price..." />
      </View>
    </KeyboardAvoidingView>
  );
};

