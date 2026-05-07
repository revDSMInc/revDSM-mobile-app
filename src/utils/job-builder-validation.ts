/**
 * Validation utilities for Job Builder sections
 */

type ValidationResult = { valid: boolean; error?: string };

const n = (v: any) => parseFloat(v) || 0;

export const validateGutter = (data: any, calculatorData: any): ValidationResult => {

  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    const topKey = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    const topVal = topKey ? n(calculatorData[topKey]) : 0;
    if (topVal > 0) return topVal;
    const extras = calculatorData.extras || {};
    const extrasKey = Object.keys(extras).find((k) => k.toLowerCase() === lowerKey);
    const extrasVal = extrasKey ? n(extras[extrasKey]) : 0;
    if (extrasVal > 0) return extrasVal;
    const inputs = calculatorData.inputs || {};
    const inputKey = Object.keys(inputs).find((k) => k.toLowerCase() === lowerKey);
    return inputKey ? n(inputs[inputKey]) : 0;
  };

  const availableFootage = {
    '5" K-Style': getVal('gutter5DsE'),
    '6" K-Style': getVal('gutter6Ft1'),
    '7" K-Style': getVal('gutter7DsE'),
    '8" K-Style': getVal('gutter8Inch'),
    downspoutPool: getVal('downspoutFootage'),
  };

  const totalAvail = Math.round(Object.values(availableFootage).reduce((a, b) => a + b, 0));
  if (totalAvail === 0) return { valid: true };

  const gutterFeet = (data.gutterColorsMulti || []).reduce((sum: number, combo: any) => {
    return sum + (combo.measurements || []).reduce((s: number, v: any) => s + n(v), 0);
  }, 0);

  const dsFeet = (data.downspoutsMulti || []).reduce((sum: number, ds: any) => {
    return (
      sum +
      n(ds.footage) +
      n(ds.aElbows) +
      n(ds.bElbows) +
      n(ds.roundElbow) +
      n(ds.offsetElbows) +
      n(ds.spoutSavers)
    );
  }, 0);

  const allocatedTotal = Math.round(gutterFeet + dsFeet);
  const remainingTotal = totalAvail - allocatedTotal;

  if (allocatedTotal > 0 && !data.partial) {
    return { valid: false, error: 'Gutter Partial selection required' };
  }

  if (Math.abs(remainingTotal) > 0.1) {
    return {
      valid: false,
      error:
        remainingTotal > 0
          ? `${remainingTotal.toFixed(1)} ft remaining`
          : `Over-allocated by ${Math.abs(remainingTotal).toFixed(1)} ft`,
    };
  }

  // Combinations
  for (const combo of data.gutterColorsMulti || []) {
    const hasMeas = (combo.measurements || []).some((m: any) => n(m) > 0);
    if (hasMeas) {
      if (!combo.color) return { valid: false, error: 'Color required for all combinations' };
      if (
        combo.mitersOutside === '' ||
        combo.mitersInside === '' ||
        combo.endCapsRights === '' ||
        combo.endCapsLefts === ''
      ) {
        return { valid: false, error: 'Miters and End Caps required for all combinations' };
      }
    }
  }

  // Downspouts
  for (const ds of data.downspoutsMulti || []) {
    const hasVal = [
      'footage',
      'aElbows',
      'bElbows',
      'roundElbow',
      'offsetElbows',
      'spoutSavers',
    ].some((f) => n(ds[f]) > 0);
    if (hasVal) {
      if (!ds.type || !ds.color)
        return { valid: false, error: 'Type and Color required for all downspouts' };
    }
  }

  // Extras — use getVal so they are found in extras/inputs/root
  if (getVal('replaceCorner') > 0 && !data.extrasColors?.replaceCorner)
    return { valid: false, error: 'Replace Corner Color required' };
  if (getVal('extendedSplashGuard') > 0 && !data.extrasColors?.extendedSplashGuard)
    return { valid: false, error: 'Splash Guard Color required' };
  if (getVal('extendedSplashGuard032') > 0 && !data.extrasColors?.extendedSplashGuard032)
    return { valid: false, error: 'Splash Guard (.032) Color required' };

  const modifyHeight = n(data.modifyHeight ?? getVal('modifyHeight'));
  if (modifyHeight > 0 && (data.modifyHeightLocations || []).length === 0) {
    return { valid: false, error: 'Modify Height location required' };
  }

  return { valid: true };
};

export const validateLeafFilter = (data: any, calculatorData: any): ValidationResult => {
  const n = (v: any) => parseFloat(v) || 0;

  // Helper for case-insensitive key lookup (Parity with web app)
  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    const topKey = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    const topVal = topKey ? n(calculatorData[topKey]) : 0;
    if (topVal > 0) return topVal;
    const inputs = calculatorData.inputs || {};
    const inputKey = Object.keys(inputs).find((k) => k.toLowerCase() === lowerKey);
    const inputVal = inputKey ? n(inputs[inputKey]) : 0;
    if (inputVal > 0) return inputVal;
    const extras = calculatorData.extras || {};
    const extrasKey = Object.keys(extras).find((k) => k.toLowerCase() === lowerKey);
    return extrasKey ? n(extras[extrasKey]) : 0;
  };

  const availableFootage = {
    '6"': [getVal('versa6ft1'), getVal('versa6ft2'), getVal('versa6ft3')],
    '7"': [getVal('versa7ft1'), getVal('versa7ft2'), getVal('versa7ft3')],
    '4 & 5"': [getVal('filter45ft1'), getVal('filter45ft2'), getVal('filter45ft3')],
    'Versa Max': getVal('versaMaxFt1') || getVal('versaMax'),
  };

  const hasLFFootage =
    availableFootage['6"'].some((v) => v > 0) ||
    availableFootage['7"'].some((v) => v > 0) ||
    availableFootage['4 & 5"'].some((v) => v > 0) ||
    availableFootage['Versa Max'] > 0;

  if (!hasLFFootage) return { valid: true };

  const combinations = data.combinations || [];
  if (combinations.length === 0)
    return { valid: false, error: 'At least one configuration required' };

  for (const combo of combinations) {
    if (!combo.lfProfile || !combo.lfColor)
      return { valid: false, error: 'Profile and Color required' };
    if (combo.lfProfile === 'Versa' && !combo.gutterOpeningWidth)
      return { valid: false, error: 'Gutter Opening Width required' };
  }

  // Check allocations
  const used = {
    '6"': [0, 0, 0],
    '7"': [0, 0, 0],
    '4 & 5"': [0, 0, 0],
    'Versa Max': 0,
  };

  combinations.forEach((combo: any) => {
    const width = combo.gutterOpeningWidth;
    if (combo.lfProfile === 'Versa Max') {
      used['Versa Max'] += combo.measurements.reduce((sum: number, v: any) => sum + n(v), 0);
    } else if (width && used[width as keyof typeof used]) {
      for (let s = 0; s < 3; s++) {
        for (let l = 0; l < 6; l++) {
          (used[width as keyof typeof used] as number[])[s] += n(combo.measurements[l * 3 + s]);
        }
      }
    }
  });

  // Verify matches
  for (const width of ['6"', '7"', '4 & 5"'] as const) {
    for (let s = 0; s < 3; s++) {
      const avail = availableFootage[width][s];
      const remaining = avail - used[width][s];
      // Only validate if there is footage in this story OR if user entered something
      if (avail > 0 || used[width][s] > 0) {
        if (Math.abs(remaining) > 0.1)
          return { valid: false, error: `${width} Story ${s + 1} allocation mismatch` };
      }
    }
  }

  const vmAvail = availableFootage['Versa Max'];
  const vmUsed = used['Versa Max'];
  if (vmAvail > 0 || vmUsed > 0) {
    const vmRemaining = vmAvail - vmUsed;
    if (Math.abs(vmRemaining) > 0.1)
      return { valid: false, error: 'Versa Max allocation mismatch' };
  }

  return { valid: true };
};

export const validateSoffit = (data: any, calculatorData: any): ValidationResult => {
  const getExtrasVal = (key: string) => {
    if (!calculatorData) return 0;
    const lower = key.toLowerCase();
    // root
    const rk = Object.keys(calculatorData).find((k) => k.toLowerCase() === lower);
    const rv = rk ? n(calculatorData[rk]) : 0;
    if (rv > 0) return rv;
    // extras (soffit keys live here)
    const extras = calculatorData.extras || {};
    const ek = Object.keys(extras).find((k) => k.toLowerCase() === lower);
    const ev = ek ? n(extras[ek]) : 0;
    if (ev > 0) return ev;
    // inputs
    const inputs = calculatorData.inputs || {};
    const ik = Object.keys(inputs).find((k) => k.toLowerCase() === lower);
    return ik ? n(inputs[ik]) : 0;
  };

  const vinylFootage = getExtrasVal('vinylSoffit');
  const porchFootage = getExtrasVal('porchCeiling');
  const nailerFootage = getExtrasVal('nailerBuildOut');

  // If no footage at all, section is optional – pass
  if (vinylFootage === 0 && porchFootage === 0 && nailerFootage === 0) return { valid: true };

  if (vinylFootage > 0) {
    const v = data.vinyl || {};
    if (!v.type) return { valid: false, error: 'Vinyl Soffit: Type required' };
    if (!v.soffitType) return { valid: false, error: 'Vinyl Soffit: Soffit Type required' };
    if (!v.color) return { valid: false, error: 'Vinyl Soffit: Color required' };
  }
  if (porchFootage > 0) {
    const p = data.porch || {};
    if (!p.location || (Array.isArray(p.location) ? p.location.length === 0 : !p.location))
      return { valid: false, error: 'Porch Ceiling: Location required' };
    if (!p.soffitType) return { valid: false, error: 'Porch Ceiling: Soffit Type required' };
    if (!p.color) return { valid: false, error: 'Porch Ceiling: Color required' };
  }
  if (nailerFootage > 0) {
    const na = data.nailer || {};
    if (!na.type) return { valid: false, error: 'Nailer Build Out: Type required' };
  }
  return { valid: true };
};

export const validateFascia = (data: any, calculatorData: any): ValidationResult => {
  const getExtrasVal = (key: string) => {
    if (!calculatorData) return 0;
    const lower = key.toLowerCase();
    // root
    const rk = Object.keys(calculatorData).find((k) => k.toLowerCase() === lower);
    const rv = rk ? n(calculatorData[rk]) : 0;
    if (rv > 0) return rv;
    // extras (fascia keys live here)
    const extras = calculatorData.extras || {};
    const ek = Object.keys(extras).find((k) => k.toLowerCase() === lower);
    const ev = ek ? n(extras[ek]) : 0;
    if (ev > 0) return ev;
    // inputs
    const inputs = calculatorData.inputs || {};
    const ik = Object.keys(inputs).find((k) => k.toLowerCase() === lower);
    return ik ? n(inputs[ik]) : 0;
  };

  const wrapFootage = getExtrasVal('trimWrap');
  const boardFootage = getExtrasVal('fasciaBoard');
  const aluminumFootage = getExtrasVal('aluminumFasciaBoard');

  // If no footage at all, section is optional – pass
  if (wrapFootage === 0 && boardFootage === 0 && aluminumFootage === 0) return { valid: true };

  if (wrapFootage > 0) {
    const w = data.wrap || {};
    if (!w.type) return { valid: false, error: 'Fascia Wrap: Type required' };
    if (!w.size) return { valid: false, error: 'Fascia Wrap: Size required' };
    if (!w.color) return { valid: false, error: 'Fascia Wrap: Color required' };
  }
  if (boardFootage > 0) {
    const b = data.boards || {};
    if (!b.type) return { valid: false, error: 'Fascia Boards: Type required' };
    if (!b.size) return { valid: false, error: 'Fascia Boards: Size required' };
    if (!b.boardType) return { valid: false, error: 'Fascia Boards: Board Type required' };
  }
  // aluminumBoards only requires footage (auto-locked) — no extra user fields needed
  return { valid: true };
};

export const validateMisc = (_data: any, _calculatorData: any): ValidationResult => {
  // Misc / Additional section has no mandatory fields — always valid
  return { valid: true };
};

export const validateStep = (stepId: string, jobState: any, calculatorData: any): ValidationResult => {
  if (stepId === 'gutter') return validateGutter(jobState.gutter || {}, calculatorData);
  if (stepId === 'leaffilter') return validateLeafFilter(jobState.leaffilter || {}, calculatorData);
  if (stepId === 'soffit') return validateSoffit(jobState.soffit || {}, calculatorData);
  if (stepId === 'fascia') return validateFascia(jobState.fascia || {}, calculatorData);
  if (stepId === 'additional') return validateMisc(jobState.additional || {}, calculatorData);
  return { valid: true };
};

