import { useState, useEffect } from 'react';
import { paymentPlans } from '../utils/calculator/payment-plans';
import { LeadService } from '../services/api/leads';
import { calculateResultUtil } from '../utils/calculator/calculation-results-util';
import { pricing, extrasList, extrasList50 } from '../utils/calculator/pricing-data';
import {
  validatePriceForPaymentMethod,
  WELLS_FARGO_HIGH_KEYS,
  WF_HIGH_MIN_PRICE,
} from '../utils/calculator/payment-method-validation';

const getCostPriceForCalc = (calc: any, isLowesLead?: boolean): number => {
  const price50 = calculateResultUtil({
    details: calc,
    markupKey: '50',
    pricing,
    extrasList,
    extrasList50,
    paymentPlans,
    paymentMethod: calc.inputs?.paymentPlan || calc.paymentMethod || 'check',
    hideScreens: true,
    isLowesLead,
  });
  return Math.round(price50);
};

export const useCalculatorSummary = (
  activeCalc: any,
  results: any,
  calculators: any,
  updateActive: any,
  handleSave: any,
  refresh: any,
  isLowesLead?: boolean,
  setCalculators?: any
) => {
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showDropModal, setShowDropModal] = useState(false);
  const [dropValue, setDropValue] = useState('');
  const [showDropInput, setShowDropInput] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isPlanPickerVisible, setIsPlanPickerVisible] = useState(false);
  const [currentDiscount, setCurrentDiscount] = useState(
    Number(activeCalc.inputs.discountPercentage) || 15
  );
  const [displayDrop, setDisplayDrop] = useState<any>(null);
  const [downPayment, setDownPayment] = useState(0);
  const [showDownPaymentInput, setShowDownPaymentInput] = useState(false);
  const [addedPlans, setAddedPlans] = useState<string[]>([]);
  const [tempPlan, setTempPlan] = useState<string | null>(null);

  // Local string state so the TextInput is never reset mid-typing
  const [priceText, setPriceText] = useState<string>(
    activeCalc.price ? String(activeCalc.price) : ''
  );

  // Keep priceText in sync when activeCalc.price changes externally
  // (e.g. switching between rollout tabs) but NOT while the user is typing
  useEffect(() => {
    setPriceText(activeCalc.price ? String(activeCalc.price) : '');
  }, [activeCalc._id]);

  const handleAddDrop = async (status = 'declined') => {
    const num = Number(dropValue.replace(/[^0-9.]/g, ''));
    const costPrice = Math.round(results.price50);
    const endPrice = Number(activeCalc.price) || 0;
    const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;

    if (num < costPrice) {
      setError(`Drop price cannot be less than cost ($${costPrice.toLocaleString()})`);
      return;
    }

    if (endPrice > 0 && num > endPrice) {
      setError(`Drop price cannot exceed rollout end price ($${endPrice.toLocaleString()})`);
      return;
    }

    const methodValidation = validatePriceForPaymentMethod(num, dropPaymentMethod);
    if (!methodValidation.isValid) {
      setError(methodValidation.message);
      return;
    }

    if (WELLS_FARGO_HIGH_KEYS.includes(dropPaymentMethod) && num < WF_HIGH_MIN_PRICE) {
      setError(
        `This Wells Fargo plan requires a minimum price of $${WF_HIGH_MIN_PRICE.toLocaleString()}.`
      );
      return;
    }

    try {
      const newDrop = {
        dropedPrice: num,
        status,
        paymentMethod: dropPaymentMethod,
        downPayment,
        addedPlans,
      };

      const updatedDrops = (activeCalc.dropPrice || []).map((d: any) =>
        status === 'accepted' ? { ...d, status: 'declined' } : d
      );
      updatedDrops.push(newDrop);

      const payload: any = {
        ...activeCalc.inputs,
        ...activeCalc.extras,
        title: activeCalc.name,
        price: status === 'accepted' ? num : activeCalc.price,
        isRolloutConfirmed: true,
        dropPrice: updatedDrops,
      };

      if (status === 'accepted') {
        payload.paymentPlan = dropPaymentMethod;
        payload.paymentMethod = dropPaymentMethod;
      }

      updateActive({
        dropPrice: updatedDrops,
        price: status === 'accepted' ? num : activeCalc.price,
        isRolloutConfirmed: true,
        inputs: {
          ...activeCalc.inputs,
          paymentPlan: status === 'accepted' ? dropPaymentMethod : activeCalc.inputs.paymentPlan,
        },
      });

      await LeadService.updateCalculator(activeCalc._id, payload);
      setShowDropModal(false);
      setDropValue('');
      setSelectedPlan(null);
    } catch (e) {
      console.warn('Failed to add drop', e);
    }
  };

  const handleUnselectDrop = async (index: number) => {
    try {
      const updatedDrops = (activeCalc.dropPrice || []).map((drop: any, i: number) => {
        if (i === index) return { ...drop, status: 'declined' };
        return drop;
      });

      const payload = {
        ...activeCalc.inputs,
        ...activeCalc.extras,
        title: activeCalc.name,
        price: activeCalc.price,
        isRolloutConfirmed: true,
        dropPrice: updatedDrops,
      };

      updateActive({ dropPrice: updatedDrops });
      await LeadService.updateCalculator(activeCalc._id, payload);
    } catch (e) {
      console.warn('Failed to unselect drop', e);
    }
  };

  // Called on every keystroke — only updates local display string, no save
  const handlePriceChange = (val: string) => {
    // Strip non-numeric characters except decimal point
    const cleaned = val.replace(/[^0-9.]/g, '');
    setPriceText(cleaned);
    if (error) setError(null);
  };

  // Called when the user finishes editing (onEndEditing / onBlur)
  const handlePriceBlur = () => {
    const num = Number(priceText.replace(/[^0-9.]/g, ''));
    const costPrice = Math.round(results.price50);
    const activePaymentMethod = activeCalc.inputs.paymentPlan;
    const planName = activePaymentMethod.startsWith('wf')
      ? 'Wells Fargo'
      : activePaymentMethod.startsWith('greensky')
      ? 'GreenSky'
      : activePaymentMethod.startsWith('lowes')
      ? "Lowe's"
      : 'This plan';

    if (num > 0) {
      if (num < costPrice) {
        setError(`Price cannot be less than cost ($${costPrice.toLocaleString()})`);
        return;
      }
      if (WELLS_FARGO_HIGH_KEYS.includes(activePaymentMethod) && num < WF_HIGH_MIN_PRICE) {
        setError(`${planName} High plans require a minimum of $${WF_HIGH_MIN_PRICE.toLocaleString()}`);
        return;
      }
      const methodValidation = validatePriceForPaymentMethod(num, activePaymentMethod);
      if (!methodValidation.isValid) {
        setError(methodValidation.message);
        return;
      }
    }
    updateActive({ price: num });
    handleSave();
  };

  const handleConfirmAll = async () => {
    try {
      setIsConfirming(true);

      for (const calc of calculators) {
        if (calc.isRolloutConfirmed) continue;
        const enteredPrice = Number(calc.price) || 0;
        if (enteredPrice <= 0) continue;

        const activeMethod = calc.inputs?.paymentPlan || calc.paymentMethod || 'check';
        const costPrice = getCostPriceForCalc(calc, isLowesLead);

        if (enteredPrice < costPrice) {
          setError(
            `"${calc.name}" rollout price ($${enteredPrice.toLocaleString()}) is below cost ($${costPrice.toLocaleString()}). Please update it before confirming.`
          );
          return;
        }
        if (WELLS_FARGO_HIGH_KEYS.includes(activeMethod) && enteredPrice < WF_HIGH_MIN_PRICE) {
          setError(
            `"${calc.name}" uses a Wells Fargo $7,500+ plan but rollout price is $${enteredPrice.toLocaleString()}. Minimum required is $${WF_HIGH_MIN_PRICE.toLocaleString()}.`
          );
          return;
        }
        const methodValidation = validatePriceForPaymentMethod(enteredPrice, activeMethod);
        if (!methodValidation.isValid) {
          setError(
            `"${calc.name}" rollout price ($${enteredPrice.toLocaleString()}) does not meet the minimum for the selected payment plan. ${methodValidation.message}`
          );
          return;
        }
      }

      const promises = calculators.map((calc: any) => {
        if (calc.price > 0 && !calc.isRolloutConfirmed) {
          const payload = {
            ...calc.inputs,
            ...calc.extras,
            title: calc.name,
            paymentMethod: calc.inputs.paymentPlan,
            pricemarkup: calc.inputs.markup,
            price: calc.price,
            isRolloutConfirmed: true,
            seniorVet: calc.discounts?.seniorVet,
            preOrder: calc.discounts?.preOrder,
          };
          return LeadService.updateCalculator(calc._id, payload);
        }
        return Promise.resolve();
      });
      await Promise.all(promises);
      if (setCalculators) {
        setCalculators((prev: any) =>
          prev.map((calc: any) => {
            if (calc.price > 0 && !calc.isRolloutConfirmed) {
              return {
                ...calc,
                isRolloutConfirmed: true,
              };
            }
            return calc;
          })
        );
      }
      if (refresh) await refresh();
    } catch (e) {
      setError('Failed to confirm rollout prices. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const calculateMonthly = (principal: number, planKey?: string) => {
    const key = planKey || activeCalc.inputs.paymentPlan;
    const plan = paymentPlans[key] || {};
    if (plan.type !== 'financing') return 0;
    if (plan.pf) return principal * plan.pf;
    return principal / (plan.duration || 12);
  };

  const handleDiscountChange = (val: number) => {
    setCurrentDiscount(val);
    updateActive({ inputs: { discountPercentage: val } });
    handleSave();
  };

  return {
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
  };
};
