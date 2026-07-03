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

export function getSchemaRetailPrice(schema: any, dealCenterData: any = {}) {
  if (!schema) return 0;
  const priceField = schema.fields?.find((f: any) => f.key === 'retailPrice' || f.key === 'price');
  if (!priceField) return 0;
  return Number(dealCenterData[priceField.id]) || 0;
}
