import { useState } from 'react';
import { paymentPlans } from '../utils/calculator/payment-plans';
import { LeadService } from '../services/api/leads';

export const useCalculatorSummary = (
  activeCalc: any,
  results: any,
  calculators: any,
  updateActive: any,
  handleSave: any,
  refresh: any
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

  const handleAddDrop = async (status = 'declined') => {
    const num = Number(dropValue.replace(/[^0-9.]/g, ''));
    const costPrice = Math.round(results.price50);
    const endPrice = Number(activeCalc.price) || 0;

    if (num < costPrice) {
      setError(`Drop price cannot be less than cost ($${costPrice.toLocaleString()})`);
      return;
    }

    if (endPrice > 0 && num > endPrice) {
      setError(`Drop price cannot exceed rollout end price ($${endPrice.toLocaleString()})`);
      return;
    }
    try {
      const dropPaymentMethod = selectedPlan || activeCalc.inputs.paymentPlan;
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

  const handlePriceChange = (val: string) => {
    const num = Number(val.replace(/[^0-9.]/g, ''));
    if (error) setError(null);
    const costPrice = Math.round(results.price50);
    const activePaymentMethod = activeCalc.inputs.paymentPlan;
    const planName = activePaymentMethod.startsWith('wf')
      ? 'Wells Fargo'
      : activePaymentMethod.startsWith('greensky')
      ? 'GreenSky'
      : 'This plan';
    const wellsFargoHighKeys = ['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'];
    if (num > 0) {
      if (num < costPrice)
        setError(`Price cannot be less than cost ($${costPrice.toLocaleString()})`);
      else if (wellsFargoHighKeys.includes(activePaymentMethod) && num < 7500)
        setError(`${planName} High plans require a minimum of $7,500`);
    }
    updateActive({ price: num });
    handleSave();
  };

  const handleConfirmAll = async () => {
    try {
      setIsConfirming(true);
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
