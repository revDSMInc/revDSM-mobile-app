import { AxiosResponse } from 'axios';
import api from './index';

export const InspectionEndpoints = {
  salesRep: '/inspection-photo-schemas/sales-rep',
} as const;

export const InspectionService = {
  getSalesRepInspectionSchemas: (): Promise<AxiosResponse<any>> =>
    api.get(InspectionEndpoints.salesRep),
};

export default InspectionService;
