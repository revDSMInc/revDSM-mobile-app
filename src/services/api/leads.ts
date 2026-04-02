import api from './index';
import { AxiosResponse } from 'axios';

/**
 * Lead Management Endpoints
 */
export const LeadEndpoints = {
  create: '/lead/v1/create',
  salesPortal: '/demo/v1/leads/sales-portal',
  work: (leadId: string) => `/lead/v1/${leadId}/work`,
  jobBuilder: (leadId: string) => `/lead/v1/${leadId}/job-builder`,
  outcome: (leadId: string) => `/lead/v1/${leadId}/outcome`,
};

export const LeadService = {
  createLead: (data: any): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.create, data),
  getSalesLeads: (repId: string, params?: any): Promise<AxiosResponse<any>> => {
    const query = new URLSearchParams({ repId, ...params }).toString();
    return api.get(`${LeadEndpoints.salesPortal}?${query}`);
  },
  workLead: (leadId: string, userId: string, status: string | null = null): Promise<AxiosResponse<any>> => 
    api.put(LeadEndpoints.work(leadId), { userId, status }),
  submitJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), payload),
  updateLeadOutcome: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.outcome(leadId), payload),
  getLeadOutcome: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcome(leadId)),
};
