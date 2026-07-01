import {
  pricing,
  extrasList,
  extrasList50,
  markups,
} from '../../../src/utils/calculator/pricing-data';

describe('pricing data integrity', () => {
  test('pricing has gutters, filters, screens, extras', () => {
    expect(pricing).toHaveProperty('gutters');
    expect(pricing).toHaveProperty('filters');
    expect(pricing).toHaveProperty('screens');
    expect(pricing).toHaveProperty('extras');
  });

  test('gutters have all inch sizes', () => {
    expect(pricing.gutters).toHaveProperty('5_inch_all_stories');
    expect(pricing.gutters).toHaveProperty('6_inch_all_stories');
    expect(pricing.gutters).toHaveProperty('7_inch_all_stories');
  });

  test('gutters2 has lower prices than gutters', () => {
    expect(pricing.gutters2['5_inch_all_stories']).toBeLessThan(pricing.gutters['5_inch_all_stories']);
    expect(pricing.gutters2['6_inch_all_stories']).toBeLessThan(pricing.gutters['6_inch_all_stories']);
    expect(pricing.gutters2['7_inch_all_stories']).toBeLessThan(pricing.gutters['7_inch_all_stories']);
  });

  test('filters has versa_6, versa_7, filter_4_5, versa_max_all_stories', () => {
    expect(pricing.filters).toHaveProperty('versa_6');
    expect(pricing.filters).toHaveProperty('versa_7');
    expect(pricing.filters).toHaveProperty('filter_4_5');
    expect(pricing.filters).toHaveProperty('versa_max_all_stories');
  });

  test('filter prices increase with story height', () => {
    expect(pricing.filters.versa_6['1']).toBeLessThan(pricing.filters.versa_6['2']);
    expect(pricing.filters.versa_6['2']).toBeLessThan(pricing.filters.versa_6['3']);
  });

  test('screens price is a number', () => {
    expect(typeof pricing.screens).toBe('number');
    expect(pricing.screens).toBeGreaterThan(0);
  });

  test('extras has expected keys', () => {
    expect(pricing.extras).toHaveProperty('wedges');
    expect(pricing.extras).toHaveProperty('straps');
    expect(pricing.extras).toHaveProperty('extraLabor');
    expect(pricing.extras).toHaveProperty('vinylSoffit');
    expect(pricing.extras).toHaveProperty('fasciaBoard');
  });
});

describe('markups', () => {
  test('has expected markup keys', () => {
    expect(markups).toHaveProperty('50');
    expect(markups).toHaveProperty('65');
    expect(markups).toHaveProperty('100');
    expect(markups).toHaveProperty('130');
  });

  test('markup values are increasing', () => {
    expect(markups[50]).toBeLessThan(markups[65]);
    expect(markups[65]).toBeLessThan(markups[100]);
    expect(markups[100]).toBeLessThan(markups[130]);
  });
});

describe('extrasList', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(extrasList)).toBe(true);
    expect(extrasList.length).toBeGreaterThan(0);
  });

  test('each extra has id, label, price, icon, category', () => {
    extrasList.forEach((extra: any) => {
      expect(extra).toHaveProperty('id');
      expect(extra).toHaveProperty('label');
      expect(extra).toHaveProperty('price');
      expect(extra).toHaveProperty('icon');
      expect(extra).toHaveProperty('category');
      expect(typeof extra.id).toBe('string');
      expect(typeof extra.label).toBe('string');
      expect(typeof extra.price).toBe('number');
    });
  });

  test('all extras have non-negative price', () => {
    extrasList.forEach((extra: any) => {
      expect(extra.price).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('extrasList50', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(extrasList50)).toBe(true);
    expect(extrasList50.length).toBeGreaterThan(0);
  });

  test('each extra50 has id, label, price', () => {
    extrasList50.forEach((extra: any) => {
      expect(extra).toHaveProperty('id');
      expect(extra).toHaveProperty('label');
      expect(extra).toHaveProperty('price');
    });
  });

  test('extrasList50 prices are generally lower than extrasList prices for same items', () => {
    const extrasMap = new Map(extrasList.map((e: any) => [e.id, e.price]));
    extrasList50.forEach((extra: any) => {
      const retailPrice = extrasMap.get(extra.id);
      if (retailPrice !== undefined) {
        expect(extra.price).toBeLessThanOrEqual(retailPrice);
      }
    });
  });

  test('all extras in extrasList50 have corresponding entries in extrasList', () => {
    const allIds = new Set(extrasList.map((e: any) => e.id));
    extrasList50.forEach((extra: any) => {
      expect(allIds.has(extra.id)).toBe(true);
    });
  });
});
