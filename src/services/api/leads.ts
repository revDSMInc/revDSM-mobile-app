import api, { hasSession } from './index';
import { AxiosResponse } from 'axios';
import { ENV } from '../../config/env';
import { IDEMPOTENCY_HEADER } from '../../utils/upload-idempotency';

/**
 * Photo uploads get their own timeout. The global 15s suits JSON; a 2-5 MB image on a weak
 * cell routinely needs longer, and timing out mid-store is exactly what created duplicates.
 * Matches the installer queue, which already used 120s.
 */
const PHOTO_UPLOAD_TIMEOUT_MS = 120_000;

export const resolveLeadCalculatorId = (lead: any): string | null =>
  lead?.selectedCalculatorId ||
  lead?.calculatorId ||
  lead?.jobBuilder?.calculatorId ||
  lead?.outcome?.selectedCalculatorId ||
  lead?.leadData?.selectedCalculatorId ||
  lead?.LFCalculator?._id ||
  null;

export const LeadEndpoints = {
  create: 'lead/v1/create',
  salesPortal: 'demo/v1/leads/sales-portal',
  salesPortalDetail: (leadId: string) => `demo/v1/leads/sales-portal/${leadId}`,
  rehashLeads: 'rehash/rep/v1/leads',
  work: (leadId: string) => `lead/v1/${leadId}/work`,
  jobBuilder: (leadId: string) => `lead/v1/${leadId}/job-builder`,
  outcomeByCalculator: (leadId: string, calculatorId: string) => `lead/v1/${leadId}/outcome/${calculatorId}`,
  appointments: 'appointments',
  calculators: (appointmentId: string) => `appointments/${appointmentId}/lfcalculators`,
  updateCalculator: (id: string) => `lfcalculators/${id}`,
  arrangeCalculators: 'lfcalculators/positions',
  favourite: 'job/v1/favorite',
  archive: (id: string) => `lead/v1/archive/${id}`,
  delete: (id: string) => `lead/v1/delete/${id}`,
  saveFilters: (leadId: string) => `lead/v1/${leadId}/saved-filters`,
  images: (leadId: string) => `demo/v1/leads/${leadId}/images`,
  updateImagePosition: (leadId: string) => `demo/v1/leads/${leadId}/images/position`,
  reset: (leadId: string) => `lead/v1/${leadId}/reset`,
  additionalSlots: (leadId: string) => `leads/${leadId}/additional-slots`,
  digitalConsent: 'consent/digital',
  secureUrls: 'url/v1/secure/multiple',
  outcomeDocument: (documentId: string) => `lead/v1/outcome/document/${documentId}`,
  productBuilder: 'product-builder/v1/products',
  getJobs: {
    list: '/job/v1/find',
  },
  customer: {
    update: (leadId: string) => `lead/v1/customer/${leadId}`,
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
    sendRemote: (leadId: string) => `pdf-reports/v1/agreement/${leadId}/send-remote`,
    remoteStatus: (leadId: string) => `pdf-reports/v1/agreement/${leadId}/remote-status`,
    remoteSignerResend: (agreementId: string, signerId: string) =>
      `pdf-reports/v1/agreement/remote/${agreementId}/signer/${signerId}/resend`,
    remoteSigner: (agreementId: string, signerId: string) =>
      `pdf-reports/v1/agreement/remote/${agreementId}/signer/${signerId}`,
    remoteCancel: (agreementId: string) => `pdf-reports/v1/agreement/remote/${agreementId}/cancel`,
    deliveryPreference: (leadId: string) =>
      `pdf-reports/v1/agreement/${leadId}/delivery-preference`,
  },
  leadDraft: {
    upsert: (leadId: string) => `lead/v1/${leadId}/drafts`,
    get: (leadId: string) => `lead/v1/${leadId}/draft`,
    update: (draftId: string) => `lead/v1/drafts/${draftId}`,
  },
  comms: {
    sms: 'comms/v1/sms',
    email: 'comms/v1/email',
  },
  weather: {
    generate: (leadId: string) => `pdf-reports/v1/weather/${leadId}/generate`,
    status: (jobId: string) => `pdf-reports/v1/job/${jobId}/status`,
    download: (jobId: string) => `pdf-reports/v1/job/${jobId}/download`,
    reset: (reportId: string) => `pdf-reports/v1/weather/report/${reportId}/reset`,
  },
  downloadOutcomeDocuments: (leadId: string) => `lead/v1/${leadId}/outcome/documents/download`,
  portalJobBuilder: {
    get: (leadId: string) => `lead/v1/${leadId}/portal-job-builder`,
    upsert: (leadId: string) => `lead/v1/${leadId}/portal-job-builder/upsert`,
  },
  salesDeals: 'demo/v1/leads/sales',
  salesDealById: (id: string) => `demo/v1/leads/sales/${id}`,
  leadDetailsById: (id: string) => `lead/v1/details/${id}`,
  jobBuilderDraft: {
    create: (leadId: string) => `lead/v1/${leadId}/job-builder-draft`,
    submit: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/submit`,
    list: (leadId: string) => `lead/v1/${leadId}/job-builder-drafts`,
    summary: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/public`,
    resend: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/resend`,
    pending: (leadId: string) => `lead/v1/${leadId}/pending-addendums`,
    cancel: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/cancel`,
    contact: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/contact`,
  },
};

export const sanitizeCalculatorPayload = (payload: any): any => {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map(sanitizeCalculatorPayload);
  }
  const sanitized = { ...payload };
  const stringKeys = ['title', 'name', 'paymentMethod', 'paymentMethodLabel', 'paymentPlan', 'originalCalculatorId', 'status', 'action', 'sendMode', 'recipient', 'subject',
    'unit', 'label', 'productName', 'sectionId', 'categoryId', 'fieldId', 'schemaSnapshotId', 'leadId', 'enteredBy', 'enteredAt',
    'pricemarkup', 'reason', 'explain', 'demoReason', 'reasonExplanation',
    'priceScopeSig',
    'runId', 'originalUrl', 'generatedUrl', 's3UrlOriginal', 's3UrlGenerated', 's3url',
    'bucketName', 'viewLabel', 'viewType', 'category', 'subcategory', 'mode', 'planKey'];
  Object.keys(sanitized).forEach((key) => {
    const val = sanitized[key];
    if (val === '' && !stringKeys.includes(key)) {
      sanitized[key] = 0;
    } else if (val && typeof val === 'object') {
      sanitized[key] = sanitizeCalculatorPayload(val);
    }
  });
  return sanitized;
};

export const LeadService = {
  createLead: (data: any): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.create, data),
  getSalesLeads: (repId: string, params?: any): Promise<AxiosResponse<any>> => {
    const query = new URLSearchParams({ repId, ...params }).toString();
    return api.get(`${LeadEndpoints.salesPortal}?${query}`);
  },

  getSalesPortalLeadById: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.salesPortalDetail(leadId)),
  getRehashLeads: (
    params?: {
      page?: number;
      limit?: number;
      date?: string;
      timeSlot?: string;
      office?: string;
      status?: string;
    },
    companyId?: string
  ): Promise<AxiosResponse<any>> => {
    const search = new URLSearchParams();
    search.set('page', String(params?.page ?? 1));
    search.set('limit', String(params?.limit ?? 200));
    if (params?.date) search.set('date', params.date);
    if (params?.timeSlot) search.set('timeSlot', params.timeSlot);
    if (params?.office) search.set('office', params.office);
    if (params?.status) search.set('status', params.status);

    return api.get(
      `${LeadEndpoints.rehashLeads}?${search.toString()}`,
      companyId ? { headers: { companyId } } : undefined
    );
  },
  workLead: (leadId: string, userId: string): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.work(leadId), { userId, workStartedBy: userId }),
  endWorkLead: (leadId: string): Promise<AxiosResponse<any> | void> =>
    hasSession()
      ? api.put(LeadEndpoints.work(leadId), { workStartedBy: null })
      : Promise.resolve(),
  getLeadOutcomeByCalculator: (leadId: string, calculatorId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcomeByCalculator(leadId, calculatorId)),
  downloadOutcomeDocuments: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.downloadOutcomeDocuments(leadId)),
  submitJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), payload),
  updateJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), payload),
  updateLeadOutcomeByCalculator: (leadId: string, calculatorId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.outcomeByCalculator(leadId, calculatorId), payload),

  /**
   * IMPORTANT: `idempotencyKey` is what stops a timed-out retry becoming a duplicate photo. See
   * `utils/upload-idempotency.ts`. The long timeout matters too: the global 15 s is a JSON
   * timeout, and a 2-5 MB photo on a weak cell exceeds it while the server stores it fine.
   */
  uploadImages: (
    leadId: string,
    formData: FormData,
    idempotencyKey?: string | null
  ): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.images(leadId), formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(idempotencyKey ? { [IDEMPOTENCY_HEADER]: idempotencyKey } : {}),
      },
      timeout: PHOTO_UPLOAD_TIMEOUT_MS,
    }),
  deleteImage: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.delete(LeadEndpoints.images(leadId), { data: payload }),
  updateImagePosition: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.updateImagePosition(leadId), payload),
  deleteOutcomeDocument: (documentId: string): Promise<AxiosResponse<any>> =>
    api.delete(LeadEndpoints.outcomeDocument(documentId)),
  resetLead: (leadId: string): Promise<AxiosResponse<any>> => api.put(LeadEndpoints.reset(leadId)),
  getAdditionalSlots: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.additionalSlots(leadId)),
  saveAdditionalSlots: (leadId: string, slots: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.additionalSlots(leadId), slots),
  uploadPaperConsent: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('api/v1/consent-form/upload', payload),
  submitRoofWaiver: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(`/lead/v1/${leadId}/mobile/waiver-form`, payload, { timeout: 60000 }),
  uploadGeneratedReport: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/generated-reports/v1', payload, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  logReportGeneration: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/job/v1/generate-report-logs', payload),
  generateRevRender: (payload: any): Promise<AxiosResponse<any>> => {
    const body = payload && payload.payloads
      ? payload
      : {
          payloads: [payload],
          leadId: payload?.leadId,
          jobId: payload?.leadId || payload?.jobId,
        };
    return api.post('/rev-render/v1/batches', body, { timeout: 120000 });
  },
  getRevRenderRuns: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(`/rev-render/v1/runs?leadId=${leadId}`),
  getRevRenderBatchStatus: (batchId: string): Promise<AxiosResponse<any>> =>
    api.get(`/rev-render/v1/batches/${batchId}`),

  shareRevRenders: (payload: {
    leadId?: string;
    runIds: string[];
    channel: 'sms' | 'email';
    recipientName?: string;
    recipientPhone?: string;
    recipientEmail?: string;
  }): Promise<AxiosResponse<any>> => api.post('/rev-render/v1/shares', payload),

  getRevRenderPreferences: (): Promise<AxiosResponse<any>> =>
    api.get('/rev-render/v1/preferences'),

  toggleRevRenderFavourite: (lookId: string): Promise<AxiosResponse<any>> =>
    api.post('/rev-render/v1/preferences/favourites/toggle', { lookId }),

  setRevRenderFavourites: (favouriteLookIds: string[]): Promise<AxiosResponse<any>> =>
    api.put('/rev-render/v1/preferences/favourites', { favouriteLookIds }),

  getRevRenderLooks: (version?: string): Promise<AxiosResponse<any>> =>
    api.get('/rev-render/v1/looks', {
      params: version ? { version } : undefined,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
    }),

  saveRevRenderCustomLook: (look: {
    lookId?: string;
    name: string;
    colors: string[];
  }): Promise<AxiosResponse<any>> =>
    api.post('/rev-render/v1/preferences/custom-looks', look),

  deleteRevRenderCustomLook: (lookId: string): Promise<AxiosResponse<any>> =>
    api.delete(`/rev-render/v1/preferences/custom-looks/${lookId}`),

  dismissRevRenderGuidance: (key: 'core' | 'lighting'): Promise<AxiosResponse<any>> =>
    api.post('/rev-render/v1/preferences/guidance/dismiss', { key }),

  revokeRevRenderShare: (shareId: string): Promise<AxiosResponse<any>> =>
    api.post(`/rev-render/v1/shares/${shareId}/revoke`, {}),
  createAppointment: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/appointments', payload),
  getAppointmentsByDate: (date: string): Promise<AxiosResponse<any>> =>
    api.get(`/appointments/${date}`),
  getAppointments: (params?: any): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.appointments, { params }),
  updateAppointment: (id: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(`/appointments/${id}`, payload),
  deleteAppointment: (id: string): Promise<AxiosResponse<any>> =>
    api.delete(`/appointments/${id}`),
  getCalculators: (appointmentId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.calculators(appointmentId)),
  getCalculator: (id: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.updateCalculator(id)),
  createCalculator: (appointmentId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.calculators(appointmentId), sanitizeCalculatorPayload(payload)),
  updateCalculator: (id: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.updateCalculator(id), sanitizeCalculatorPayload(payload)),

  toggleFavourite: (leadId: string, isFavorite: boolean): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.favourite, { jobId: leadId, favorite: isFavorite }),
  archiveLead: (id: string, isArchive: boolean): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.archive(id), { isArchive }),
  deleteLead: (id: string): Promise<AxiosResponse<any>> => api.delete(LeadEndpoints.delete(id)),
  saveLeadFilters: (leadId: string, payload: { savedFilters: any }): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.saveFilters(leadId), payload),
  getSecureUrls: (
    filePaths: { bucketName: string; filePath: string }[]
  ): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.secureUrls, { filePaths }),

  getPortalJobBuilder: async (
    leadId: string
  ): Promise<{ portalJobBuilder: any; documents: any; source: 'portal' | 'jobBuilder' | null } | null> => {
    try {
      const res = await api.get<any>(LeadEndpoints.portalJobBuilder.get(leadId));
      const payload = res.data?.data;
      if (!payload) return null;

      const record = payload.portalJobBuilder || payload;
      const documents = payload.documents || record.documents || null;

      let source: 'portal' | 'jobBuilder' | null =
        payload._productSource || record._productSource || null;
      if (!source) {
        source = record.jobBuilderId ? 'portal' : 'jobBuilder';
      }

      return { portalJobBuilder: record, documents, source };
    } catch (err) {
      console.warn('[LeadService] getPortalJobBuilder failed:', err);
      return null;
    }
  },
  upsertPortalJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.portalJobBuilder.upsert(leadId), payload),

  getSalesDeals: (params: { page?: number; limit?: number; scheduleFilter?: string | null }): Promise<AxiosResponse<any>> => {
    const q: Record<string, string> = {
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 12),
    };
    if (params.scheduleFilter) q.scheduleFilter = params.scheduleFilter;
    return api.get(`${LeadEndpoints.salesDeals}?${new URLSearchParams(q).toString()}`);
  },
  getSalesDealById: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.salesDealById(leadId)),

  getLeadDetailsById: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.leadDetailsById(leadId)),

  submitJobBuilderDraft: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilderDraft.create(leadId), payload),
  sendDraftSubmitEmail: (draftId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.jobBuilderDraft.submit(draftId), payload),
  getJobBuilderDrafts: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.list(leadId)),
  resendJobBuilderDraft: (
    draftId: string,
    contact?: { customerPhone?: string; customerEmail?: string }
  ): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilderDraft.resend(draftId), contact),
  updateJobBuilderDraftContact: (
    draftId: string,
    payload: { customerPhone: string; customerEmail: string }
  ): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.jobBuilderDraft.contact(draftId), payload),
  cancelJobBuilderDraft: (draftId: string): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilderDraft.cancel(draftId)),
  getLeadPendingAddendums: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.pending(leadId)),
  getDraftSummary: (draftId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.summary(draftId)),
  getDraftAmendmentPdf: (draftId: string): Promise<AxiosResponse<any>> =>
    api.get(`/lead/v1/job-builder-draft/${draftId}/amendment-pdf`),
  cancelLead: (leadId: string, leadData: any = {}): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), {
      leadData: {
        oneLeg: leadData?.oneLeg ?? '',
        result: 'cancelled',
        reason: leadData?.reason ?? '',
        lastPriceQuoted: leadData?.lastPriceQuoted ?? '',
        originalContractPrice: leadData?.originalContractPrice ?? '',
        downPayment: leadData?.downPayment ?? '',
        paymentMethod: leadData?.paymentMethod ?? '',
        balancePaymentMethod: leadData?.balancePaymentMethod ?? '',
        balance: leadData?.balance ?? '',
        selectedCalculatorId: leadData?.selectedCalculatorId ?? null,
        selectedAppointmentId: leadData?.selectedAppointmentId ?? null,
      },
      jobState: {},
    }),
  logEvent: (action: string, payload: any): Promise<AxiosResponse<any> | void> =>
    api.post('lead/v1/event-logs', { action, ...payload }).catch(() => {
    }),
  logUserActivity: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/user-activity-log/v1/create', payload),
  updateLeadTimelineProgress: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(`lead/v1/${leadId}/timeline-progress`, payload),
  deleteCalculator: (id: string): Promise<AxiosResponse<any>> => api.delete(`lfcalculators/${id}`),

  reorderCalculators: (positions: Array<{ id: string; position: number }>): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.arrangeCalculators, positions),
  getProductImage: (productName: string, colorCode: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.productBuilder, {
      params: { productName, colorCode, matchType: 'like' },
    }),

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

  createReferral: (payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.referral.create, payload),

  updateReferral: (id: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.referral.update(id), payload),

  updateCustomer: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.customer.update(leadId), payload),

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

  sendAgreementRemote: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.sendRemote(leadId), payload),
  getAgreementRemoteStatus: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.agreement.remoteStatus(leadId)),
  getAgreementDeliveryPreference: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.agreement.deliveryPreference(leadId)),
  saveAgreementDeliveryPreference: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.agreement.deliveryPreference(leadId), payload),
  resendAgreementRemoteSigner: (agreementId: string, signerId: string): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.remoteSignerResend(agreementId, signerId)),
  updateAgreementRemoteSigner: (
    agreementId: string,
    signerId: string,
    payload: { phone?: string; email?: string }
  ): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.agreement.remoteSigner(agreementId, signerId), payload),
  cancelAgreementRemote: (agreementId: string): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.remoteCancel(agreementId)),
  generateWeatherReport: (leadId: string, pastYears: number): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.weather.generate(leadId), { pastYears }),
  getJobStatus: (jobId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.weather.status(jobId)),
  getRiskDownloadUrl: (jobId: string) => `${ENV.API_URL}/${LeadEndpoints.weather.download(jobId)}`,
  resetWeatherReport: (reportId: string): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.weather.reset(reportId)),

  upsertLeadDraft: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.leadDraft.upsert(leadId), payload),
  updateLeadDraft: (draftId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.leadDraft.update(draftId), payload),
  getLeadDraft: (leadId: string, companyId?: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.leadDraft.get(leadId), companyId ? { headers: { companyId } } : undefined),

  deleteRevRenderRun: (runId: string, payload?: { reason: string }): Promise<AxiosResponse<any>> =>
    api.delete(`/rev-render/v1/runs/${runId}`, { data: payload }),

  updateCalculatorsSetting: (payload: any): Promise<AxiosResponse<any>> =>
    api.put('company/user/update-default-lf-calculator-settings', payload),

  sendSms: (payload: { body: string; to: string; leadId: string }): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.comms.sms, payload),
  sendEmail: (payload: {
    body: string;
    is_html?: boolean;
    subject: string;
    to: string;
    leadId: string;
  }): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.comms.email, payload),
};
