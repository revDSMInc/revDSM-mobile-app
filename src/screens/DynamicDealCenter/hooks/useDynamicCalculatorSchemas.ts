import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { ensureVerticalSummaryTabs, enrichConfigWithProductColors } from '../../../utils/dynamic-job-builder/engine/product-catalog-utils';
import { migrateConfigTabFields } from '../../../utils/dynamic-job-builder/engine/combination-utils';
import type { JobBuilderConfig, Vertical } from '../../../utils/dynamic-job-builder/types';

/**
 * Loads the published job-builder-products config that drives the Dynamic Job
 * Builder verticals/tabs (System B — distinct from the calculator-form schema
 * consumed by `useCalculatorSchema`).
 *
 * Mirrors the web implementation (`src/api/job-builder-products.js`):
 *   GET /company/v1/job-builder-products  ->  { code: 200, data: { verticals[], products[], ... } }
 * We normalize the lightweight document and ensure each vertical has a Summary
 * tab. There is NO bundled-default fallback: when nothing is published, `config`
 * is null and `isConfigured` is false — the caller must not render demo data.
 */

const JOB_BUILDER_PRODUCTS_URL = '/company/v1/job-builder-products';

function normalizeLightweight(doc: any): any {
  if (!doc) return null;
  const id = doc.id || doc._id;
  const rest = { ...doc };
  delete rest._id;
  delete rest.__v;
  return {
    ...rest,
    id: typeof id === 'object' && id?.toString ? id.toString() : String(id),
    verticals: rest.verticals ?? [],
    products: rest.products ?? [],
  };
}

interface UseDynamicCalculatorSchemasOptions {
  enabled?: boolean;
}

interface UseDynamicCalculatorSchemasResult {
  verticals: Vertical[];
  /** null when the backend has no published job-builder config */
  config: JobBuilderConfig | null;
  /** true when a config with verticals came from the backend */
  isRemote: boolean;
  /** true when the backend published a usable (has verticals) config */
  isConfigured: boolean;
  isLoading: boolean;
}

export function useDynamicCalculatorSchemas(
  options: UseDynamicCalculatorSchemasOptions = {}
): UseDynamicCalculatorSchemasResult {
  const { enabled = true } = options;

  const { data, isLoading } = useQuery<JobBuilderConfig | null>({
    queryKey: ['jobBuilderProductsConfig'],
    queryFn: async () => {
      const res = await api.get<any>(JOB_BUILDER_PRODUCTS_URL);
      const response = res.data as any;
      if (response?.code !== 200) return null;
      const normalized = normalizeLightweight(response.data);
      if (!normalized) return null;
      // Attach product colors (from Product Management) to each tab so swatch
      // fields can list every color + resolve a product image (web parity —
      // `api/job-builder-products.js` wraps the config in this before use).
      const enriched = enrichConfigWithProductColors(normalized, normalized.products || []);
      return ensureVerticalSummaryTabs(
        migrateConfigTabFields(enriched)
      ) as JobBuilderConfig;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const isRemote = Boolean(data?.verticals?.length);
    const config = isRemote ? (data as JobBuilderConfig) : null;
    return {
      verticals: config?.verticals ?? [],
      config,
      isRemote,
      isConfigured: isRemote,
      isLoading,
    };
  }, [data, isLoading]);
}
