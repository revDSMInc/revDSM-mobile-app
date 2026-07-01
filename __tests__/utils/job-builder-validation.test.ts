import {
  validateGutter,
  validateLeafFilter,
  validateSoffit,
  validateFascia,
  validateMisc,
  validateLighting,
  validateStep,
} from '../../src/utils/job-builder-validation';

describe('validateGutter', () => {
  test('returns valid when no gutter footage', () => {
    const result = validateGutter({}, {});
    expect(result.valid).toBe(true);
  });

  test('returns error when partial is not set', () => {
    const data = {
      gutterColorsMulti: [{ measurements: [10, 0, 0, 0, 0, 0] }],
      downspoutsMulti: [],
      partial: undefined,
    };
    const calcData = { gutter6Ft1: '10' };
    const result = validateGutter(data, calcData);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Partial');
  });

  test('returns error when over-allocated', () => {
    const data = {
      gutterColorsMulti: [{ measurements: [100, 0, 0, 0, 0, 0] }],
      downspoutsMulti: [],
      partial: true,
    };
    const calcData = { gutter6Ft1: '10' };
    const result = validateGutter(data, calcData);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Over-allocated');
  });

  test('returns error when color missing for combination', () => {
    const data = {
      gutterColorsMulti: [{ measurements: [10, 0, 0, 0, 0, 0], color: '' }],
      downspoutsMulti: [],
      partial: true,
    };
    const calcData = { gutter6Ft1: '10' };
    const result = validateGutter(data, calcData);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Color');
  });

  test('returns valid for correct allocation with colors', () => {
    const data = {
      gutterColorsMulti: [{
        measurements: [10, 0, 0, 0, 0, 0],
        color: 'White',
        mitersOutside: '0',
        mitersInside: '0',
        endCapsRights: '0',
        endCapsLefts: '0',
      }],
      downspoutsMulti: [],
      partial: true,
    };
    const calcData = { gutter6Ft1: '10' };
    const result = validateGutter(data, calcData);
    expect(result.valid).toBe(true);
  });
});

describe('validateLeafFilter', () => {
  test('returns valid when no LF footage', () => {
    expect(validateLeafFilter({}, {}).valid).toBe(true);
  });

  test('returns error when no configurations', () => {
    const result = validateLeafFilter({ combinations: [] }, { versa6Ft1: '10' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('configuration');
  });

  test('returns error when profile fields missing', () => {
    const data = {
      combinations: [{
        measurements: [10, 0, 0, 0, 0, 0],
        lfProfile: '',
        lfColor: '',
        gutterProfile: '',
        gutterOpeningWidth: '',
      }],
    };
    const calcData = { versa6Ft1: '10' };
    const result = validateLeafFilter(data, calcData);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Profile');
  });

  test('requires exactSize for 4&5 width', () => {
    const data = {
      combinations: [{
        measurements: [10, 0, 0, 0, 0, 0],
        lfProfile: 'Pro',
        lfColor: 'White',
        gutterProfile: 'K-Style',
        gutterOpeningWidth: '4 & 5"',
        exactSize: '',
      }],
    };
    const calcData = { versa6Ft1: '10' };
    const result = validateLeafFilter(data, calcData);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Exact Size');
  });
});

describe('validateSoffit', () => {
  test('returns valid when no soffit footage', () => {
    expect(validateSoffit({}, {}).valid).toBe(true);
  });

  test('returns error when vinyl type missing', () => {
    const result = validateSoffit({ vinyl: {} }, { extras: { vinylSoffit: '20' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Type');
  });

  test('returns error when porch location missing', () => {
    const result = validateSoffit({ porch: {} }, { extras: { porchCeiling: '15' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Location');
  });

  test('returns error when nailer type missing', () => {
    const result = validateSoffit({ nailer: {} }, { extras: { nailerBuildOut: '10' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Type');
  });
});

describe('validateFascia', () => {
  test('returns valid when no fascia footage', () => {
    expect(validateFascia({}, {}).valid).toBe(true);
  });

  test('returns error when wrap type missing', () => {
    const result = validateFascia({ wrap: {} }, { extras: { trimWrap: '20' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Type');
  });

  test('returns error when board type missing', () => {
    const result = validateFascia({ boards: {} }, { extras: { fasciaBoard: '10' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Type');
  });
});

describe('validateMisc', () => {
  test('returns valid when no labor', () => {
    expect(validateMisc({}, {})).toEqual({ valid: true });
  });

  test('returns error when labor reason missing', () => {
    const result = validateMisc({ extraLabor: '5', extraLaborReason: '' }, { inputs: { extraLabor: '5' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Reason');
  });

  test('returns valid when labor has reason', () => {
    const result = validateMisc({ extraLabor: '5', extraLaborReason: 'Extra work' }, { inputs: { extraLabor: '5' } });
    expect(result.valid).toBe(true);
  });
});

describe('validateLighting', () => {
  test('returns valid when no lighting footage', () => {
    expect(validateLighting({}, {}).valid).toBe(true);
  });

  test('returns error when no combinations', () => {
    const result = validateLighting({ combinations: [] }, { extras: { lighting1stStory: '10' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('combination');
  });

  test('returns error when required fields missing', () => {
    const data = {
      combinations: [{
        measurements: [10, 0, 0, 0, 0, 0],
        trackColor: '',
        wireColor: '',
        trackMaterial: '',
        mountingLocation: '',
        substrate: '',
      }],
    };
    const result = validateLighting(data, { extras: { lighting1stStory: '10' } });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Color');
  });
});

describe('validateStep', () => {
  test('routes to correct validator by stepId', () => {
    expect(validateStep('gutter', {}, {}).valid).toBe(true);
    expect(validateStep('leaffilter', {}, {}).valid).toBe(true);
    expect(validateStep('soffit', {}, {}).valid).toBe(true);
    expect(validateStep('fascia', {}, {}).valid).toBe(true);
    expect(validateStep('lighting', {}, {}).valid).toBe(true);
    expect(validateStep('additional', {}, {}).valid?.toString()).toBeDefined();
    expect(validateStep('unknown', {}, {})).toEqual({ valid: true });
  });
});
