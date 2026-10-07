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
import { useAuth } from './useAuth';
import { logEvent } from '../services/api/LoggerService';
import { Storage } from '../utils/storage';
import {
  fireRolloutLog,
  getPaymentPlanLabel,
  calculateMarkupLabel,
} from '../utils/activity-log/rollout-log-meta';
import { setRolloutConfirmedTimestamp } from '../utils/activity-log/rollout-confirmed-at';

const calculateMarkupLocal = (
  endPrice: number,
  costAtCheck: number,
  parAtCheck: number,
  retailAtCheck: number
) => {
  const numericPrice = Number(endPrice);
  if (isNaN(numericPrice) || numericPrice < 0) return '';

  const cost = Math.round(costAtCheck) || 0;
  const par = Math.round(parAtCheck) || 0;
  const retail = Math.round(retailAtCheck) || 0;

  let anchor = cost;
  let label = 'COST';

  if (numericPrice >= retail) {
    anchor = retail;
    label = 'RETAIL';
  } else if (numericPrice >= par) {
    anchor = par;
    label = 'PAR';
  } else if (numericPrice >= cost) {
    anchor = cost;
    label = 'COST';
  }

  if (!anchor || anchor === 0) return '';

  const percent = Math.round(((numericPrice - anchor) / anchor) * 100);

  if (percent === 0) return label;
  return `${label} + ${percent}%`;
};

const calculateMarkupNumberLocal = (
  endPrice: number,
  costAtCheck: number,
  parAtCheck: number,
  retailAtCheck: number
) => {
  const cost = Math.round(costAtCheck) || 0;
  const par = Math.round(parAtCheck) || 0;
  const retail = Math.round(retailAtCheck) || 0;

  let anchor = cost;
  if (endPrice >= retail) {
    anchor = retail;
  } else if (endPrice >= par) {
    anchor = par;
  } else if (endPrice >= cost) {
    anchor = cost;
  }

  if (!anchor || anchor === 0) return 0;
  return Math.round(((endPrice - anchor) / anchor) * 100);
};

const getCostPriceForCalc = (calc: any, isLowesLead?: boolean): number => {
  return Math.round(
    calculateResultUtil({
      details: calc,
      markupKey: '50',
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
      hideScreens: true,
      isLowesLead,
    })
  );
};

const mapApiDrop = (dp: any, calcPaymentMethod: string): DropEntry => ({
  _id: dp._id,
  price: dp.dropedPrice,
  secured: dp.status === 'accepted',
  declined: dp.status === 'declined',
  paymentMethod: dp.paymentMethod || calcPaymentMethod,
  downPayment: dp.downPayment ?? 0,
  balance: dp.balance ?? 0,
  addedPlans: dp.addedPlans || [],
});

const dropEntryToPayload = (dp: DropEntry) => ({
  ...(dp._id ? { _id: dp._id } : {}),
  dropedPrice: Number(dp.price),
  status: dp.secured ? 'accepted' : 'declined',
  paymentMethod: dp.paymentMethod,
  downPayment: dp.downPayment ?? 0,
  balance: dp.balance ?? 0,
  addedPlans: dp.addedPlans || [],
});

interface DropEntry {
  _id?: string;
  price: number;
  secured: boolean;
  declined: boolean;
  paymentMethod: string;
  downPayment: number;
  balance: number;
  addedPlans: string[];
}

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
  const { user } = useAuth();
  const leadId = Storage.getItem('leadId') || undefined;

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

  const [droppedPrices, setDroppedPrices] = useState<DropEntry[]>(() =>
    (activeCalc.dropPrice || []).map((dp: any) =>
      mapApiDrop(dp, activeCalc.inputs?.paymentPlan || 'check')
    )
  );

  useEffect(() => {
    setDroppedPrices(
      (activeCalc.dropPrice || []).map((dp: any) =>
        mapApiDrop(dp, activeCalc.inputs?.paymentPlan || 'check')
      )
    );
  }, [activeCalc._id, activeCalc.dropPrice]);

  const [isSaving, setIsSaving] = useState(false);

  const [displayDrop, setDisplayDrop] = useState<any>(null);
  const [displayDropIndex, setDisplayDropIndex] = useState<number>(-1);

  const [downPayment, setDownPayment] = useState(0);
  const [showDownPaymentInput, setShowDownPaymentInput] = useState(false);
  const [addedPlans, setAddedPlans] = useState<string[]>([]);
  const [tempPlan, setTempPlan] = useState<string | null>(null);

  const [priceText, setPriceText] = useState<string>(
    activeCalc.price ? String(activeCalc.price) : ''
  );

  useEffect(() => {
    setPriceText(activeCalc.price ? String(activeCalc.price) : '');
  }, [activeCalc._id]);

  const saveDropPriceToServer = async (updatedDrops: DropEntry[], extraPayload?: any) => {
    setIsSaving(true);
    try {
      let resolvedDrops = updatedDrops.map(dropEntryToPayload);
      const targetApptId = activeCalc.appointmentId;
      if (targetApptId) {
        try {
          const calcRes = await LeadService.getCalculators(targetApptId);
          const calculatorsData = calcRes.data?.data || calcRes.data || [];
          const matched = calculatorsData.find((c: any) => c._id === activeCalc._id);
          if (matched && matched.dropPrice) {
            resolvedDrops = resolvedDrops.map((dp: any) => {
              if (!dp._id) {
                const matchedDbDrop = matched.dropPrice.find(
                  (dbDp: any) =>
                    Number(dbDp.dropedPrice) === Number(dp.dropedPrice) &&
                    dbDp.status === dp.status
                );
                if (matchedDbDrop) {
                  return { ...dp, _id: matchedDbDrop._id };
                }
              }
              return dp;
            });
          }
        } catch (err) {
          console.warn('Failed to resolve dropPrice _ids before updateCalculator in saveDropPriceToServer', err);
        }
      }

      const payload: any = {
        ...activeCalc.inputs,
        ...activeCalc.extras,
        title: activeCalc.name,
        price: activeCalc.price,
        isRolloutConfirmed: true,
        dropPrice: resolvedDrops,
        ...extraPayload,
      };
      const res = await LeadService.updateCalculator(activeCalc._id, payload);

      const serverCalc = res.data?.data || res.data;
      let finalDropPrice = serverCalc?.dropPrice;
      if (!finalDropPrice && targetApptId) {
        try {
          const calcRes = await LeadService.getCalculators(targetApptId);
          const calculatorsData = calcRes.data?.data || calcRes.data || [];
          const matched = calculatorsData.find((c: any) => c._id === activeCalc._id);
          if (matched && matched.dropPrice) {
            finalDropPrice = matched.dropPrice;
          }
        } catch (err) {
          console.warn('Failed to fetch latest calculators in saveDropPriceToServer', err);
        }
      }

      if (finalDropPrice) {
        const newDrops = finalDropPrice.map((dp: any) =>
          mapApiDrop(dp, activeCalc.inputs?.paymentPlan || 'check')
        );
        setDroppedPrices(newDrops);
        updateActive({
          dropPrice: finalDropPrice,
        }, true);
      }

      if (refresh) await refresh();
    } catch (e) {
      console.warn('Failed to save drop price', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDrop = async (status: 'accepted' | 'declined' = 'declined') => {
    const num = Number(dropValue.replace(/[^0-9.]/g, ''));
    const costPrice = Math.round(results.costAtCheck ?? results.price50);
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
      let updatedDrops: DropEntry[];

      const existingDeclinedIndex = droppedPrices.findIndex(
        (item) => !item.secured && Number(item.price) === num
      );

      if (existingDeclinedIndex !== -1) {
        updatedDrops = droppedPrices.map((item, idx) => {
          if (idx === existingDeclinedIndex) {
            return {
              ...item,
              secured: status === 'accepted',
              declined: status !== 'accepted',
              paymentMethod: dropPaymentMethod,
              downPayment,
              balance: num - downPayment,
              addedPlans,
            };
          }
          if (status === 'accepted' && item.secured) {
            return { ...item, secured: false, declined: true };
          }
          return item;
        });
      } else {
        const newEntry: DropEntry = {
          price: num,
          secured: status === 'accepted',
          declined: status !== 'accepted',
          paymentMethod: dropPaymentMethod,
          downPayment,
          balance: num - downPayment,
          addedPlans,
        };
        updatedDrops = [
          ...droppedPrices.map((item) =>
            status === 'accepted' && item.secured ? { ...item, secured: false, declined: true } : item
          ),
          newEntry,
        ];
      }

      const userId = user?._id || user?.id;
      if (userId) {
        const _costPrice = Math.round(results.costAtCheck ?? results.price50) || 0;
        const _parPrice = Math.round(results.parAtCheck ?? results.price65) || 0;
        const _retailPrice = Math.round(results.retailAtCheck ?? results.price100) || 0;
        const _dropNum = status === 'accepted' ? updatedDrops.findIndex((d) => d.secured) + 1 : updatedDrops.filter((d) => d.declined).length;
        const _planLabel = paymentPlans[dropPaymentMethod]?.label || dropPaymentMethod;
        const lastDroppedPrice = droppedPrices.length > 0 ? droppedPrices[droppedPrices.length - 1].price : activeCalc.price;
        const percentageOfRollout = calculateMarkupLocal(
          num,
          results.costAtCheck ?? results.price50,
          results.parAtCheck ?? results.price65,
          results.retailAtCheck ?? results.price100
        );

        if (status === 'accepted') {
          logEvent('change', {
            user_id: userId,
            created_by: userId,
            module_type: 'rollout_and_drop',
            meta: {
              calculatorId: activeCalc._id,
              appointmentId: activeCalc.appointmentId,
              calculatorTitle: activeCalc.name || activeCalc.title,
              fieldName: 'dropPrice',
              fieldLabel: 'Drop Price',
              fieldValue: num,
              fieldCategory: 'drop',
              oldValue: lastDroppedPrice,
              newValue: num,
              isSecured: true,
              isDeclined: false,
              dropNumber: _dropNum,
              dropPrice: num,
              costPrice: _costPrice,
              parPrice: _parPrice,
              retailPrice: _retailPrice,
              percentageOfRollout,
              paymentPlanKey: dropPaymentMethod,
              paymentPlanLabel: _planLabel,
              action: 'drop price secured',
            },
          });

          logEvent('change', {
            user_id: userId,
            created_by: userId,
            module_type: 'rollout_and_drop',
            meta: {
              calculatorId: activeCalc._id,
              appointmentId: activeCalc.appointmentId,
              calculatorTitle: activeCalc.name || activeCalc.title,
              fieldName: 'dropPricePlan',
              fieldLabel: 'Drop Price Plan',
              fieldValue: num,
              fieldCategory: 'drop',
              oldValue: activeCalc.paymentMethod ?? '',
              newValue: num,
              paymentPlanKey: dropPaymentMethod,
              paymentPlanLabel: _planLabel,
              action: 'drop price plan selected on secure',
            },
          });
        } else {
          logEvent('change', {
            user_id: userId,
            created_by: userId,
            module_type: 'rollout_and_drop',
            meta: {
              calculatorId: activeCalc._id,
              appointmentId: activeCalc.appointmentId,
              calculatorTitle: activeCalc.name || activeCalc.title,
              fieldName: 'dropPrice',
              fieldLabel: 'Drop Price',
              fieldValue: num,
              fieldCategory: 'drop',
              oldValue: lastDroppedPrice,
              newValue: num,
              isSecured: false,
              isDeclined: true,
              dropNumber: _dropNum,
              dropPrice: num,
              costPrice: _costPrice,
              parPrice: _parPrice,
              retailPrice: _retailPrice,
              percentageOfRollout,
              paymentPlanKey: dropPaymentMethod,
              paymentPlanLabel: _planLabel,
              action: 'drop price declined',
            },
          });
        }
      }

      setDroppedPrices(updatedDrops);
      updateActive({
        dropPrice: updatedDrops.map(dropEntryToPayload),
        price: activeCalc.price,
        isRolloutConfirmed: true,
        inputs: {
          ...activeCalc.inputs,
          paymentPlan: status === 'accepted' ? dropPaymentMethod : activeCalc.inputs.paymentPlan,
        },
      }, true);

      setShowDropModal(false);
      setDropValue('');
      setSelectedPlan(null);

      const extraPayload: any = {};
      if (status === 'accepted') {
        extraPayload.paymentPlan = dropPaymentMethod;
        extraPayload.paymentMethod = dropPaymentMethod;
      }
      await saveDropPriceToServer(updatedDrops, extraPayload);
    } catch (e) {
      console.warn('Failed to add drop', e);
    }
  };

  const handleDisplayDropAction = async (status: 'accepted' | 'declined') => {
    if (displayDropIndex === -1) return;

    try {
      const targetId = displayDrop?._id;
      const targetIdx = droppedPrices.findIndex((item, idx) => {
        if (targetId && item._id === targetId) return true;
        if (!targetId && idx === displayDropIndex) return true;
        return false;
      });

      if (targetIdx === -1) return;

      const updatedDrops = droppedPrices.map((item, idx) => {
        if (idx === targetIdx) {
          return {
            ...item,
            secured: status === 'accepted',
            declined: status !== 'accepted',
            downPayment: downPayment,
            balance: (item.price) - downPayment,
            paymentMethod: selectedPlan || item.paymentMethod,
            addedPlans,
          };
        }
        if (status === 'accepted' && item.secured) {
          return { ...item, secured: false, declined: true };
        }
        return item;
      });

      const userId = user?._id || user?.id;
      if (userId) {
        const itemToUpdate = droppedPrices[targetIdx];
        const num = Number(itemToUpdate.price);
        const _costPrice = Math.round(results.costAtCheck ?? results.price50) || 0;
        const _parPrice = Math.round(results.parAtCheck ?? results.price65) || 0;
        const _retailPrice = Math.round(results.retailAtCheck ?? results.price100) || 0;
        const planToUse = selectedPlan || itemToUpdate.paymentMethod;
        const _planLabel = paymentPlans[planToUse]?.label || planToUse;
        const _dropNum = updatedDrops.findIndex((d) => d.secured) + 1;
        const lastDroppedPrice = targetIdx > 0 ? droppedPrices[targetIdx - 1].price : activeCalc.price;
        const percentageOfRollout = calculateMarkupLocal(
          num,
          results.costAtCheck ?? results.price50,
          results.parAtCheck ?? results.price65,
          results.retailAtCheck ?? results.price100
        );

        if (status === 'accepted') {
          logEvent('change', {
            user_id: userId,
            created_by: userId,
            module_type: 'rollout_and_drop',
            meta: {
              calculatorId: activeCalc._id,
              appointmentId: activeCalc.appointmentId,
              calculatorTitle: activeCalc.name || activeCalc.title,
              fieldName: 'dropPrice',
              fieldLabel: 'Drop Price',
              fieldValue: num,
              fieldCategory: 'drop',
              oldValue: lastDroppedPrice,
              newValue: num,
              isSecured: true,
              isDeclined: false,
              dropNumber: _dropNum,
              dropPrice: num,
              costPrice: _costPrice,
              parPrice: _parPrice,
              retailPrice: _retailPrice,
              percentageOfRollout,
              paymentPlanKey: planToUse,
              paymentPlanLabel: _planLabel,
              action: 'drop price secured',
            },
          });

          logEvent('change', {
            user_id: userId,
            created_by: userId,
            module_type: 'rollout_and_drop',
            meta: {
              calculatorId: activeCalc._id,
              appointmentId: activeCalc.appointmentId,
              calculatorTitle: activeCalc.name || activeCalc.title,
              fieldName: 'dropPricePlan',
              fieldLabel: 'Drop Price Plan',
              fieldValue: num,
              fieldCategory: 'drop',
              oldValue: activeCalc.paymentMethod ?? '',
              newValue: num,
              paymentPlanKey: planToUse,
              paymentPlanLabel: _planLabel,
              action: 'drop price plan selected on secure',
            },
          });
        } else {
          logEvent('change', {
            user_id: userId,
            created_by: userId,
            module_type: 'rollout_and_drop',
            meta: {
              calculatorId: activeCalc._id,
              appointmentId: activeCalc.appointmentId,
              calculatorTitle: activeCalc.name || activeCalc.title,
              fieldName: 'dropPrice',
              fieldLabel: 'Drop Price',
              fieldValue: num,
              fieldCategory: 'drop',
              oldValue: lastDroppedPrice,
              newValue: num,
              isSecured: false,
              isDeclined: true,
              dropNumber: updatedDrops.filter((d) => d.declined).length,
              dropPrice: num,
              costPrice: _costPrice,
              parPrice: _parPrice,
              retailPrice: _retailPrice,
              percentageOfRollout,
              paymentPlanKey: planToUse,
              paymentPlanLabel: _planLabel,
              action: 'drop price declined',
            },
          });
        }
      }

      setDroppedPrices(updatedDrops);
      updateActive({
        dropPrice: updatedDrops.map(dropEntryToPayload),
        inputs: {
          ...activeCalc.inputs,
          paymentPlan:
            status === 'accepted'
              ? selectedPlan || droppedPrices[targetIdx]?.paymentMethod
              : activeCalc.inputs.paymentPlan,
        },
      }, true);

      setDisplayDrop(null);
      setDisplayDropIndex(-1);

      const extraPayload: any = {};
      if (status === 'accepted') {
        const method = selectedPlan || droppedPrices[targetIdx]?.paymentMethod;
        extraPayload.paymentPlan = method;
        extraPayload.paymentMethod = method;
      }
      await saveDropPriceToServer(updatedDrops, extraPayload);

      if (status === 'accepted') {
        setShowResultModal(true);
      }
    } catch (e) {
      console.warn('Failed to update drop', e);
    }
  };

  const handleUnselectDrop = async (index: number) => {
    try {
      const dropPriceEntry = droppedPrices[index];
      const updatedDrops = droppedPrices.map((drop, i) =>
        i === index ? { ...drop, secured: false, declined: true } : drop
      );

      const userId = user?._id || user?.id;
      if (userId && dropPriceEntry) {
        const dropPrice = Number(dropPriceEntry.price);
        const currentPaymentMethod = dropPriceEntry.paymentMethod || activeCalc.paymentMethod;
        const _costPrice = Math.round(results.costAtCheck ?? results.price50) || 0;
        const _parPrice = Math.round(results.parAtCheck ?? results.price65) || 0;
        const _retailPrice = Math.round(results.retailAtCheck ?? results.price100) || 0;
        const _dropNum = updatedDrops.filter((d) => d.declined).length;
        const _planLabel = paymentPlans[currentPaymentMethod]?.label || currentPaymentMethod;
        const percentageOfRollout = calculateMarkupLocal(
          dropPrice,
          results.costAtCheck ?? results.price50,
          results.parAtCheck ?? results.price65,
          results.retailAtCheck ?? results.price100
        );

        logEvent('change', {
          user_id: userId,
          created_by: userId,
          module_type: 'rollout_and_drop',
          meta: {
            calculatorId: activeCalc._id,
            appointmentId: activeCalc.appointmentId,
            calculatorTitle: activeCalc.name || activeCalc.title,
            fieldName: 'dropPrice',
            fieldLabel: 'Drop Price',
            fieldValue: dropPrice,
            fieldCategory: 'drop',
            oldValue: dropPrice,
            newValue: dropPrice,
            isSecured: false,
            isDeclined: true,
            dropNumber: _dropNum,
            dropPrice: dropPrice,
            costPrice: _costPrice,
            parPrice: _parPrice,
            retailPrice: _retailPrice,
            percentageOfRollout,
            paymentPlanKey: currentPaymentMethod,
            paymentPlanLabel: _planLabel,
            action: 'drop price unselected',
          },
        });
      }

      setDroppedPrices(updatedDrops);
      updateActive({ dropPrice: updatedDrops.map(dropEntryToPayload) }, true);
      await saveDropPriceToServer(updatedDrops);
    } catch (e) {
      console.warn('Failed to unselect drop', e);
    }
  };

  const handlePriceChange = (val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, '');
    setPriceText(cleaned);
    if (error) setError(null);
  };

  const handlePriceBlur = () => {
    const num = Number(priceText.replace(/[^0-9.]/g, ''));
    const costPrice = Math.round(results.costAtCheck ?? results.price50);
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

    const oldValue = activeCalc.price ?? '';
    const userId = user?._id || user?.id;
    if (num !== oldValue && userId) {
      fireRolloutLog(
        userId,
        activeCalc,
        {
          fieldName: 'endPrice',
          fieldLabel: 'End Price',
          fieldValue: num,
          fieldCategory: 'rollout',
          oldValue,
          newValue: num,
          action: 'end price entered',
          isLowesLead,
        },
        leadId
      );
    }

    updateActive({ price: num });
    handleSave();
  };
  const propagateDefaultPaymentPlan = async (paymentPlanToPropagate: string) => {
    try {
      const userId = user?._id || user?.id;
      const promises = calculators.map((calc: any) => {
        if (calc._id === activeCalc._id) return Promise.resolve();
        const payload = {
          ...calc.inputs,
          ...calc.extras,
          title: calc.name,
          paymentMethod: paymentPlanToPropagate,
          paymentPlan: paymentPlanToPropagate,
          pricemarkup: calc.inputs.markup,
          price: calc.price,
          isRolloutConfirmed: calc.isRolloutConfirmed,
          isDefaultPayment: true,
        };
        return LeadService.updateCalculator(calc._id, payload);
      });
      await Promise.all(promises);

      if (userId) {
        for (const calc of calculators) {
          if (calc._id === activeCalc._id) continue;
          const oldMethod = calc.inputs?.paymentPlan || calc.paymentMethod || '';
          if (oldMethod === paymentPlanToPropagate) continue;
          await fireRolloutLog(
            userId,
            calc,
            {
              fieldName: 'paymentMethod',
              fieldLabel: 'Payment Method',
              fieldValue: Number(calc.price) || 0,
              fieldCategory: calc.isRolloutConfirmed ? 'drop' : 'rollout',
              oldValue: oldMethod,
              newValue: Number(calc.price) || 0,
              oldPaymentMethod: oldMethod,
              newPaymentMethod: paymentPlanToPropagate,
              oldPaymentMethodLabel: getPaymentPlanLabel(oldMethod),
              newPaymentMethodLabel: getPaymentPlanLabel(paymentPlanToPropagate),
              action: calc.isRolloutConfirmed ? 'payment method changed for drop' : 'payment method changed',
              isLowesLead,
            },
            leadId
          );
        }
      }
      if (setCalculators) {
        setCalculators((prev: any) =>
          prev.map((calc: any) => {
            return {
              ...calc,
              isDefaultPayment: true,
              inputs: {
                ...calc.inputs,
                paymentPlan: paymentPlanToPropagate,
              },
            };
          })
        );
      }
      if (refresh) await refresh();
    } catch (err) {
      console.warn('Failed to propagate default payment method', err);
    }
  };

  const handleConfirmAll = async () => {
    try {
      setIsConfirming(true);

      const defaultCalc = calculators.find((c: any) => c.isDefaultPayment || (c._id === activeCalc._id && activeCalc.isDefaultPayment));
      const shouldPropagate = !!defaultCalc && !!defaultCalc.inputs?.paymentPlan;
      const targetPaymentPlan = defaultCalc?.inputs?.paymentPlan || activeCalc.inputs?.paymentPlan;

      for (const calc of calculators) {
        if (calc.isRolloutConfirmed) continue;
        const enteredPrice = Number(calc.price) || 0;
        if (enteredPrice <= 0) continue;

        const activeMethod = shouldPropagate ? targetPaymentPlan : (calc.inputs?.paymentPlan || calc.paymentMethod || 'check');
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
        const isCurrentActive = calc._id === activeCalc._id;
        const currentIsDefault = isCurrentActive ? activeCalc.isDefaultPayment : calc.isDefaultPayment;
        const currentPaymentPlan = isCurrentActive ? activeCalc.inputs.paymentPlan : calc.inputs.paymentPlan;

        if (calc.price > 0 && !calc.isRolloutConfirmed) {
          const payload = {
            ...calc.inputs,
            ...calc.extras,
            title: calc.name,
            paymentMethod: shouldPropagate ? targetPaymentPlan : currentPaymentPlan,
            paymentPlan: shouldPropagate ? targetPaymentPlan : currentPaymentPlan,
            pricemarkup: calc.inputs.markup,
            price: calc.price,
            isRolloutConfirmed: true,
            seniorVet: calc.discounts?.seniorVet,
            preOrder: calc.discounts?.preOrder,
            isDefaultPayment: shouldPropagate ? true : currentIsDefault,
          };
          return LeadService.updateCalculator(calc._id, payload);
        } else if (shouldPropagate) {
          const payload = {
            ...calc.inputs,
            ...calc.extras,
            title: calc.name,
            paymentMethod: targetPaymentPlan,
            paymentPlan: targetPaymentPlan,
            pricemarkup: calc.inputs.markup,
            price: calc.price,
            isRolloutConfirmed: calc.isRolloutConfirmed,
            isDefaultPayment: true,
          };
          return LeadService.updateCalculator(calc._id, payload);
        }
        return Promise.resolve();
      });
      await Promise.all(promises);

      const userId = user?._id || user?.id;
      if (userId) {
        calculators.forEach((calc: any) => {
          if (calc.price > 0 && !calc.isRolloutConfirmed) {
            if (leadId) setRolloutConfirmedTimestamp(leadId, calc._id);
            fireRolloutLog(
              userId,
              calc,
              {
                fieldName: 'rolloutConfirmed',
                fieldLabel: 'Rollout Confirmed',
                fieldValue: Number(calc.price),
                fieldCategory: 'rollout',
                oldValue: '',
                newValue: Number(calc.price),
                action: 'rollout confirmed',
                isLowesLead,
              },
              leadId
            );
          }
        });
      }

      if (setCalculators) {
        setCalculators((prev: any) =>
          prev.map((calc: any) => {
            const isCurrentActive = calc._id === activeCalc._id;
            const updatedPaymentPlan = shouldPropagate ? targetPaymentPlan : (isCurrentActive ? activeCalc.inputs.paymentPlan : calc.inputs.paymentPlan);
            const updatedIsDefault = shouldPropagate ? true : (isCurrentActive ? activeCalc.isDefaultPayment : calc.isDefaultPayment);
            
            if (calc.price > 0 && !calc.isRolloutConfirmed) {
              return {
                ...calc,
                isRolloutConfirmed: true,
                isDefaultPayment: updatedIsDefault,
                inputs: {
                  ...calc.inputs,
                  paymentPlan: updatedPaymentPlan,
                },
              };
            } else if (shouldPropagate) {
              return {
                ...calc,
                isDefaultPayment: true,
                inputs: {
                  ...calc.inputs,
                  paymentPlan: targetPaymentPlan,
                },
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

  const logPaymentMethodChange = async (method: string, oldMethod: string) => {
    const userId = user?._id || user?.id;
    if (!userId || method === oldMethod) return;
    const currentPrice = Number(activeCalc.price) || 0;
    const isConfirmed = !!activeCalc.isRolloutConfirmed && currentPrice > 0;
    await fireRolloutLog(
      userId,
      activeCalc,
      {
        fieldName: 'paymentMethod',
        fieldLabel: 'Payment Method',
        fieldValue: currentPrice,
        fieldCategory: isConfirmed ? 'drop' : 'rollout',
        oldValue: oldMethod,
        newValue: currentPrice,
        oldPaymentMethod: oldMethod,
        newPaymentMethod: method,
        oldPaymentMethodLabel: getPaymentPlanLabel(oldMethod),
        newPaymentMethodLabel: getPaymentPlanLabel(method),
        action: isConfirmed ? 'payment method changed for drop' : 'payment method changed',
        isLowesLead,
      },
      leadId
    );
  };

  const logDropPlanSelect = async (planKey: string, droppedPrice: number, oldPlanKey: string) => {
    const userId = user?._id || user?.id;
    if (!userId) return;
    await fireRolloutLog(
      userId,
      activeCalc,
      {
        fieldName: 'dropPricePlan',
        fieldLabel: 'Drop Price Plan',
        fieldValue: droppedPrice,
        fieldCategory: 'drop',
        oldValue: oldPlanKey ?? '',
        newValue: droppedPrice,
        paymentPlanKey: planKey,
        paymentPlanLabel: getPaymentPlanLabel(planKey),
        dropPrice: droppedPrice,
        action: 'drop price plan selected',
        isLowesLead,
      },
      leadId
    );
  };

  const calculateMonthly = (principal: number, planKey?: string) => {
    const key = planKey || activeCalc.inputs.paymentPlan;
    const plan = paymentPlans[key] || {};
    if (plan.type !== 'financing') return 0;
    if (plan.pf) return principal * plan.pf;
    return principal / (plan.duration || 12);
  };

  const handleDiscountChange = (val: number) => {
    const oldValue = activeCalc.inputs.discountPercentage || 15;
    const userId = user?._id || user?.id;
    if (val !== oldValue && userId) {
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: 'rollout_and_drop',
        meta: {
          calculatorId: activeCalc._id,
          appointmentId: activeCalc.appointmentId,
          calculatorTitle: activeCalc.name || activeCalc.title,
          fieldName: 'discountPercentage',
          fieldLabel: 'Discount Percentage',
          fieldValue: val,
          fieldCategory: 'rollout_discount',
          oldValue,
          newValue: val,
          action: 'discount percentage changed',
        },
      });
    }

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
    handleDisplayDropAction,
    handlePriceChange,
    handlePriceBlur,
    priceText,
    handleConfirmAll,
    calculateMonthly,
    handleDiscountChange,
    propagateDefaultPaymentPlan,
    logPaymentMethodChange,
    logDropPlanSelect,
    displayDrop,
    setDisplayDrop,
    displayDropIndex,
    setDisplayDropIndex,
    droppedPrices,
    setDroppedPrices,
    isSaving,
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
