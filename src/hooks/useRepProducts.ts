import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProductsService } from '../services/api/ProductsService';

export interface UseRepProductsResult {
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
