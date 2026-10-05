/**
 * useWarmDealCenterConfig — keep the COMPANY's Deal Center setup on the device before the rep needs it.
 *
 * The Deal Center needs four company configs (calculator schema + pricing, job-builder products,
 * payment plans, discount tiers). Each is read through `cachedFetch`, so it survives offline — but
 * only once it has been read ONLINE on this device, in this session (a sign-out clears it). Until
 * then an offline Deal Center has no schema and reads "Deal Center isn't configured yet", which is
 * false and leaves the rep nothing to do at the door.
 *
 * Mounted on the Leads list for the same reason `warmLeadCalculators` is: that is where the rep
 * still has signal. The hooks share their query keys with the Deal Center, so this costs one read
 * per config per 5 minutes and nothing when the Deal Center opens.
 */
import { useCalculatorSchema } from './useCalculatorSchema';
import { useDynamicCalculatorSchemas } from './useDynamicCalculatorSchemas';
import { useDealPricing } from './useDealPricing';

export function useWarmDealCenterConfig(): void {
  useCalculatorSchema();
  useDynamicCalculatorSchemas();
  // The lead only filters which plans are OFFERED; the cached payload is the full company list.
  useDealPricing(null);
}
