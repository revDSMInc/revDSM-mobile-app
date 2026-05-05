import api from './index';
import { AxiosResponse } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV } from '../../config/env';

/**
 * Lead Management Endpoints
 */
export const LeadEndpoints = {
  create: 'lead/v1/create',
  salesPortal: 'demo/v1/leads/sales-portal',
  work: (leadId: string) => `lead/v1/${leadId}/work`,
  jobBuilder: (leadId: string) => `lead/v1/${leadId}/job-builder`,
  outcome: (leadId: string) => `lead/v1/${leadId}/outcome`,
  appointments: 'appointments',
  calculators: (appointmentId: string) => `appointments/${appointmentId}/lfcalculators`,
  updateCalculator: (id: string) => `lfcalculators/${id}`,
  favourite: 'lead/v1/favourite',
  archive: (id: string) => `lead/v1/archive/${id}`,
  delete: (id: string) => `lead/v1/delete/${id}`,
  // Production documentation additions
  images: (leadId: string) => `demo/v1/leads/${leadId}/images`,
  reset: (leadId: string) => `lead/v1/${leadId}/reset`,
  additionalSlots: (leadId: string) => `leads/${leadId}/additional-slots`,
  digitalConsent: 'consent/digital',
  secureUrls: 'url/v1/secure/multiple',
  productBuilder: 'product-builder/v1/products',
  getJobs: {
    list: '/job/v1/find',
  },
  referral: {
    create: '/referral/v1/customer',
    update: (id: string) => `/referral/v1/customer/${id}`,
    updateBeforeImages: '/job/v1/upload/beforeImages',
    updateAfterImages: '/job/v1/upload/afterImages',
    deleteImages: '/job/v1/remove/images',
  },
  agreement: {
    preview: (leadId: string) => `pdf-reports/v1/agreement/${leadId}/preview`,
    sign: (leadId: string) => `pdf-reports/v1/agreement/${leadId}/sign`,
  },
  weather: {
    generate: (leadId: string) => `pdf-reports/v1/weather/${leadId}/generate`,
    status: (jobId: string) => `pdf-reports/v1/job/${jobId}/status`,
    download: (jobId: string) => `pdf-reports/v1/job/${jobId}/download`,
    reset: (reportId: string) => `pdf-reports/v1/weather/report/${reportId}/reset`,
  },
};

export const LeadService = {
  createLead: (data: any): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.create, data),
  getSalesLeads: (repId: string, params?: any): Promise<AxiosResponse<any>> => {
    const query = new URLSearchParams({ repId, ...params }).toString();
    return api.get(`${LeadEndpoints.salesPortal}?${query}`);
  },
  workLead: (
    leadId: string,
    userId: string,
    status: string | null = null
  ): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.work(leadId), { userId, workStartedBy: userId, status }),
  getJobBuilder: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcome(leadId)),
  getLeadOutcome: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcome(leadId)),
  submitJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), payload),
  updateLeadOutcome: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.outcome(leadId), payload),

  uploadImages: (leadId: string, formData: FormData): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.images(leadId), formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteImage: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.delete(LeadEndpoints.images(leadId), { data: payload }),
  resetLead: (leadId: string): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.reset(leadId)),
  getAdditionalSlots: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.additionalSlots(leadId)),
  saveAdditionalSlots: (leadId: string, slots: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.additionalSlots(leadId), slots),
  uploadPaperConsent: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('api/v1/consent-form/upload', payload),
  submitRoofWaiver: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(`/lead/v1/${leadId}/mobile/waiver-form`, payload, { timeout: 60000 }),
  uploadGeneratedReport: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/generated-reports/v1', payload),
  logReportGeneration: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/job/v1/generate-report-logs', payload),
  generateRevRender: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/rev-render/v1/generate', payload, { timeout: 120000 }),
  getRevRenderRuns: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(`/rev-render/v1/runs?leadId=${leadId}`),
  createAppointment: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/appointments', payload),
  getAppointmentsByDate: (date: string): Promise<AxiosResponse<any>> =>
    api.get(`/appointments/${date}`),
  getAppointments: (params?: any): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.appointments, { params }),
  getCalculators: (appointmentId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.calculators(appointmentId)),
  createCalculator: (appointmentId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.calculators(appointmentId), payload),
  updateCalculator: (id: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.updateCalculator(id), payload),
  toggleFavourite: (leadId: string): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.favourite, { leadId }),
  archiveLead: (id: string, isArchive: boolean): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.archive(id), { isArchive }),
  deleteLead: (id: string): Promise<AxiosResponse<any>> => api.delete(LeadEndpoints.delete(id)),
  getSecureUrls: (
    filePaths: { bucketName: string; filePath: string }[]
  ): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.secureUrls, { filePaths }),
  logEvent: (action: string, payload: any): Promise<AxiosResponse<any> | void> =>
    api.post('lead/v1/event-logs', { action, ...payload }).catch(() => {
      // Fail silently as logging is a non-critical background task
    }),
  updateLeadTimelineProgress: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(`lead/v1/${leadId}/timeline-progress`, payload),
  deleteCalculator: (id: string): Promise<AxiosResponse<any>> => api.delete(`lfcalculators/${id}`),
  getProductImage: (productName: string, colorCode: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.productBuilder, {
      params: { productName, colorCode, matchType: 'like' },
    }),

  // Job Images (Map Module)
  updateBeforeImages: (formData: FormData): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.referral.updateBeforeImages, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  updateAfterImages: (formData: FormData): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.referral.updateAfterImages, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteJobImages: (payload: any): Promise<AxiosResponse<any>> =>
    api.delete(LeadEndpoints.referral.deleteImages, { data: payload }),

  // Referrals
  createReferral: (payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.referral.create, payload),

  findJobs: (payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.getJobs.list, payload),

  generateInspectionReport: (leadId: string, data: any): Promise<AxiosResponse<any>> =>
    api.post(`/pdf-reports/v1/inspection/${leadId}/generate`, data, {
      responseType: 'blob',
    }),

  previewAgreement: (leadId: string, data: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.preview(leadId), data),

  signAgreement: (leadId: string, formData: FormData): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.sign(leadId), formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      responseType: 'blob',
    }),
  generateWeatherReport: (leadId: string, pastYears: number): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.weather.generate(leadId), { pastYears }),
  getJobStatus: (jobId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.weather.status(jobId)),
  getRiskDownloadUrl: (jobId: string) => `${ENV.API_URL}/${LeadEndpoints.weather.download(jobId)}`,
  resetWeatherReport: (reportId: string): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.weather.reset(reportId)),
};
