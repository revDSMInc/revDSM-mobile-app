/**
 * Validation utilities for Job Builder sections
 */

const n = (v: any) => parseFloat(v) || 0;

export const validateGutter = (data: any, calculatorData: any) => {
  // Helper for case-insensitive key lookup (Parity with web app)
  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    const key = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    return key ? n(calculatorData[key]) : 0;
  };

  const fiveInchFeet = getVal('gutter5Inch');
  const sixInchFeet = getVal('gutter6Inch');
  const sevenInchFeet = getVal('gutter7Inch');
  const eightInchFeet = getVal('gutter8Inch');
  const dsFootageAvail = getVal('downspoutFootage');
  const totalAvailable =
    fiveInchFeet + sixInchFeet + sevenInchFeet + eightInchFeet + dsFootageAvail;

  if (totalAvailable === 0) return { valid: true };

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

  const allocated = gutterFeet + dsFeet;
  const remaining = totalAvailable - allocated;

  // Check if root partial is set OR if any combo has it (Web Parity)
  const hasPartial = data.partial || (data.gutterColorsMulti || []).some((c: any) => c.partial);
  if (!hasPartial) return { valid: false, error: 'Gutter Partial selection required' };

  if (Math.abs(remaining) > 0.1) {
    return {
      valid: false,
      error:
        remaining > 0
          ? `${remaining.toFixed(1)} ft remaining`
          : `Over-allocated by ${Math.abs(remaining).toFixed(1)} ft`,
    };
  }

  // Check combos
  for (const combo of data.gutterColorsMulti || []) {
    const comboTotal = (combo.measurements || []).reduce((s: number, v: any) => s + n(v), 0);
    if (comboTotal > 0) {
      if (!combo.color)
        return { valid: false, error: 'Color required for all gutter combinations' };
      if (
        combo.mitersOutside === '' ||
        combo.mitersInside === '' ||
        combo.endCapsRights === '' ||
        combo.endCapsLefts === ''
      ) {
        return { valid: false, error: 'Miters and End Caps required for all gutter combinations' };
      }
    }
  }

  // Check downspouts
  for (const ds of data.downspoutsMulti || []) {
    const dsTotal = n(ds.footage) + n(ds.aElbows) + n(ds.bElbows); // basic check
    if (dsTotal > 0) {
      if (!ds.type || !ds.color)
        return { valid: false, error: 'Type and Color required for all downspouts' };
    }
  }

  return { valid: true };
};

export const validateLeafFilter = (data: any, calculatorData: any) => {
  const n = (v: any) => parseFloat(v) || 0;

  // Helper for case-insensitive key lookup (Parity with web app)
  const getVal = (baseKey: string) => {
    if (!calculatorData) return 0;
    const lowerKey = baseKey.toLowerCase();
    const key = Object.keys(calculatorData).find((k) => k.toLowerCase() === lowerKey);
    return key ? n(calculatorData[key]) : 0;
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

export const validateSoffit = (data: any, calculatorData: any) => {
  const vinylFootage = n(calculatorData?.vinylSoffit);
  const porchFootage = n(calculatorData?.porchCeiling);

  if (vinylFootage > 0) {
    const v = data.vinyl || {};
    if (!v.type || !v.soffitType || !v.color)
      return { valid: false, error: 'Vinyl Soffit specs required' };
  }
  if (porchFootage > 0) {
    const p = data.porch || {};
    if (!p.location || p.location.length === 0 || !p.soffitType || !p.color)
      return { valid: false, error: 'Porch Ceiling specs and location required' };
  }
  return { valid: true };
};

export const validateFascia = (data: any, calculatorData: any) => {
  const wrapFootage = n(calculatorData?.trimWrap);
  const boardFootage = n(calculatorData?.fasciaBoard);

  if (wrapFootage > 0) {
    const w = data.wrap || {};
    if (!w.type || !w.size || !w.color)
      return { valid: false, error: 'Fascia Wrap specs required' };
  }
  if (boardFootage > 0) {
    const b = data.boards || {};
    if (!b.type || !b.size || !b.boardType)
      return { valid: false, error: 'Fascia Board specs required' };
  }
  return { valid: true };
};

export const validateStep = (stepId: string, jobState: any, calculatorData: any) => {
  if (stepId === 'gutter') return validateGutter(jobState.gutter || {}, calculatorData);
  if (stepId === 'leaffilter') return validateLeafFilter(jobState.leaffilter || {}, calculatorData);
  if (stepId === 'soffit') return validateSoffit(jobState.soffit || {}, calculatorData);
  if (stepId === 'fascia') return validateFascia(jobState.fascia || {}, calculatorData);
  return { valid: true };
};
