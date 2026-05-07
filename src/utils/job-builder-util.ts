export const getJobSummaryItems = (calculatorData: any) => {
  const items: any[] = [];

  if (!calculatorData || Object.keys(calculatorData).length === 0) {
    return items;
  }

  const inputs = calculatorData.inputs || {};
  const extras = calculatorData.extras || {};
  const n = (v: any) => Number(v) || 0;

  // Gutter items
  const gutterInputKeys = [
    'gutter5DsE',
    'gutter6Ft1',
    'gutter7DsE',
    'miters',
    'endCaps',
    'spoutSavers',
  ];
  const gutterExtraKeys = [
    'wedges',
    'straps',
    'modifyHeight',
    'groundSpout',
    'replaceCorner',
    'extendedSplashGuard',
    'extendedSplashGuard032',
  ];

  const hasGutter =
    gutterInputKeys.some((k) => n(inputs[k]) > 0) || gutterExtraKeys.some((k) => n(extras[k]) > 0);

  if (hasGutter) {
    items.push({ category: 'Gutters' });
  }

  // LeafFilter items
  const lfInputKeys = [
    'versaMaxFt1',
    'versaMaxFt2',
    'versaMaxFt3',
    'versa6Ft1',
    'versa7Ft1',
    'filter45Ft1',
    'versa6Ft2',
    'versa7Ft2',
    'filter45Ft2',
    'versa6Ft3',
    'versa7Ft3',
    'filter45Ft3',
  ];
  const lfExtraKeys = ['csr', 'cornersFilter', 'sawzallHanger', 'removeProtection', 'ribbedRoof'];

  const hasLF =
    lfInputKeys.some((k) => n(inputs[k]) > 0) || lfExtraKeys.some((k) => n(extras[k]) > 0);

  if (hasLF) {
    items.push({ category: 'LeafFilter' });
  }

  // Soffit items
  const hasSoffit = ['vinylSoffit', 'porchCeiling', 'nailerBuildOut'].some((k) => n(extras[k]) > 0);

  if (hasSoffit) {
    items.push({ category: 'Soffit' });
  }

  // Fascia items
  const hasFascia = ['trimWrap', 'fasciaBoard', 'aluminumFasciaBoard'].some(
    (k) => n(extras[k]) > 0
  );

  if (hasFascia) {
    items.push({ category: 'Fascia' });
  }

  // Additional items
  const hasAdditional = n(inputs.extraLabor) > 0 || n(inputs.ckToInstallers) > 0;

  if (hasAdditional) {
    items.push({ category: 'Additional' });
  }

  return items;
};

export const getAvailableSteps = (calculatorData: any) => {
  const jobSummaryItems = getJobSummaryItems(calculatorData);

  const steps = [
    { step: 1, category: 'gutter', categoryKey: 'Gutters', name: 'Gutter' },
    { step: 2, category: 'leaffilter', categoryKey: 'LeafFilter', name: 'LeafFilter' },
    { step: 3, category: 'soffit', categoryKey: 'Soffit', name: 'Soffit' },
    { step: 4, category: 'fascia', categoryKey: 'Fascia', name: 'Fascia' },
    { step: 5, category: 'additional', categoryKey: 'Additional', name: 'Misc' },
    { step: 6, category: 'summary', categoryKey: 'Summary', name: 'Summary' },
  ];

  return steps.map((step) => {
    // MISC and SUMMARY are always unlocked
    if (step.step >= 5) return { ...step, isLocked: false };

    // Check if this category exists in calculator items
    const isAvailable = jobSummaryItems.some((item) => item.category === step.categoryKey);
    return { ...step, isLocked: !isAvailable };
  });
};
