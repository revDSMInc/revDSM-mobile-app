import { useCalculatorSchema } from './useCalculatorSchema';
import { useDynamicCalculatorSchemas } from './useDynamicCalculatorSchemas';
import { useDealPricing } from './useDealPricing';

export function useWarmDealCenterConfig(): void {
  useCalculatorSchema();
  useDynamicCalculatorSchemas();
  useDealPricing(null);
}
