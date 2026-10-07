import { getTabSections } from './combination-utils';

export function ensureVerticalSummaryTabs(config: any) {
  if (!config?.verticals?.length) return config;

  return {
    ...config,
    verticals: config.verticals.map((vertical: any) => {
      const hasSummary = vertical.tabs?.some((tab: any) => tab.isSummary);
      if (hasSummary) return vertical;

      return {
        ...vertical,
        tabs: [
          ...(vertical.tabs || []),
          {
            id: 'summary',
            label: 'Summary',
            isSummary: true,
            lockedByDefault: false,
            combinations: { enabled: false, defaultItem: {}, fields: [] },
            fields: [],
          },
        ],
      };
    }),
  };
}

export function buildTabKey(productId: string, categoryName: string) {
  const slug = (categoryName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'tab';
  return `${productId}__${slug}`;
}

export function sanitizeColorFields(config: any) {
  if (!config) return config;
  return config;
}

export interface ProductColor {
  id?: string;
  name: string;
  hex: string;
  imageUrl: string;
  bucketName: string;
  filePath: string;
}

export function mapCategoryImagesToProductColors(category: any): ProductColor[] {
  return (category?.images || [])
    .filter((image: any) => image?.hex || image?.name)
    .map((image: any, index: number) => ({
      id: image.id || `color_${index}`,
      name: image.name || image.hex || `Color ${index + 1}`,
      hex: image.hex || '#000000',
      imageUrl: image.imageUrl || '',
      bucketName: image.bucketName || '',
      filePath: image.filePath || '',
    }));
}

function normalizeProductRecord(product: any) {
  if (!product) return null;
  const id = product.id || product._id;
  if (!id) return null;
  return {
    ...product,
    id: String(id),
    name: product.name || product.product || 'Product',
    categories: product.categories || [],
  };
}

function findProductCategory(product: any, categoryName: string) {
  const normalized = (categoryName || '').trim().toLowerCase();
  return (product?.categories || []).find(
    (category: any) => (category?.name || '').trim().toLowerCase() === normalized,
  );
}

export function getProductColorsForTab(product: any, categoryName: string): ProductColor[] {
  return mapCategoryImagesToProductColors(findProductCategory(product, categoryName));
}

export function enrichConfigWithProductColors(config: any, products: any[] = []) {
  if (!config?.verticals?.length) return config;

  const productById = new Map(
    (products || [])
      .map(normalizeProductRecord)
      .filter(Boolean)
      .map((product: any) => [product.id, product]),
  );

  return {
    ...config,
    verticals: config.verticals.map((vertical: any) => {
      const product = productById.get(String(vertical.productId || vertical.id));
      return {
        ...vertical,
        tabs: (vertical.tabs || []).map((tab: any) => {
          const categoryName = tab.productCategory || tab.label;
          return {
            ...tab,
            productColors: getProductColorsForTab(product, categoryName),
          };
        }),
      };
    }),
  };
}

export function resolveColorsForField(field: any, tab: any, products: any[] = []): ProductColor[] {
  if (tab?.productColors?.length) {
    return tab.productColors.map((color: any) => ({
      name: color.name || color.hex,
      hex: color.hex,
      imageUrl: color.imageUrl || '',
      bucketName: color.bucketName || '',
      filePath: color.filePath || '',
    }));
  }

  const resolvedProductId = field?.productId || tab?.productId;
  const categoryName = tab?.productCategory || tab?.label;

  if (resolvedProductId && categoryName && products?.length) {
    const product = (products || []).find(
      (p: any) => String(p.id || p._id) === String(resolvedProductId),
    );
    if (product) {
      const colors = getProductColorsForTab(product, categoryName);
      if (colors.length) return colors;
    }
  }

  if (field?.customColors?.length) {
    return field.customColors.map((c: any) => ({
      name: c.name || c.hex,
      hex: c.hex,
      ...(c.hex2 ? { hex2: c.hex2 } : {}),
      imageUrl: c.imageUrl || '',
      bucketName: c.bucketName || '',
      filePath: c.filePath || '',
    }));
  }

  return [];
}

export function getSelectedColorImage(
  field: any,
  selectedColorName: string,
  tab: any,
  products: any[] = [],
): { imageurl: string } | null {
  if (!selectedColorName) return null;
  const entry = resolveColorsForField(field, tab, products).find((c) => c.name === selectedColorName);
  if (!entry?.imageUrl) return null;
  return { imageurl: entry.imageUrl };
}

export function getSchemaRetailPrice(schema: any, dealCenterData: any = {}) {
  if (!schema) return 0;
  const priceField = schema.fields?.find((f: any) => f.key === 'retailPrice' || f.key === 'price');
  if (!priceField) return 0;
  return Number(dealCenterData[priceField.id]) || 0;
}
