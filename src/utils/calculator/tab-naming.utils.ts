/**
 * Utility to determine the automatic tab name for LF Calculators
 */

const ORDER = [
  'G',
  'Versa',
  'VMax',
  'S',
  'FWrap',
  'FBoard',
  'FAluminum',
  'Labor',
  'LF Misc',
  'G Misc',
  'Lighting',
];

/**
 * Checks if a value is selected (numeric > 0)
 */
const hasValue = (val: any) => {
  if (val === null || val === undefined || val === '') return false;
  const num = Number(val);
  return !isNaN(num) && num > 0;
};

/**
 * Determines which base components are present in the calculator data
 */
export const getPresentComponents = (details: any) => {
  const present = new Set();

  // Gutters (G)
  const p = details.inputs || details;
  const e = details.extras || details;

  if (hasValue(p.gutter5DsE) || hasValue(p.gutter6Ft1) || hasValue(p.gutter7DsE)) {
    present.add('G');
  }

  // Versa
  if (
    hasValue(p.versa6Ft1) ||
    hasValue(p.versa6Ft2) ||
    hasValue(p.versa6Ft3) ||
    hasValue(p.versa7Ft1) ||
    hasValue(p.versa7Ft2) ||
    hasValue(p.versa7Ft3) ||
    hasValue(p.filter45Ft1) ||
    hasValue(p.filter45Ft2) ||
    hasValue(p.filter45Ft3)
  ) {
    present.add('Versa');
  }

  // VMax
  if (hasValue(p.versaMaxFt1)) {
    present.add('VMax');
  }

  // Soffit (S)
  if (hasValue(e.vinylSoffit) || hasValue(e.porchCeiling) || hasValue(e.nailerBuildOut)) {
    present.add('S');
  }

  // FWrap
  if (hasValue(e.trimWrap)) {
    present.add('FWrap');
  }

  // FBoard
  if (hasValue(e.fasciaBoard)) {
    present.add('FBoard');
  }

  // ABoard
  if (hasValue(e.aluminumFasciaBoard)) {
    present.add('FAluminum');
  }

  // Labor
  if (hasValue(p.extraLabor) || hasValue(e.extraLabor)) {
    present.add('Labor');
  }

  // LF Misc
  const hasLFMisc =
    hasValue(e.cornersFilter) ||
    hasValue(e.sawzallHanger) ||
    hasValue(e.removeProtection) ||
    hasValue(p.csr) ||
    hasValue(e.ribbedRoof);

  if (hasLFMisc && !present.has('Versa') && !present.has('VMax')) {
    present.add('LF Misc');
  }

  // G Misc
  const hasGMisc =
    hasValue(e.wedges) ||
    hasValue(e.straps) ||
    hasValue(e.modifyHeight) ||
    hasValue(e.groundSpout) ||
    hasValue(e.replaceCorner) ||
    hasValue(e.extendedSplashGuard) ||
    hasValue(e.extendedSplashGuard032);

  if (hasGMisc && !present.has('G')) {
    present.add('G Misc');
  }

  // Lighting
  const hasLighting =
    hasValue(e.lighting1stStory) ||
    hasValue(e.lighting2ndStory) ||
    hasValue(e.lighting3rdStory) ||
    hasValue(e.lightingWifiExtender) ||
    hasValue(e.lightingBoosterBox) ||
    hasValue(e.lightingElectricalOutlet);

  if (hasLighting) {
    present.add('Lighting');
  }

  return present;
};

/**
 * Gets the base tab name
 */
export const getCalculatorBaseName = (details: any) => {
  const present = getPresentComponents(details);

  // Full Package Detection
  const isFullPackage =
    present.has('G') &&
    present.has('S') &&
    present.has('FWrap') &&
    (present.has('Versa') || present.has('VMax'));

  if (isFullPackage) {
    let name = '📦';
    const extrasOrder = ['FBoard', 'Labor', 'Lighting'];
    const selectedExtras = extrasOrder.filter((comp) => present.has(comp));

    if (selectedExtras.length > 0) {
      name += '+' + selectedExtras.map((comp) => (comp === 'Lighting' ? 'Light' : comp)).join('+');
    }
    return name;
  }

  const baseName = ORDER.filter((comp) => present.has(comp))
    .map((comp) => (comp === 'Lighting' ? 'Light' : comp))
    .join('+');

  if (!baseName && details.name) {
    return details.name;
  }

  return baseName;
};

/**
 * Sizing suffixes based on sorted price
 */
const SIZING_LABELS = ['SM', 'MD', 'LG', 'XL', 'XXL', 'XXL-2', 'XXL-3', 'XXL-4', 'XXL-5'];

export const getSizingSuffix = (index: number, total: number) => {
  if (total <= 1) return '';
  if (total === 2) return ` (${index === 0 ? 'SM' : 'LG'})`;
  const label = SIZING_LABELS[index] || `XXL-${index - 4}`;
  return ` (${label})`;
};

/**
 * Processes all calculators to determine their final names
 */
export const getUpdatedCalculatorTitles = (
  calculators: any[],
  getRetailPrice: (calc: any) => number
) => {
  const processed = calculators.map((calc: any, idx: number) => ({
    _id: calc._id || `temp-${idx}`,
    baseName: getCalculatorBaseName(calc),
    price: getRetailPrice(calc),
    originalTitle: calc.title,
    isRolloutConfirmed: calc.isRolloutConfirmed,
    inputs: calc.inputs,
    extras: calc.extras,
    globalIndex: idx,
  }));

  const emptyCount = processed.filter(item => !item.baseName).length;

  const groups: any = {};
  processed.forEach((item) => {
    if (!groups[item.baseName]) groups[item.baseName] = [];
    groups[item.baseName].push(item);
  });

  const finalTitles: any = {};
  Object.keys(groups).forEach((baseName) => {
    const group = groups[baseName];

    // 1. Get price frequencies
    const priceCounts: any = {};
    group.forEach((item: any) => {
      priceCounts[item.price] = (priceCounts[item.price] || 0) + 1;
    });

    // 2. Get unique price levels for suffix ranking
    const uniquePriceLevels = [...new Set(group.map((item: any) => item.price))].sort(
      (a: any, b: any) => a - b
    );

    group.forEach((item: any) => {
      const isDuplicatePrice = priceCounts[item.price] > 1;

      // If it's an empty calculator (no items)
      if (!item.baseName) {
        if (emptyCount > 1) {
          finalTitles[item._id] = `Rollout ${item.globalIndex + 1}`;
        } else {
          finalTitles[item._id] = '';
        }
        return;
      }

      // Confirmed rollouts never show as warnings, even if duplicates exist
      if (isDuplicatePrice && !item.isRolloutConfirmed) {
        finalTitles[item._id] = `⚠️ ${item.baseName} ⚠️`;
      } else {
        // Unique price: Assign suffix based on price rank
        if (uniquePriceLevels.length > 1) {
          const priceIndex = uniquePriceLevels.indexOf(item.price);
          const suffix = getSizingSuffix(priceIndex, uniquePriceLevels.length);
          finalTitles[item._id] = `${item.baseName}${suffix}`;
        } else {
          finalTitles[item._id] = item.baseName;
        }
      }
    });
  });

  return finalTitles;
};
