import { calculateRetail } from './calculate-retail-util';
import { getVerticalItemRetail } from './verticals-data';
import { normalizeCalculatorData } from './data-normalization-util';

export const calculateResultUtil = ({
  details,
  markupKey,
  pricing,
  extrasList = [],
  extrasList50 = [],
  paymentPlans = {} as any,
  paymentMethod,
  selectedPaymentMethods = {} as any,
  getCalculatorData,
  discounts = {} as any,
  ckToInstallers = 0,
  hideScreens = false,
  isLowesLead = false,
}: any) => {
  if (!details) return 0;

  const n = (v: any) => Number(v) || 0;

  let inputs: any;
  let extras: any;
  let verticals: any;

  if (getCalculatorData) {
    const data = getCalculatorData(details);
    inputs = data.inputs;
    extras = data.extras;
    verticals = data.verticals || {};
  } else {
    const normalized = normalizeCalculatorData(details);
    inputs = normalized.inputs;
    extras = normalized.extras;
    verticals = normalized.verticals;
  }

  const resolvedMethod =
    paymentMethod ||
    selectedPaymentMethods?.[details._id] ||
    details.paymentMethod ||
    details.inputs?.paymentPlan ||
    'check';

  const plan = paymentPlans[resolvedMethod] || {};
  const fee = plan.fee || 0;

  const gutterTotal =
    n(inputs.gutter5DsE) * pricing.gutters['5_inch_all_stories'] +
    n(inputs.gutter6Ft1) * pricing.gutters['6_inch_all_stories'] +
    n(inputs.gutter7DsE) * pricing.gutters['7_inch_all_stories'];

  const versaMaxTotal = n(inputs.versaMaxFt1) * pricing.filters.versa_max_all_stories;

  const v6Base =
    n(inputs.versa6Ft1) * pricing.filters.versa_6['1'] +
    n(inputs.versa6Ft2) * pricing.filters.versa_6['2'] +
    n(inputs.versa6Ft3) * pricing.filters.versa_6['3'];

  const v7Base =
    n(inputs.versa7Ft1) * pricing.filters.versa_7['1'] +
    n(inputs.versa7Ft2) * pricing.filters.versa_7['2'] +
    n(inputs.versa7Ft3) * pricing.filters.versa_7['3'];

  const f45Base =
    n(inputs.filter45Ft1) * pricing.filters.filter_4_5['1'] +
    n(inputs.filter45Ft2) * pricing.filters.filter_4_5['2'] +
    n(inputs.filter45Ft3) * pricing.filters.filter_4_5['3'];

  const extrasBase = extrasList
    .filter((e: any) => e.id !== 'gutter7DsE')
    .reduce((sum: number, e: any) => sum + n(extras[e.id]) * e.price, 0);

  const verticalBase = (() => {
    let total = 0;
    Object.entries(verticals || {}).forEach(([id, qty]) => {
      if (id.startsWith('rf') || id.startsWith('win') || id.startsWith('fl') || id.startsWith('rm')) {
        const numQty = n(qty);
        if (numQty > 0) {
          const retailPrice = getVerticalItemRetail(id);
          if (retailPrice > 0) total += numQty * retailPrice;
        }
      }
    });
    return total;
  })();

  const baseRetailTotal =
    gutterTotal + versaMaxTotal + v6Base + v7Base + f45Base + extrasBase + verticalBase;

  const checkRetail = calculateRetail({
    markupKey,
    baseRetailTotal,
    inputs,
    pricing,
    extras,
    extrasList50,
    isLowesLead,
    verticals,
  });

  let price = fee >= 1 ? checkRetail : checkRetail / (1 - fee);

  if (price < 200 && baseRetailTotal > 0) {
    price = 200;
  }

  if (discounts.seniorVet) price *= 0.9;
  if (discounts.preOrder) price *= 0.75;

  price += n(ckToInstallers);

  return price;
};
