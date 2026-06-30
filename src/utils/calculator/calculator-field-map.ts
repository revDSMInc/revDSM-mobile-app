/**
 * Map a calculator numeric field from API record — matches web VerticalsCalculatorView:
 * use canonical field name only, treat 0/null/undefined as empty.
 */
export const mapCalculatorNumericField = (record: any, key: string): string => {
  const val = record?.[key];
  if (val === 0 || val === null || val === undefined || val === '') return '';
  return String(val);
};

/**
 * Build flat calculator details matching the web API object shape used by getCalculationResult.
 */
export const toWebFlatCalculator = (details: any) => {
  if (!details) return {};

  if (!details.inputs && !details.extras) {
    return details;
  }

  const { inputs, extras, ...rest } = details;
  const metaKeys = new Set([
    'inputs',
    'extras',
    'discounts',
    'dropPrice',
    'name',
    'price',
    '_id',
    'position',
    'isRolloutConfirmed',
    'isDefaultPayment',
    'isDefaultDiscount',
    'downPayment',
    'appointmentId',
  ]);

  const topLevel = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !metaKeys.has(key))
  );

  return {
    ...topLevel,
    ...(extras || {}),
    ...(inputs || {}),
    paymentMethod: inputs?.paymentPlan || details.paymentMethod,
  };
};
