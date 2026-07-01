import {
  getCalculatorBaseName,
  getPresentComponents,
  getSizingSuffix,
  getUpdatedCalculatorTitles,
} from '../../../src/utils/calculator/tab-naming.utils';

describe('getPresentComponents', () => {
  test('detects gutters (G) when gutter measurements present', () => {
    const present = getPresentComponents({ gutter6Ft1: 50 });
    expect(present.has('G')).toBe(true);
  });

  test('detects Versa when versa measurements present', () => {
    const present = getPresentComponents({ versa6Ft1: 30 });
    expect(present.has('Versa')).toBe(true);
  });

  test('detects VMax when versaMaxFt1 present', () => {
    const present = getPresentComponents({ versaMaxFt1: 20 });
    expect(present.has('VMax')).toBe(true);
  });

  test('detects Soffit (S) when soffit extras present', () => {
    const present = getPresentComponents({ extras: { vinylSoffit: 10 } });
    expect(present.has('S')).toBe(true);
  });

  test('detects FWrap when trimWrap present', () => {
    const present = getPresentComponents({ extras: { trimWrap: 15 } });
    expect(present.has('FWrap')).toBe(true);
  });

  test('detects FBoard when fasciaBoard present', () => {
    const present = getPresentComponents({ extras: { fasciaBoard: 10 } });
    expect(present.has('FBoard')).toBe(true);
  });

  test('detects Labor when extraLabor present', () => {
    const present = getPresentComponents({ extraLabor: 5 });
    expect(present.has('Labor')).toBe(true);
  });

  test('returns empty set for empty details', () => {
    const present = getPresentComponents({});
    expect(present.size).toBe(0);
  });
});

describe('getCalculatorBaseName', () => {
  test('returns base name for gutters only', () => {
    const name = getCalculatorBaseName({ gutter6Ft1: 50 });
    expect(name).toContain('G');
  });

  test('returns base name for versa only', () => {
    const name = getCalculatorBaseName({ versa6Ft1: 30 });
    expect(name).toContain('Versa');
  });

  test('detects full package (G + S + FWrap + Versa/VMax)', () => {
    const details = {
      gutter6Ft1: 50,
      versa6Ft1: 30,
      extras: { vinylSoffit: 10, trimWrap: 15 },
    };
    const name = getCalculatorBaseName(details);
    expect(name).toContain('📦');
  });

  test('returns combined components separated by +', () => {
    const details = {
      gutter6Ft1: 50,
      versa6Ft1: 30,
      extraLabor: 5,
    };
    const name = getCalculatorBaseName(details);
    expect(name).toMatch(/^[A-Za-z+]+$/);
  });

  test('returns empty string for no components', () => {
    const name = getCalculatorBaseName({});
    expect(name).toBe('');
  });

  test('falls back to details.name when no components detected', () => {
    const name = getCalculatorBaseName({ name: 'My Custom Job' });
    expect(name).toBe('My Custom Job');
  });
});

describe('getSizingSuffix', () => {
  test('returns empty string when total <= 1', () => {
    expect(getSizingSuffix(0, 1)).toBe('');
  });

  test('returns SM/LG for total of 2', () => {
    expect(getSizingSuffix(0, 2)).toBe(' (SM)');
    expect(getSizingSuffix(1, 2)).toBe(' (LG)');
  });

  test('returns sizing labels for more items', () => {
    expect(getSizingSuffix(0, 3)).toBe(' (SM)');
    expect(getSizingSuffix(1, 3)).toBe(' (MD)');
    expect(getSizingSuffix(2, 3)).toBe(' (LG)');
  });

  test('handles XXL+ labels', () => {
    expect(getSizingSuffix(5, 10)).toBe(' (XXL-2)');
  });
});

describe('getUpdatedCalculatorTitles', () => {
  const getRetailPrice = (calc: any) => Number(calc.price) || 0;

  test('returns a record of calculator IDs to titles', () => {
    const result = getUpdatedCalculatorTitles(
      [{ _id: 'calc-1', gutter6Ft1: 50, price: 5000 }],
      getRetailPrice
    );
    expect(result).toHaveProperty('calc-1');
  });

  test('handles empty calculators array', () => {
    const result = getUpdatedCalculatorTitles([], getRetailPrice);
    expect(Object.keys(result).length).toBe(0);
  });

  test('assigns unique titles for different base components', () => {
    const calculators = [
      { _id: 'calc-1', gutter6Ft1: 50, price: 5000 },
      { _id: 'calc-2', versaMaxFt1: 20, price: 3000 },
    ];
    const result = getUpdatedCalculatorTitles(calculators, getRetailPrice);
    expect(result['calc-1']).not.toBe(result['calc-2']);
  });

  test('marks duplicate price with warning emoji', () => {
    const calculators = [
      { _id: 'calc-1', gutter6Ft1: 50, price: 5000 },
      { _id: 'calc-2', gutter6Ft1: 50, price: 5000 },
    ];
    const result = getUpdatedCalculatorTitles(calculators, getRetailPrice);
    expect(result['calc-1']).toContain('⚠️');
  });

  test('does not mark confirmed rollouts with warning', () => {
    const calculators = [
      { _id: 'calc-1', gutter6Ft1: 50, price: 5000, isRolloutConfirmed: true },
      { _id: 'calc-2', gutter6Ft1: 50, price: 5000 },
    ];
    const result = getUpdatedCalculatorTitles(calculators, getRetailPrice);
    expect(result['calc-1']).not.toContain('⚠️');
  });
});
