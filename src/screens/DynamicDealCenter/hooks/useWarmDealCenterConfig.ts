import { useCalculatorSchema } from './useCalculatorSchema';
import { useDynamicCalculatorSchemas } from './useDynamicCalculatorSchemas';
import { useDealPricing } from './useDealPricing';
import { useGetAgreementConfig } from './useAgreementConfig';
import {
  useGetDescriptionSchemas,
  useGetDealCenterDescriptionSchemas,
  useWarmDescriptionSchemas,
} from './useDescriptionSchema';
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
  /**
   * ⚠️ THE DEAL CENTER SCHEMAS TOO - a DIFFERENT collection, and the one the Investment
   * Center's "Includes the Following" is built from.
   *
   *   `/sales-rep/v1/description-schema`           -> job builder (the line above)
   *   `/company/v1/deal-center-description-schema` -> THIS
   *
   * Reported as "sometimes in offline mode the description doesn't show in Investment Center".
   * The sometimes was WHICH REP: this schema was warmed only from inside the Deal Center, whose
   * own comment assumed "the Deal Center is always visited first". It is not - a rep can open a
   * lead and go straight to the Investment Center, and the cache is per user, so a second rep on
   * the same handset had no copy at all. A real device store showed the job-builder schema cached
   * for THREE users and this one for ONE.
   *
   * Warming it here, on the Leads screen, means every rep who opens the app online has it before
   * they reach a door. The hook is cached + deduped by TanStack, so the extra call is free.
   */
  useGetDealCenterDescriptionSchemas(true);
  useWarmDescriptionSchemas(agreementProductIds(verticals));
}
