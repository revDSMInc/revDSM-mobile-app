import api from './index';
import { AxiosResponse } from 'axios';
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
  outcomeByCalculator: (leadId: string, calculatorId: string) => `lead/v1/${leadId}/outcome/${calculatorId}`,
  appointments: 'appointments',
  calculators: (appointmentId: string) => `appointments/${appointmentId}/lfcalculators`,
  updateCalculator: (id: string) => `lfcalculators/${id}`,
  arrangeCalculators: 'lfcalculators/positions',
  favourite: 'job/v1/favorite',
  archive: (id: string) => `lead/v1/archive/${id}`,
  delete: (id: string) => `lead/v1/delete/${id}`,
  // Production documentation additions
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
  // Portal Job Builder (deal editing) — mirrors web `endpoints.portalJobBuilder.*`.
  // Server returns the PortalJobBuilder when present, else falls back to the sales
  // JobBuilder record. `upsert` is the save target for the dynamic edit flow.
  portalJobBuilder: {
    get: (leadId: string) => `lead/v1/${leadId}/portal-job-builder`,
    upsert: (leadId: string) => `lead/v1/${leadId}/portal-job-builder/upsert`,
  },
  // My Deals list + deal detail (web parity: MyDealsView `/demo/v1/leads/sales`,
  // DealDetailsView `/demo/v1/leads/sales/:id`). Distinct from `salesPortal`
  // (`sales-portal`) which feeds the issued/self-gen leads panel.
  salesDeals: 'demo/v1/leads/sales',
  salesDealById: (id: string) => `demo/v1/leads/sales/${id}`,
  // Addendum drafts — the DYNAMIC deal-edit wizard submits here (NOT the
  // /job-builder POST). Mirrors web `submitJobBuilderDraft`/`sendDraftSubmitEmail`
  // + the DealDetailsView drafts list/summary.
  jobBuilderDraft: {
    create: (leadId: string) => `lead/v1/${leadId}/job-builder-draft`,
    submit: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/submit`,
    list: (leadId: string) => `lead/v1/${leadId}/job-builder-drafts`,
    summary: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/public`,
  },
};

export const sanitizeCalculatorPayload = (payload: any): any => {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map(sanitizeCalculatorPayload);
  }
  const sanitized = { ...payload };
  const stringKeys = ['title', 'name', 'paymentMethod', 'paymentMethodLabel', 'paymentPlan', 'originalCalculatorId', 'status', 'action', 'sendMode', 'recipient', 'subject',
    // Calculator-entry descriptor fields are strings — an empty one must stay ''
    // (web sends e.g. `unit: ""`, `productName: ""`), never be coerced to 0.
    'unit', 'label', 'productName', 'sectionId', 'categoryId', 'fieldId', 'schemaSnapshotId', 'leadId', 'enteredBy', 'enteredAt',
    // `pricemarkup` is a markup LABEL string (e.g. "RETAIL + 5%"), and reason/explain
    // are free text — coercing an empty one to 0 would corrupt the value.
    'pricemarkup', 'reason', 'explain', 'demoReason', 'reasonExplanation'];
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
  workLead: (leadId: string, userId: string): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.work(leadId), { userId, workStartedBy: userId }),
  endWorkLead: (leadId: string): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.work(leadId), { workStartedBy: null }),
  getJobBuilder: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcome(leadId)),
  getLeadOutcome: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcome(leadId)),
  getLeadOutcomeByCalculator: (leadId: string, calculatorId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.outcomeByCalculator(leadId, calculatorId)),
  downloadOutcomeDocuments: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.downloadOutcomeDocuments(leadId)),
  submitJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), payload),
  updateJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.jobBuilder(leadId), payload),
  updateLeadOutcome: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.outcome(leadId), payload),
  updateLeadOutcomeByCalculator: (leadId: string, calculatorId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.outcomeByCalculator(leadId, calculatorId), payload),

  uploadImages: (leadId: string, formData: FormData): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.images(leadId), formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
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
  createAppointment: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/appointments', payload),
  getAppointmentsByDate: (date: string): Promise<AxiosResponse<any>> =>
    api.get(`/appointments/${date}`),
  getAppointments: (params?: any): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.appointments, { params }),
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
  getSecureUrls: (
    filePaths: { bucketName: string; filePath: string }[]
  ): Promise<AxiosResponse<any>> => api.post(LeadEndpoints.secureUrls, { filePaths }),

  // --- Portal Job Builder (deal editing) --------------------------------------
  // Faithful port of web `src/api/portal-job-builder.js`. `getPortalJobBuilder`
  // normalizes the response into { portalJobBuilder, documents, source } so the
  // enrich util can decide dynamic-vs-static exactly as web does. Returns null on
  // any error / empty payload (a lead simply may not have a portal record yet).
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
  // Create/update the PortalJobBuilder for a lead. `status:'draft'` on auto-save,
  // `status:'submitted'` on complete. This is the ONLY write the dynamic edit flow
  // makes — editing does NOT re-run the /job-builder POST (web parity).
  upsertPortalJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.portalJobBuilder.upsert(leadId), payload),

  // --- My Deals list + Deal Detail (web parity) -------------------------------
  // Paginated resulted-deals list. `scheduleFilter` = 'scheduled' | 'TBD' | omitted
  // (All). Mirrors web MyDealsView `/demo/v1/leads/sales?page&limit&scheduleFilter`.
  getSalesDeals: (params: { page?: number; limit?: number; scheduleFilter?: string | null }): Promise<AxiosResponse<any>> => {
    const q: Record<string, string> = {
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 12),
    };
    if (params.scheduleFilter) q.scheduleFilter = params.scheduleFilter;
    return api.get(`${LeadEndpoints.salesDeals}?${new URLSearchParams(q).toString()}`);
  },
  // Single deal for the Deal Detail screen (web DealDetailsView load).
  getSalesDealById: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.salesDealById(leadId)),

  // --- Dynamic deal-edit addendum draft (web parity) --------------------------
  // Final submit of the 4-step edit wizard. Creates a pending-signature addendum
  // draft; editing does NOT re-run the /job-builder POST or upsert the portal
  // record. Mirrors web `submitJobBuilderDraft`.
  submitJobBuilderDraft: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilderDraft.create(leadId), payload),
  // SMS/email the customer the addendum link after the draft is created.
  sendDraftSubmitEmail: (draftId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.jobBuilderDraft.submit(draftId), payload),
  // Addendum drafts list + a single draft's public summary (Deal Detail addendums).
  getJobBuilderDrafts: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.list(leadId)),
  getDraftSummary: (draftId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.summary(draftId)),
  // "Cancel Job" from the wizard's Install Date step. Marks the lead cancelled via
  // the job-builder endpoint (web `cancelLead`), NOT a delete/archive.
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
      // Fail silently as logging is a non-critical background task
    }),
  logUserActivity: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/user-activity-log/v1/create', payload),
  updateLeadTimelineProgress: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.patch(`lead/v1/${leadId}/timeline-progress`, payload),
  deleteCalculator: (id: string): Promise<AxiosResponse<any>> => api.delete(`lfcalculators/${id}`),

  /**
   * Persist calculator tab order. Web parity (`updateLfCalculatorPositions` →
   * `PUT /lfcalculators/positions`) — mobile previously reordered only in local
   * state, so a reload lost the order.
   */
  reorderCalculators: (positions: Array<{ id: string; position: number }>): Promise<AxiosResponse<any>> =>
    api.put(LeadEndpoints.arrangeCalculators, positions),
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
  generateWeatherReport: (leadId: string, pastYears: number): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.weather.generate(leadId), { pastYears }),
  getJobStatus: (jobId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.weather.status(jobId)),
  getRiskDownloadUrl: (jobId: string) => `${ENV.API_URL}/${LeadEndpoints.weather.download(jobId)}`,
  resetWeatherReport: (reportId: string): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.weather.reset(reportId)),

  // Lead Draft (contract amendments)
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

  // Comms (SMS / Email)
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
