import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProductsService } from '../services/api/ProductsService';

/**
 * useRepProducts — the company's published product NAMES.
 *
 * Port of the web `useGetRepProducts` (`src/api/products-rep.js`), swapping SWR
 * for TanStack Query:
 *
 *   GET /products-rep  ->  { data: [{ name, ... }, ...] }
 *
 * Used by customer-facing copy that has to say what the company installs (the
 * Roof Waiver agreement), so the wording follows the tenant instead of naming
 * LeafFilter's products. Cached generously — the list changes rarely and every
 * consumer only needs it to render a sentence.
 */

export interface UseRepProductsResult {
  /** Never null: callers render copy off this, so an empty list is the safe shape. */
  products: string[];
  productsLoading: boolean;
  productsError: unknown;
  refetch: () => void;
}

export function useRepProducts(): UseRepProductsResult {
  const { data, isLoading, error, refetch } = useQuery<string[]>({
    queryKey: ['products', 'rep'],
    queryFn: async () => {
      const res = await ProductsService.getRepProducts();
      const payload = res?.data;
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
      return rows.map((p: any) => p?.name).filter(Boolean);
    },
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });

  return useMemo(
    () => ({
      products: data ?? [],
      productsLoading: isLoading,
      productsError: error,
      refetch,
    }),
    [data, isLoading, error, refetch]
  );
}
