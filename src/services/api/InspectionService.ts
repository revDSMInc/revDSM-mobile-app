import { AxiosResponse } from 'axios';
import api from './index';

/**
 * InspectionService — sales-side fetch for the DYNAMIC inspection photos flow.
 *
 * Mirrors the web reference (`src/api/inspection-photo-schema.js` +
 * `endpoints.inspectionPhotoSchema.salesRep`):
 *   GET /inspection-photo-schemas/sales-rep
 *
 * Company-scoped (resolved from the JWT). Returns every product for the rep's
 * company, each with an `inspectionPhotoSchema: { id, categories }` (or null when
 * the admin hasn't configured one for that product). Response is either
 * `{ data: [product, ...] }` or a bare `[product, ...]` — both are handled by the
 * normalizer in `useInspectionSchema`.
 */
export const InspectionEndpoints = {
  salesRep: '/inspection-photo-schemas/sales-rep',
} as const;

export const InspectionService = {
  getSalesRepInspectionSchemas: (): Promise<AxiosResponse<any>> =>
    api.get(InspectionEndpoints.salesRep),
};

export default InspectionService;
