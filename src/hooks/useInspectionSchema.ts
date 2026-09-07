import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { InspectionService } from '../services/api/InspectionService';
import { OFFLINE_CACHE, readOfflineCache, writeOfflineCache } from '../utils/offline-query-cache';
import {
  hasCapturable,
  type InspectionCategory,
  type InspectionProduct,
} from '../widgets/components/lead-center/dynamic-inspection-schema-utils';

/**
 * useInspectionSchema — sales-side hook for the DYNAMIC inspection photos flow.
 *
 * A faithful port of the web `useGetSalesRepInspectionSchemas`
 * (`src/api/inspection-photo-schema.js`), swapping SWR for TanStack Query.
 *
 *   GET /inspection-photo-schemas/sales-rep  ->  { data: [product, ...] }
 *
 * Every product carries `inspectionPhotoSchema: { id, categories }` (or null when
 * the admin hasn't configured one). The schema is authored in the admin portal —
 * read-only on the sales side. We only surface products with a configured,
 * non-empty schema (`hasSchema`) so the rep sees selectable product tabs;
 * when nothing is configured (`productsEmpty`) callers fall back to the legacy
 * hardcoded inspection form.
 */

function normalizeProduct(raw: any): InspectionProduct | null {
  if (!raw || typeof raw !== 'object') return null;

  const schema = raw.inspectionPhotoSchema || null;
  const categories: InspectionCategory[] = Array.isArray(schema?.categories)
    ? schema.categories
    : [];

  return {
    id: raw._id || raw.id || null,
    name: raw.name || raw.product || raw.productName || 'Product',
    icon: raw.icon || null,
    color: raw.color || null,
    schemaId: schema?.id || null,
    categories,
    // Only products whose schema has at least one actual capturable slot (any
    // category type) count — this hides empty/default "New Category" schemas.
    hasSchema: hasCapturable(categories),
    raw,
  };
}

export interface UseInspectionSchemaResult {
  products: InspectionProduct[];
  configuredProducts: InspectionProduct[];
  productsLoading: boolean;
  productsError: unknown;
  productsValidating: boolean;
  productsEmpty: boolean;
  /**
   * The schema is KNOWN — it came back from the server, or from the offline snapshot.
   *
   * ⚠️ Not the same question as `productsEmpty`. A company that has configured nothing
   * legitimately resolves to zero products and legitimately uses the legacy photo flow. A
   * device that could not reach the endpoint resolves to zero products as well, and must NOT
   * be treated the same way — see `JobDocsSection`, where the two were conflated and offline
   * captures were silently filed through the legacy flow under unscoped categories.
   */
  schemaResolved: boolean;
  /** Resolved, but from the on-device snapshot rather than a live read. */
  schemaFromCache: boolean;
  refetch: () => void;
}

interface UseInspectionSchemaOptions {
  enabled?: boolean;
}

export function useInspectionSchema(
  options: UseInspectionSchemaOptions = {}
): UseInspectionSchemaResult {
  const { enabled = true } = options;

  // ⚠️ Read straight from the store rather than through `useAuth`, which pulls in the API
  // client, the socket and the query client — a heavy import for one id, on a hook that
  // `JobDocsSection` and `RevRender` both mount.
  const userId = useSelector((state: any) => state?.auth?.user?._id || state?.auth?.user?.id);

  // The snapshot from the last successful read on this account. Resolved ONCE per user so the
  // query's `initialData` identity is stable — a fresh object every render would make React
  // Query treat it as new data on each pass.
  const cached = useMemo(
    () => readOfflineCache<any[]>(OFFLINE_CACHE.INSPECTION_SCHEMA, { userId }),
    [userId]
  );

  const {
    data,
    isLoading,
    error,
    isFetching,
    isFetched,
    refetch,
  } = useQuery<any[]>({
    queryKey: ['inspectionPhotoSchemas', 'salesRep', userId || 'anon'],
    queryFn: async () => {
      const res = await InspectionService.getSalesRepInspectionSchemas();
      const payload = res?.data;
      const list = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
      // Persisted so a cold start with no signal still knows which photo flow to run.
      // Written even when EMPTY: "this company has configured nothing" is a real answer and
      // must be distinguishable offline from "we never asked".
      writeOfflineCache(OFFLINE_CACHE.INSPECTION_SCHEMA, list, userId);
      return list;
    },
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
    // ⚠️ `initialData` rather than `placeholderData`: this IS the data, and it must survive a
    // failed refetch rather than being discarded the moment the query settles. Paired with
    // `initialDataUpdatedAt` so an old snapshot still reads as stale and refetches the instant
    // there is signal — the cache accelerates the app, it does not pin it to the past.
    initialData: cached ? (cached.data as any[]) : undefined,
    initialDataUpdatedAt: cached?.savedAt,
  });

  return useMemo(() => {
    const raw = Array.isArray(data) ? data : [];
    const products = raw.map(normalizeProduct).filter(Boolean) as InspectionProduct[];
    // Only products with an actual configured schema are usable in the rep flow.
    const configuredProducts = products.filter((p) => p.hasSchema);

    return {
      products,
      configuredProducts,
      productsLoading: isLoading,
      productsError: error,
      productsValidating: isFetching,
      productsEmpty: !isLoading && configuredProducts.length === 0,
      schemaResolved: Array.isArray(data),
      schemaFromCache: !!cached && !isFetched,
      refetch,
    };
  }, [data, error, isLoading, isFetching, cached, isFetched, refetch]);
}
