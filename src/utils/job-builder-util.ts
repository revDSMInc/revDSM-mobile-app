export const getJobSummaryItems = (calculatorData: any) => {
  const items: any[] = [];

  if (!calculatorData || Object.keys(calculatorData).length === 0) {
    return items;
  }

  const excludeKeys = [
    'discountPercentage',
    'discount',
    'total',
    'subtotal',
    'tax',
    'screens',
    'position',
  ];

  // Gutter items
  const gutterExtraKeys = [
    'wedges',
    'straps',
    'modifyHeight',
    'groundSpout',
    'replaceCorner',
    'extendedSplashGuard',
    'extendedSplashGuard032',
  ];

  const footageKeys = Object.keys(calculatorData).filter(
    (key) =>
      (/gutter/i.test(key) || gutterExtraKeys.includes(key)) &&
      !excludeKeys.some((exclude) => key.toLowerCase().includes(exclude.toLowerCase())) &&
      (Number(calculatorData[key]) || 0) > 0
  );

  if (footageKeys.length > 0) {
    items.push({ category: 'Gutters' });
  }

  // LeafFilter items
  const lfExtraKeys = ['csr', 'sawzallHanger', 'removeProtection', 'ribbedRoof'];
  const leafFilterKeys = Object.keys(calculatorData).filter(
    (key) =>
      (/versa/i.test(key) ||
        /filter/i.test(key) ||
        ['cornersFilter', ...lfExtraKeys].includes(key)) &&
      !excludeKeys.some((exclude) => key.toLowerCase().includes(exclude.toLowerCase())) &&
      (Number(calculatorData[key]) || 0) > 0
  );

  if (leafFilterKeys.length > 0) {
    items.push({ category: 'LeafFilter' });
  }

  // Soffit items
  const soffitKeys = Object.keys(calculatorData).filter(
    (key) =>
      ['vinylSoffit', 'porchCeiling', 'nailerBuildOut'].includes(key) &&
      (Number(calculatorData[key]) || 0) > 0
  );

  if (soffitKeys.length > 0) {
    items.push({ category: 'Soffit' });
  }

  // Fascia items
  const fasciaKeys = Object.keys(calculatorData).filter(
    (key) =>
      ['trimWrap', 'fasciaBoard', 'aluminumFasciaBoard'].includes(key) &&
      (Number(calculatorData[key]) || 0) > 0
  );

  if (fasciaKeys.length > 0) {
    items.push({ category: 'Fascia' });
  }

  // Additional items
  const additionalKeys = Object.keys(calculatorData).filter(
    (key) => key === 'extraLabor' && (Number(calculatorData[key]) || 0) > 0
  );

  if (additionalKeys.length > 0) {
    items.push({ category: 'Additional' });
  }

  return items;
};

export const getAvailableSteps = (calculatorData: any) => {
  const jobSummaryItems = getJobSummaryItems(calculatorData);

  const steps = [
    { step: 1, category: 'gutter', categoryKey: 'Gutters', name: 'GUTTER' },
    { step: 2, category: 'leaffilter', categoryKey: 'LeafFilter', name: 'LEAFFILTER' },
    { step: 3, category: 'soffit', categoryKey: 'Soffit', name: 'SOFFIT' },
    { step: 4, category: 'fascia', categoryKey: 'Fascia', name: 'FASCIA' },
    { step: 5, category: 'additional', categoryKey: 'Additional', name: 'MISC' },
    { step: 6, category: 'summary', categoryKey: 'Summary', name: 'SUMMARY' },
  ];

  return steps.map((step) => {
    // MISC and SUMMARY are always unlocked
    if (step.step >= 5) return { ...step, isLocked: false };

    // Check if this category exists in calculator items
    const isAvailable = jobSummaryItems.some((item) => item.category === step.categoryKey);
    return { ...step, isLocked: !isAvailable };
  });
};
