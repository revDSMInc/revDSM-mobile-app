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
  schemaResolved: boolean;
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

  const userId = useSelector((state: any) => state?.auth?.user?._id || state?.auth?.user?.id);

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
      writeOfflineCache(OFFLINE_CACHE.INSPECTION_SCHEMA, list, userId);
      return list;
    },
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
    initialData: cached ? (cached.data as any[]) : undefined,
    initialDataUpdatedAt: cached?.savedAt,
  });

  return useMemo(() => {
    const raw = Array.isArray(data) ? data : [];
    const products = raw.map(normalizeProduct).filter(Boolean) as InspectionProduct[];
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
