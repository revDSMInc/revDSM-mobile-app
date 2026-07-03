import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { createDefaultJobBuilderConfig } from '../../../utils/dynamic-job-builder/constants/default-config';
import { ensureVerticalSummaryTabs } from '../../../utils/dynamic-job-builder/engine/product-catalog-utils';
import type { JobBuilderConfig, Vertical } from '../../../utils/dynamic-job-builder/types';

/**
 * Loads the published job-builder-products config that drives the Dynamic Job
 * Builder verticals/tabs (System B — distinct from the calculator-form schema
 * consumed by `useCalculatorSchema`).
 *
 * Mirrors the web implementation (`src/api/job-builder-products.js`):
 *   GET /company/v1/job-builder-products  ->  { code: 200, data: { verticals[], products[], ... } }
 * We normalize the lightweight document and ensure each vertical has a Summary
 * tab, then fall back to the bundled default config when nothing is published.
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
  config: JobBuilderConfig;
  /** true when the config came from the backend rather than the bundled default */
  isRemote: boolean;
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
      return ensureVerticalSummaryTabs(normalized) as JobBuilderConfig;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return useMemo(() => {
    const fallbackConfig = createDefaultJobBuilderConfig();
    const isRemote = Boolean(data?.verticals?.length);
    const config = isRemote ? (data as JobBuilderConfig) : fallbackConfig;
    return {
      verticals: config.verticals,
      config,
      isRemote,
      isLoading,
    };
  }, [data, isLoading]);
}
