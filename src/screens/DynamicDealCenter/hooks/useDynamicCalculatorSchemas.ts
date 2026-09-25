import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OFFLINE_CACHE, cachedFetch } from '../../../utils/offline-query-cache';
import { isOnline } from '../../../services/connectivity';
import { useAuth } from '../../../hooks/useAuth';

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
  /** Force a re-read of the published config (pull-to-refresh, or after an edit). */
  refetch: () => void;
}

export function useDynamicCalculatorSchemas(
  options: UseDynamicCalculatorSchemasOptions = {}
): UseDynamicCalculatorSchemasResult {
  const { enabled = true } = options;
  // The job builder's verticals and tabs are company setup, so they are cached: with no signal the
  // builder would otherwise fall back to `createDefaultJobBuilderConfig()`, which is a different
  // set of products from the one the rep just quoted.
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
          // Attach product colors (from Product Management) to each tab so swatch
          // fields can list every color + resolve a product image (web parity —
          // `api/job-builder-products.js` wraps the config in this before use).
          const enriched = enrichConfigWithProductColors(normalized, normalized.products || []);
          return ensureVerticalSummaryTabs(
            migrateConfigTabFields(enriched)
          ) as JobBuilderConfig;
        },
        // ⚠️ A config with no verticals is the "not configured yet" answer and must never be
        // written over a good copy — offline that would silently swap the rep's real products for
        // the bundled default set.
        { online: isOnline(), userId, isEmpty: (d: any) => !d?.verticals?.length }
      ),
    enabled,
    // ⚠️ The portal is the AUTHORING side of this config, so it changes under a
    // running app — a rep can be looking at a tab while someone renames an option
    // or edits a default. This used to be `staleTime: 5 * 60 * 1000`, which meant
    // a portal edit stayed invisible for at least five minutes, and in practice
    // longer: `refetchOnWindowFocus` is false globally (`queryClient.ts`) and
    // nothing wires React Query's `focusManager` to RN's `AppState`, so a mounted
    // builder never revalidated at all. The cache is memory-only (no
    // `persistQueryClient`), which is why only a full app restart picked changes up.
    //
    // `staleTime: 0` + `refetchOnMount: 'always'` gives stale-while-revalidate:
    // React Query hands back the cached config synchronously so the tab still
    // paints instantly, then refetches in the background and re-renders if the
    // config actually changed. The cost is one GET per mount of the Deal Center /
    // Job Builder / Investment Center, not per render — all three share this one
    // query key.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    // Opts INTO focus refetching (the global default is false). `queryClient.ts`
    // wires `focusManager` to `AppState`, so coming back from the background
    // revalidates the config even when the screen never unmounted.
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
