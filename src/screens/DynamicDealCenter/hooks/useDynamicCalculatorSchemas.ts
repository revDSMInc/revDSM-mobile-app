import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

import api from '../../../services/api';
import { ensureVerticalSummaryTabs, enrichConfigWithProductColors } from '../../../utils/dynamic-job-builder/engine/product-catalog-utils';
import { migrateConfigTabFields } from '../../../utils/dynamic-job-builder/engine/combination-utils';
import type { JobBuilderConfig, Vertical } from '../../../utils/dynamic-job-builder/types';

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
  config: JobBuilderConfig | null;
  isRemote: boolean;
  isConfigured: boolean;
  isLoading: boolean;
  refetch: () => void;
}

export function useDynamicCalculatorSchemas(
  options: UseDynamicCalculatorSchemasOptions = {}
): UseDynamicCalculatorSchemasResult {
  const { enabled = true } = options;
  const { user } = useAuth();
  const userId = user?._id || user?.id;

  const { data, isLoading, refetch } = useQuery<JobBuilderConfig | null>({
    queryKey: ['jobBuilderProductsConfig'],
    queryFn: () =>
      cachedFetch(
        OFFLINE_CACHE.JOB_BUILDER_CONFIG,
        async () => {
          const res = await api.get<any>(JOB_BUILDER_PRODUCTS_URL);
          const response = res.data as any;
          if (response?.code !== 200) return null;
          const normalized = normalizeLightweight(response.data);
          if (!normalized) return null;
          const enriched = enrichConfigWithProductColors(normalized, normalized.products || []);
          return ensureVerticalSummaryTabs(
            migrateConfigTabFields(enriched)
          ) as JobBuilderConfig;
        },
        { online: isOnline(), userId, isEmpty: (d: any) => !d?.verticals?.length }
      ),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
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
      refetch,
    };
  }, [data, isLoading, refetch]);
}
