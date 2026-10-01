import api, { hasSession } from './index';
import { AxiosResponse } from 'axios';
import { ENV } from '../../config/env';

/**
 * The calculator id an outcome read/write should be scoped to.
 *
 * The outcome endpoints are calculator-scoped (`/lead/v1/{leadId}/outcome/{calcId}`)
 * since the bare lead-scoped variant was deprecated, but a lead exposes its
 * calculator under several shapes depending on where it was loaded from — the
 * sales-portal list, an outcome document, or an in-memory result payload. Check
 * them all, in the order the Lead Center already used.
 *
 * Returns `null` when the lead carries no calculator at all; callers must skip the
 * request in that case rather than falling back to the removed endpoint.
 */
export const resolveLeadCalculatorId = (lead: any): string | null =>
  lead?.selectedCalculatorId ||
  lead?.calculatorId ||
  lead?.jobBuilder?.calculatorId ||
  lead?.outcome?.selectedCalculatorId ||
  lead?.leadData?.selectedCalculatorId ||
  lead?.LFCalculator?._id ||
  null;

/**
 * Lead Management Endpoints
 */
export const LeadEndpoints = {
  create: 'lead/v1/create',
  salesPortal: 'demo/v1/leads/sales-portal',
  // One FULL lead by Mongo `_id` (SALES-PORTAL-API-OPTIMIZATION.md §2). Returns the
  // same object one row of the un-slimmed list carries, wrapped as `data.lead`.
  //
  // ⚠️ This is the ONLY way to fetch a single lead now. `?leadId=` on the list above is
  // explicitly IGNORED by the server — it returns the whole list regardless — so the
  // old "fetch the list and `.find()` the lead" pattern both downloads everything and
  // no longer means what it reads like.
  salesPortalDetail: (leadId: string) => `demo/v1/leads/sales-portal/${leadId}`,
  // Rehashed leads for the signed-in rep. A DIFFERENT service prefix to everything
  // else in this file (`rehash/` not `lead/`), and the rep is taken from the JWT —
  // there is no repId parameter, unlike `salesPortal`. Web ref:
  // `endpoints.rehash.leads` in `src/utils/axios.js`.
  rehashLeads: 'rehash/rep/v1/leads',
  work: (leadId: string) => `lead/v1/${leadId}/work`,
  jobBuilder: (leadId: string) => `lead/v1/${leadId}/job-builder`,
  // ⚠️ REMOVED (2026-08-12): the bare lead-scoped `lead/v1/{leadId}/outcome`.
  // It is DEPRECATED on the backend — replaced by the calculator-scoped
  // `outcomeByCalculator` below — and on device it returns **404**, so every call
  // cost a wasted round trip and returned nothing. Web no longer calls it either
  // (its submit PUTs to `/outcome/{calculatorId}`).
  //
  // Do NOT reintroduce it. If you need a lead's outcome, resolve the calculator id
  // with `resolveLeadCalculatorId(lead)` and use `outcomeByCalculator`; if you need
  // the lead's DOCUMENTS, use `downloadOutcomeDocuments` — that one is
  // lead-scoped and still supported (web uses it).
  outcomeByCalculator: (leadId: string, calculatorId: string) => `lead/v1/${leadId}/outcome/${calculatorId}`,
  appointments: 'appointments',
  calculators: (appointmentId: string) => `appointments/${appointmentId}/lfcalculators`,
  updateCalculator: (id: string) => `lfcalculators/${id}`,
  arrangeCalculators: 'lfcalculators/positions',
  favourite: 'job/v1/favorite',
  archive: (id: string) => `lead/v1/archive/${id}`,
  delete: (id: string) => `lead/v1/delete/${id}`,
  // Persist the map filters a rep applied against a lead (web parity:
  // `endpoints.leads.saveFilters`), so they re-hydrate next visit.
  saveFilters: (leadId: string) => `lead/v1/${leadId}/saved-filters`,
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
    // Remote signing (homeowner e-signs on their own phone). Paths match the shipped
    // backend (REVDSM-263). The homeowner signs on the WEB signing page; mobile
    // creates the session, polls status, and manages resend / edit-contact / cancel.
    sendRemote: (leadId: string) => `pdf-reports/v1/agreement/${leadId}/send-remote`,
    remoteStatus: (leadId: string) => `pdf-reports/v1/agreement/${leadId}/remote-status`,
    // Per-signer rep actions are keyed by AGREEMENT id + SIGNER id (not leadId).
    remoteSignerResend: (agreementId: string, signerId: string) =>
      `pdf-reports/v1/agreement/remote/${agreementId}/signer/${signerId}/resend`,
    remoteSigner: (agreementId: string, signerId: string) =>
      `pdf-reports/v1/agreement/remote/${agreementId}/signer/${signerId}`,
    remoteCancel: (agreementId: string) => `pdf-reports/v1/agreement/remote/${agreementId}/cancel`,
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
  /**
   * A single lead by id, for opening one from a NOTIFICATION.
   *
   * ⚠️ Deliberately NOT `salesDealById` (`demo/v1/leads/sales/{id}`). A push
   * carries only a lead id and the rep may be opening a lead that is not a sales
   * deal at all — issued, cancelled, or one whose addendum was just signed. This
   * is the route to use for any notification-driven navigation.
   */
  leadDetailsById: (id: string) => `lead/v1/details/${id}`,
  // Addendum drafts — the DYNAMIC deal-edit wizard submits here (NOT the
  // /job-builder POST). Mirrors web `submitJobBuilderDraft`/`sendDraftSubmitEmail`
  // + the DealDetailsView drafts list/summary.
  jobBuilderDraft: {
    create: (leadId: string) => `lead/v1/${leadId}/job-builder-draft`,
    submit: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/submit`,
    list: (leadId: string) => `lead/v1/${leadId}/job-builder-drafts`,
    summary: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/public`,
    // Rep actions on a draft that is already out for signature, from the Contract
    // Details "PENDING ADDENDUM" card. `resend` re-notifies the customer at whatever
    // contact their CUSTOMER record now holds (so "Edit Phone"/"Edit Email" update the
    // customer first, then the rep resends); `cancel` voids the outstanding addendum.
    resend: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/resend`,
    // The banner's own source of truth: the pending drafts PLUS the lead-level
    // customer contact a resend would use. The lead payload carries a pending COUNT
    // but no draft ids, so this is the only place those come from.
    pending: (leadId: string) => `lead/v1/${leadId}/pending-addendums`,
    cancel: (draftId: string) => `lead/v1/job-builder-draft/${draftId}/cancel`,
    // Correct WHO one outstanding addendum goes to. Per DRAFT, not per customer — an
    // addendum may deliberately have been sent somewhere other than the customer
    // record, and this edits that address without touching the record.
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
    // Calculator-entry descriptor fields are strings — an empty one must stay ''
    // (web sends e.g. `unit: ""`, `productName: ""`), never be coerced to 0.
    'unit', 'label', 'productName', 'sectionId', 'categoryId', 'fieldId', 'schemaSnapshotId', 'leadId', 'enteredBy', 'enteredAt',
    // `pricemarkup` is a markup LABEL string (e.g. "RETAIL + 5%"), and reason/explain
    // are free text — coercing an empty one to 0 would corrupt the value.
    'pricemarkup', 'reason', 'explain', 'demoReason', 'reasonExplanation',
    // `priceScopeSig` is the job-scope fingerprint string the end price was priced
    // against — an empty one (no price entered) must stay '' not 0.
    'priceScopeSig',
    // `selectedRenders[]` descriptor fields (RevRender pairs) and the
    // `oneYearMonthlyPlan` selection are string-valued — keep empty ones '' rather
    // than coercing to 0 (a `mode: 0` or `viewLabel: 0` would break the read side).
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
  /**
   * The rep's lead list (Issued / Self-Gen / Archived tabs).
   *
   * Pass `view: 'summary'` in `params` to get the SLIM rows
   * (SALES-PORTAL-API-OPTIMIZATION.md) — card fields only, with ~15 join collections
   * skipped server-side. That is what the list screen should use; see `useLeadsData`.
   *
   * ⚠️ A summary row carries `salesPhotos: []` and no `jobBuilder`, and it is NOT a
   * usable lead on its own. Anything that opens a lead must hydrate it through
   * `getSalesPortalLeadById` first — see the note there.
   *
   * ⚠️ Omitting `view` keeps the OLD full response verbatim (portal / legacy parity),
   * so this stays backwards compatible for any caller that genuinely needs fat rows.
   */
  getSalesLeads: (repId: string, params?: any): Promise<AxiosResponse<any>> => {
    const query = new URLSearchParams({ repId, ...params }).toString();
    return api.get(`${LeadEndpoints.salesPortal}?${query}`);
  },

  /**
   * ONE fully-hydrated lead by Mongo `_id` (SALES-PORTAL-API-OPTIMIZATION.md §2).
   *
   * This is the companion to `view=summary`: the list is slim, so every screen that
   * needs photos / jobBuilder / contract data reads them from here instead. Web does
   * the same (`getSalesPortalLeadById`, used by the capture view, pitch book,
   * rev-render and the deal-center tabs).
   *
   * ⚠️ The path takes the Mongo `_id`, NOT the display `leadId` — which is frequently
   * the literal string `"N/A"` on a self-gen lead and would 404.
   *
   * 404 when the lead isn't the caller's (the server requires `assignedRepId` /
   * `assignedShadowRepId` to match), so callers must tolerate a miss rather than treat
   * it as fatal.
   */
  getSalesPortalLeadById: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.salesPortalDetail(leadId)),
  /**
   * Rehashed leads for the signed-in rep — web parity with `useGetRehashLeads`
   * (`src/api/leads.js`).
   *
   * `page`/`limit` are sent on EVERY request, defaulted the way web defaults them, so
   * the server never has to fall back to its own page size. The remaining filters are
   * omitted when unset rather than sent empty: `?date=` is a filter for the empty
   * string, not the absence of one.
   *
   * `companyId` travels as a HEADER, not a query param — the same convention
   * `getLeadDraft` uses.
   */
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
  /**
   * Closes the lead's work session. Skipped with no token for the same reason as
   * `InstallerService.endWork`: this fires from an unmount cleanup, and logging out is
   * one of the ways the screen unmounts — the request would go out bare and 401.
   */
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
  // ⚠️ `/job-builder` is a POST-only route on the backend — there is no PUT
  // handler (confirmed by backend, 2026-09-28: a PUT here 404s, e.g. from the
  // Result Lead sheet's auto-field logging). Upserts by lead id, so POST also
  // covers the "update" case; kept as a separate function for callers that
  // mean update semantically.
  updateJobBuilder: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilder(leadId), payload),
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

  /**
   * Send renders to a homeowner by text or email (REVUIUX-483).
   *
   * Returns 200 with `sent: false` and a `deliveryError` when the link was
   * created but delivery failed — the share exists and the link works, so offer
   * retry or copy rather than treating it as a total failure.
   */
  shareRevRenders: (payload: {
    leadId?: string;
    runIds: string[];
    channel: 'sms' | 'email';
    recipientName?: string;
    recipientPhone?: string;
    recipientEmail?: string;
  }): Promise<AxiosResponse<any>> => api.post('/rev-render/v1/shares', payload),

  /**
   * Favourites / recents for the signed-in rep (483 §3, §7).
   *
   * Per REP ACCOUNT, not per device — a rep who changes phone keeps their work.
   * Returns `favouriteLookIds`, `recentLookIds`, `customLooks` and
   * `guidanceDismissed`; ⚠️ the last two are ALWAYS EMPTY today — the fields
   * exist but nothing writes to them, so do not treat an empty array as
   * "the rep has none" and overwrite local data with it.
   */
  getRevRenderPreferences: (): Promise<AxiosResponse<any>> =>
    api.get('/rev-render/v1/preferences'),

  /**
   * Toggle one favourite and get the whole new list back.
   *
   * ⚠️ A TOGGLE, deliberately — not a whole-list write. If two devices each
   * sent their full list the later one would silently wipe the other's change.
   * Use `setRevRenderFavourites` only to reconcile offline edits.
   */
  toggleRevRenderFavourite: (lookId: string): Promise<AxiosResponse<any>> =>
    api.post('/rev-render/v1/preferences/favourites/toggle', { lookId }),

  /** Replace the whole favourites list. Offline reconciliation only — see above. */
  setRevRenderFavourites: (favouriteLookIds: string[]): Promise<AxiosResponse<any>> =>
    api.put('/rev-render/v1/preferences/favourites', { favouriteLookIds }),

  /** Stop a share link working before it expires. */
  revokeRevRenderShare: (shareId: string): Promise<AxiosResponse<any>> =>
    api.post(`/rev-render/v1/shares/${shareId}/revoke`, {}),
  createAppointment: (payload: any): Promise<AxiosResponse<any>> =>
    api.post('/appointments', payload),
  getAppointmentsByDate: (date: string): Promise<AxiosResponse<any>> =>
    api.get(`/appointments/${date}`),
  getAppointments: (params?: any): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.appointments, { params }),
  // Standalone appointment management (web parity: `src/api/appointments.js`).
  // update → PUT /appointments/{id}, delete → DELETE /appointments/{id}.
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
  // Save (or clear, with `{ savedFilters: {} }`) the map filters a rep applied
  // against a lead. Body mirrors web's `saveLeadFilters` — `{ savedFilters: {...} }`.
  saveLeadFilters: (leadId: string, payload: { savedFilters: any }): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.saveFilters(leadId), payload),
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

  /**
   * Resolve a lead for NOTIFICATION deep-linking.
   *
   * ⚠️ Kept separate from `getSalesDealById` on purpose — that one has four other
   * callers (Deal Detail, Pitch Book, Roofline Deck) which are all sales-deal
   * surfaces and must keep their existing route. Repointing the shared method
   * would change those three flows as a side effect of a notification fix.
   */
  getLeadDetailsById: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.leadDetailsById(leadId)),

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
  // Re-send ONE draft's signature request. A single call covers BOTH channels — SMS
  // and email go out together, so whichever address works gets through.
  //
  // `contact` is `{ customerPhone, customerEmail? }`. Omitting a field keeps whatever
  // the draft already holds, so `customerEmail` is left OFF (not sent as '') when the
  // customer has no email — sending a blank would overwrite a good stored address.
  //
  // Responds with `{ notifications: { sms, email } }`; anything other than 'sent' is a
  // partial failure the caller must surface (see `describeResendResult`).
  resendJobBuilderDraft: (
    draftId: string,
    contact?: { customerPhone?: string; customerEmail?: string }
  ): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilderDraft.resend(draftId), contact),
  // Update the contact ONE outstanding addendum is addressed to.
  //
  // ⚠️ Sends BOTH fields — `{ customerPhone, customerEmail }` — not just the edited
  // one, unlike the customer PATCH. The phone goes out E.164 (`+15551234567`).
  //
  // ⚠️ This writes to the DRAFT, which is exactly where the card reads the contact
  // from (`customerPhone`/`customerEmail` on the drafts row), so an edit is visible
  // on the next refetch. It deliberately does NOT touch the customer record.
  updateJobBuilderDraftContact: (
    draftId: string,
    payload: { customerPhone: string; customerEmail: string }
  ): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.jobBuilderDraft.contact(draftId), payload),
  // Void an addendum that is still awaiting signature. The customer's review link
  // stops working once the draft flips to `cancelled`.
  //
  // ⚠️ NO BODY — the draft id in the path is the entire request. Do not add one.
  //
  // Web additionally decrements the lead's local `pendingAddendumCount` on success.
  // Mobile has no such field: every pending count here is derived from the drafts
  // list itself (`pendingRecipientRows` / `hasPendingDraft`), so re-reading that list
  // IS the update — which is what web's banner does separately anyway.
  cancelJobBuilderDraft: (draftId: string): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.jobBuilderDraft.cancel(draftId)),
  // Pending addendums for a lead + the customer contact a resend would go to.
  // Read as `response.data.data`; every action on the card refetches it so the banner
  // shows the state a further resend would act on.
  getLeadPendingAddendums: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.pending(leadId)),
  getDraftSummary: (draftId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.jobBuilderDraft.summary(draftId)),
  // Signed addendum PDF (customer signature + the updated contract details). The
  // API builds it on demand once the customer APPROVES, so it 409s for a pending
  // draft. Web parity: `getDraftAmendmentPdf` → returns the secure URL to render.
  getDraftAmendmentPdf: (draftId: string): Promise<AxiosResponse<any>> =>
    api.get(`/lead/v1/job-builder-draft/${draftId}/amendment-pdf`),
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

  // --- Remote agreement signing (homeowner e-signs remotely, REVDSM-263) -------
  // The server contacts the primary buyer + EVERY co-buyer (each their own link),
  // and builds the final signed PDF only once every signer has signed.
  //
  // Send. payload `{ signers?: [{ coBuyerIndex, phone, email }] }` — signers is
  // OPTIONAL (omit → use the contact details on the lead); `coBuyerIndex: null`
  // is the primary buyer, `0,1,…` are co-buyers. Response `data`:
  // `{ agreementId, status, results: [{ signerId, delivered, channels }], signers }`.
  // 400 = a signer has no contact; 409 = an agreement is already out (cancel first);
  // 502 = nothing reached anybody.
  sendAgreementRemote: (leadId: string, payload: any): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.sendRemote(leadId), payload),
  // Poll while pending. Response `data`: `{ agreement: null }` (none yet) or
  // `{ agreement: { agreementId, status, showInitials, signedPdfUrl, signers: [
  //   { signerId, role, coBuyerIndex, name, phone, email, status, viewedAt,
  //     signedAt, sendCount, ... } ] } }`. There is no push — poll every 10–15s.
  getAgreementRemoteStatus: (leadId: string): Promise<AxiosResponse<any>> =>
    api.get(LeadEndpoints.agreement.remoteStatus(leadId)),
  // Resend a signer's link (rotates their token — the old link dies).
  resendAgreementRemoteSigner: (agreementId: string, signerId: string): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.remoteSignerResend(agreementId, signerId)),
  // Correct a signer's phone/email AND resend in one call (drives "Edit phone" /
  // "Edit email"). payload `{ phone?, email? }` — at least one required.
  updateAgreementRemoteSigner: (
    agreementId: string,
    signerId: string,
    payload: { phone?: string; email?: string }
  ): Promise<AxiosResponse<any>> =>
    api.patch(LeadEndpoints.agreement.remoteSigner(agreementId, signerId), payload),
  // Cancel the whole agreement (kills every outstanding link) — used to clear the
  // 409 that blocks a fresh send.
  cancelAgreementRemote: (agreementId: string): Promise<AxiosResponse<any>> =>
    api.post(LeadEndpoints.agreement.remoteCancel(agreementId)),
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
