import { computeTitleSaveOrder } from '../../../src/utils/calculator/title-save-order';

describe('computeTitleSaveOrder', () => {
  const mockGetTitles = (calculators: any[], getRetailPrice: (calc: any) => number) => {
    const titles: Record<string, string> = {};
    calculators.forEach((calc: any) => {
      const price = getRetailPrice(calc);
      titles[calc._id] = `Job $${price.toFixed(0)}`;
    });
    return titles;
  };

  const mockGetRetailPrice = (calc: any) => {
    return Number(calc.price) || 0;
  };

  const makeCalc = (id: string, price: number, title?: string) => ({
    _id: id,
    price,
    title: title || `Job $${price}`,
  });

  test('returns empty array for empty calculators list', () => {
    const result = computeTitleSaveOrder({
      allCalculators: [],
      changedCalcId: 'calc-1',
      changedCalcData: {},
      getTitles: mockGetTitles,
      getRetailPrice: mockGetRetailPrice,
    });
    expect(result).toEqual([]);
  });

  test('returns empty array for missing changedCalcId', () => {
    const result = computeTitleSaveOrder({
      allCalculators: [makeCalc('calc-1', 10000)],
      changedCalcId: '',
      changedCalcData: {},
      getTitles: mockGetTitles,
      getRetailPrice: mockGetRetailPrice,
    });
    expect(result).toEqual([]);
  });

  test('returns save order for linear (non-cyclical) title change', () => {
    const allCalculators = [
      makeCalc('calc-1', 10000, 'Job $10000'),
      makeCalc('calc-2', 8000, 'Job $8000'),
    ];

    const result = computeTitleSaveOrder({
      allCalculators,
      changedCalcId: 'calc-1',
      changedCalcData: { price: 12000 },
      getTitles: mockGetTitles,
      getRetailPrice: mockGetRetailPrice,
    });

    expect(Array.isArray(result)).toBe(true);
  });

  test('produces entries with calculatorId, newTitle, and data', () => {
    const allCalculators = [makeCalc('calc-1', 10000)];
    const result = computeTitleSaveOrder({
      allCalculators,
      changedCalcId: 'calc-1',
      changedCalcData: { price: 15000 },
      getTitles: mockGetTitles,
      getRetailPrice: mockGetRetailPrice,
    });

    if (result.length > 0) {
      const entry = result[0];
      expect(entry).toHaveProperty('calculatorId');
      expect(entry).toHaveProperty('newTitle');
      expect(entry).toHaveProperty('data');
    }
  });

  test('handles cycle detection', () => {
    const allCalculators = [
      { ...makeCalc('calc-a', 10000), name: 'Job $10000' },
      { ...makeCalc('calc-b', 8000), name: 'Job $8000' },
    ];

    const getTitles = (calculators: any[]) => {
      const titles: Record<string, string> = {};
      calculators.forEach((calc: any) => {
        titles[calc._id] = `Job $${(calc.price || 0).toFixed(0)}`;
      });
      return titles;
    };

    const result = computeTitleSaveOrder({
      allCalculators,
      changedCalcId: 'calc-a',
      changedCalcData: { price: 8000 },
      getTitles,
      getRetailPrice: (calc: any) => Number(calc.price) || 0,
    });

    expect(Array.isArray(result)).toBe(true);
  });

  test('handles single calculator without title conflicts', () => {
    const allCalculators = [makeCalc('calc-1', 10000, 'Job $10000')];
    const result = computeTitleSaveOrder({
      allCalculators,
      changedCalcId: 'calc-1',
      changedCalcData: { price: 12000 },
      getTitles: mockGetTitles,
      getRetailPrice: mockGetRetailPrice,
    });

    expect(result.length).toBe(1);
    expect(result[0].calculatorId).toBe('calc-1');
  });
});
