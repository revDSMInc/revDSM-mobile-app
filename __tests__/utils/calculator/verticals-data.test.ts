import {
  verticals,
  getAllVerticalItems,
  getVerticalItemIds,
  getVerticalItemCost,
  getVerticalItemRetail,
  getVerticalItemDef,
} from '../../../src/utils/calculator/verticals-data';

describe('verticals-data integrity', () => {
  test('verticals object has all expected vertical categories', () => {
    const expectedVerticals = ['Gutters / Roofline', 'Roofing', 'Windows', 'Flooring', 'Home Remodeling'];
    expectedVerticals.forEach((v) => {
      expect(verticals).toHaveProperty(v);
    });
  });

  test('each vertical has at least one card', () => {
    Object.values(verticals).forEach((vertical: any) => {
      expect(vertical.cards.length).toBeGreaterThan(0);
    });
  });

  test('each card has at least one section with items', () => {
    Object.values(verticals).forEach((vertical: any) => {
      vertical.cards.forEach((card: any) => {
        expect(card.sections.length).toBeGreaterThan(0);
        card.sections.forEach((section: any) => {
          expect(section.items.length).toBeGreaterThan(0);
        });
      });
    });
  });

  test('each card has required fields', () => {
    Object.values(verticals).forEach((vertical: any) => {
      vertical.cards.forEach((card: any) => {
        expect(card).toHaveProperty('id');
        expect(card).toHaveProperty('title');
        expect(card).toHaveProperty('subtitle');
        expect(card).toHaveProperty('icon');
        expect(card).toHaveProperty('sections');
        expect(typeof card.id).toBe('string');
        expect(typeof card.title).toBe('string');
      });
    });
  });
});

describe('getAllVerticalItems', () => {
  test('returns an array of items', () => {
    const items = getAllVerticalItems();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(50);
  });

  test('each item has id, name, cost, retail, vertical, cardId', () => {
    const items = getAllVerticalItems();
    items.forEach((item) => {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('cost');
      expect(item).toHaveProperty('retail');
      expect(item).toHaveProperty('vertical');
      expect(item).toHaveProperty('cardId');
      expect(typeof item.id).toBe('string');
      expect(typeof item.cost).toBe('number');
      expect(typeof item.retail).toBe('number');
    });
  });

  test('retail >= cost for all items', () => {
    const items = getAllVerticalItems();
    items.forEach((item) => {
      expect(item.retail).toBeGreaterThanOrEqual(item.cost);
    });
  });

  test('no duplicate ids', () => {
    const items = getAllVerticalItems();
    const ids = items.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('getVerticalItemIds', () => {
  test('returns all item ids', () => {
    const items = getAllVerticalItems();
    const ids = getVerticalItemIds();
    expect(ids.length).toBe(items.length);
  });

  test('all ids are strings', () => {
    const ids = getVerticalItemIds();
    ids.forEach((id) => {
      expect(typeof id).toBe('string');
    });
  });
});

describe('getVerticalItemCost', () => {
  test('returns correct cost for known item', () => {
    const cost = getVerticalItemCost('gutter5DsE');
    expect(cost).toBe(7.25);
  });

  test('returns 0 for unknown item', () => {
    const cost = getVerticalItemCost('non_existent_item');
    expect(cost).toBe(0);
  });

  test('returns correct cost for roofing item', () => {
    const cost = getVerticalItemCost('rfShngl3Tab');
    expect(cost).toBe(52.5);
  });

  test('returns correct cost for window item', () => {
    const cost = getVerticalItemCost('winSH_VinylStd');
    expect(cost).toBe(325);
  });

  test('returns correct cost for remodel item', () => {
    const cost = getVerticalItemCost('rmTubReplace');
    expect(cost).toBe(2250);
  });
});

describe('getVerticalItemRetail', () => {
  test('returns correct retail for known item', () => {
    const retail = getVerticalItemRetail('gutter5DsE');
    expect(retail).toBe(14.5);
  });

  test('returns 0 for unknown item', () => {
    const retail = getVerticalItemRetail('non_existent_item');
    expect(retail).toBe(0);
  });

  test('returns correct retail for roofing item', () => {
    const retail = getVerticalItemRetail('rfShngl3Tab');
    expect(retail).toBe(105);
  });

  test('returns correct retail for window item', () => {
    const retail = getVerticalItemRetail('winSH_VinylLowE');
    expect(retail).toBe(747);
  });
});

describe('getVerticalItemDef', () => {
  test('returns item definition for known id', () => {
    const def = getVerticalItemDef('gutter5DsE');
    expect(def).not.toBeNull();
    expect(def!.id).toBe('gutter5DsE');
    expect(def!.name).toBe('5" Gutter/DS/E');
  });

  test('returns null for unknown id', () => {
    const def = getVerticalItemDef('non_existent');
    expect(def).toBeNull();
  });

  test('returned def includes vertical name', () => {
    const def = getVerticalItemDef('gutter5DsE');
    expect(def!.vertical).toBe('Gutters / Roofline');
  });

  test('returned def includes cardId', () => {
    const def = getVerticalItemDef('gutter5DsE');
    expect(def!.cardId).toBe('gutters');
  });
});
