import {
  mapCategoryImagesToProductColors,
  getProductColorsForTab,
  enrichConfigWithProductColors,
  resolveColorsForField,
  getSelectedColorImage,
} from '../../../src/utils/dynamic-job-builder/engine/product-catalog-utils';

// Web parity: `engine/product-catalog-utils.js` + `engine/resolve-colors.js`.
// Colors live on the PRODUCT (category.images[]), not the saved field config, so
// the swatch picker must resolve them from tab.productColors after enrichment.
const product = {
  id: 'p1',
  name: 'Gutter',
  categories: [
    {
      name: 'Gutter',
      images: [
        { name: 'White', hex: '#FFFFFF', imageUrl: 'https://img/white.png', bucketName: 'b', filePath: 'f/white' },
        { name: 'Bronze', hex: '#5A3A22', bucketName: 'b', filePath: 'f/bronze' },
        { hex: '', name: '' }, // dropped (no hex/name)
      ],
    },
  ],
};

const config = {
  verticals: [
    {
      id: 'p1',
      productId: 'p1',
      label: 'Gutter',
      tabs: [{ id: 't1', label: 'Gutter', productCategory: 'Gutter', fields: [] }],
    },
  ],
  products: [product],
};

describe('mapCategoryImagesToProductColors', () => {
  test('maps images to colors, dropping entries with no hex/name', () => {
    const colors = mapCategoryImagesToProductColors(product.categories[0]);
    expect(colors).toHaveLength(2);
    expect(colors[0]).toMatchObject({ name: 'White', hex: '#FFFFFF', imageUrl: 'https://img/white.png', bucketName: 'b', filePath: 'f/white' });
    expect(colors[1]).toMatchObject({ name: 'Bronze', hex: '#5A3A22', filePath: 'f/bronze' });
  });
});

describe('getProductColorsForTab — category matched case-insensitively', () => {
  test('resolves the category images', () => {
    expect(getProductColorsForTab(product, 'gutter')).toHaveLength(2);
    expect(getProductColorsForTab(product, 'Unknown')).toHaveLength(0);
  });
});

describe('enrichConfigWithProductColors', () => {
  test('attaches productColors to each tab (web api wrapper parity)', () => {
    const enriched = enrichConfigWithProductColors(config, config.products);
    const tab = enriched.verticals[0].tabs[0];
    expect(tab.productColors).toHaveLength(2);
    expect(tab.productColors[0].name).toBe('White');
  });
  test('no-op on an empty config', () => {
    expect(enrichConfigWithProductColors(null as any)).toBeNull();
    expect(enrichConfigWithProductColors({ verticals: [] })).toEqual({ verticals: [] });
  });
});

describe('resolveColorsForField — tab.productColors is the primary source', () => {
  const enriched = enrichConfigWithProductColors(config, config.products);
  const tab = enriched.verticals[0].tabs[0];

  test('reads from tab.productColors (colors + image refs present)', () => {
    const colors = resolveColorsForField({ type: 'swatch' }, tab);
    expect(colors.map((c) => c.name)).toEqual(['White', 'Bronze']);
    expect(colors[0].filePath).toBe('f/white');
  });
  test('falls back to field.customColors when no tab colors', () => {
    const colors = resolveColorsForField(
      { customColors: [{ name: 'Red', hex: '#f00' }] },
      { label: 'X' },
    );
    expect(colors).toEqual([{ name: 'Red', hex: '#f00', imageUrl: '', bucketName: '', filePath: '' }]);
  });
  test('empty when nothing resolves', () => {
    expect(resolveColorsForField({}, {})).toEqual([]);
  });
});

describe('getSelectedColorImage', () => {
  const enriched = enrichConfigWithProductColors(config, config.products);
  const tab = enriched.verticals[0].tabs[0];

  test('returns the selected color image when it has a plain imageUrl', () => {
    expect(getSelectedColorImage({ type: 'swatch' }, 'White', tab)).toEqual({ imageurl: 'https://img/white.png' });
  });
  test('null when the color has no imageUrl or none selected', () => {
    expect(getSelectedColorImage({ type: 'swatch' }, 'Bronze', tab)).toBeNull();
    expect(getSelectedColorImage({ type: 'swatch' }, '', tab)).toBeNull();
  });
});
