import { useCalculatorSchema } from './useCalculatorSchema';
import { useDynamicCalculatorSchemas } from './useDynamicCalculatorSchemas';
import { useDealPricing } from './useDealPricing';
import { useGetAgreementConfig } from './useAgreementConfig';
import { useGetDescriptionSchemas, useWarmDescriptionSchemas } from './useDescriptionSchema';
import { agreementProductIds } from '../../../utils/offline-agreement-config';

export function useWarmDealCenterConfig(): void {
  useCalculatorSchema();
  const { verticals } = useDynamicCalculatorSchemas();
  useDealPricing(null);

  // An agreement drawn on the device (offline / door-created lead) is built from CONFIG: the layout
  // (`/agreement-config`) and each product's Description of Work schema (`/description-schema/:productId`, with its lighting
  // `[IF]` lines). Fetched here while there is signal so they are on disk when there is not.
  useGetAgreementConfig(true);
  useGetDescriptionSchemas(true);
  useWarmDescriptionSchemas(agreementProductIds(verticals));
}
