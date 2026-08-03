import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InspectionService } from '../services/api/InspectionService';
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
  refetch: () => void;
}

interface UseInspectionSchemaOptions {
  enabled?: boolean;
}

export function useInspectionSchema(
  options: UseInspectionSchemaOptions = {}
): UseInspectionSchemaResult {
  const { enabled = true } = options;

  const {
    data,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery<any[]>({
    queryKey: ['inspectionPhotoSchemas', 'salesRep'],
    queryFn: async () => {
      const res = await InspectionService.getSalesRepInspectionSchemas();
      const payload = res?.data;
      if (Array.isArray(payload?.data)) return payload.data;
      if (Array.isArray(payload)) return payload;
      return [];
    },
    enabled,
    staleTime: 60 * 1000,
    retry: 1,
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
      refetch,
    };
  }, [data, error, isLoading, isFetching, refetch]);
}
