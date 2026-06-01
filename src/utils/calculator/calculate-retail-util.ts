// src/widgets/modals/LeadCenter/utils/calculate-retail-util.ts

export const calculateRetail = ({
  markupKey,
  baseRetailTotal,
  inputs,
  pricing,
  extras,
  extrasList50,
  isLowesLead = false,
}: any) => {
  const n = (v: any) => (v === undefined || v === null || isNaN(Number(v)) ? 0 : Number(v));
  const adminFee = isLowesLead ? 0 : 500;

  if (markupKey === '100') {
    return baseRetailTotal + adminFee;
  }

  if (markupKey === '65') {
    const check100 = baseRetailTotal + adminFee;
    return (check100 - adminFee) * 0.65 + adminFee;
  }

  if (markupKey === '50') {
    const gutterTotal =
      n(inputs.gutter5DsE) * 11.5 + n(inputs.gutter6Ft1) * 12 + n(inputs.gutter7DsE) * 16;

    const versaMaxTotal = n(inputs.versaMaxFt1) * 26;

    const v6 =
      n(inputs.versa6Ft1) * pricing.filters2.versa_6['1'] +
      n(inputs.versa6Ft2) * pricing.filters2.versa_6['2'] +
      n(inputs.versa6Ft3) * pricing.filters2.versa_6['3'];

    const v7 =
      n(inputs.versa7Ft1) * pricing.filters2.versa_7['1'] +
      n(inputs.versa7Ft2) * pricing.filters2.versa_7['2'] +
      n(inputs.versa7Ft3) * pricing.filters2.versa_7['3'];

    const f45 =
      n(inputs.filter45Ft1) * pricing.filters2.filter_4_5['1'] +
      n(inputs.filter45Ft2) * pricing.filters2.filter_4_5['2'] +
      n(inputs.filter45Ft3) * pricing.filters2.filter_4_5['3'];

    const extrasTotal = Object.entries(extras || {})
      .filter(([key]) => key !== 'gutter7DsE')
      .reduce((sum, [key, value]) => {
        const item = extrasList50.find((e: any) => e.id === key);
        return sum + (item ? n(value) * item.price : 0);
      }, 0);

    const extraLaborCost = n(inputs.extraLabor) * 40;

    return gutterTotal + versaMaxTotal + v6 + v7 + f45 + extrasTotal + extraLaborCost;
  }

  return baseRetailTotal;
};
