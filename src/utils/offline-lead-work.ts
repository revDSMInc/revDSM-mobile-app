import {
  classifyCreateOutcome,
  hasServerUniqueKey,
  MAX_CREATE_ATTEMPTS,
  readCreatedLeadId,
  type CreateOutcome,
} from './offline-lead-queue';

import type { ConsentFormKind } from './consent-forms';

export type UploadStep =
  | 'lead'
  | 'appointment'
  | 'calculator'
  | 'calculatorState'
  | 'outcome'
  | 'documents'
  | 'remoteSignature'
  | 'funding'
  | 'addendumDraft'
  | 'addendumRefund'
  | 'addendumRelease'
  | 'fundingCollect'
  | 'fundingDecision'
  | 'fundingActivate'
  | 'fundingSubmit'
  | 'submit'
  | 'consent'
  | 'work'
  | 'workEnd'
  | 'chat'
  | 'customer'
  | 'archive'
  | 'delete';

export const UPLOAD_STEPS: readonly UploadStep[] = [
  'lead',
  'appointment',
  'calculator',
  'calculatorState',
  'outcome',
  'documents',
  'remoteSignature',
  'funding',
  'addendumDraft',
  'addendumRefund',
  'addendumRelease',
  'fundingCollect',
  'fundingDecision',
  'fundingActivate',
  'fundingSubmit',
  'submit',
  'consent',
  'work',
  'chat',
  'workEnd',
  'customer',
  'archive',
  'delete',
] as const;

export type ReplaySafety =
  | 'idempotent'
  | 'guarded'
  | 'unique-key'
  | 'manual';

export const stepReplaySafety = (step: UploadStep): ReplaySafety => {
  switch (step) {
    case 'calculatorState':
    case 'outcome':
    case 'funding':
      return 'idempotent';
    case 'chat':
      return 'idempotent';
    case 'work':
    case 'workEnd':
    case 'customer':
    case 'archive':
    case 'delete':
      return 'idempotent';
    case 'lead':
      return 'unique-key';
    case 'remoteSignature':
      return 'guarded';
    case 'consent':
      return 'guarded';
    case 'documents':
      return 'guarded';
    default:
      return 'guarded';
  }
};

export type WorkOrigin =
  | 'created-offline'
  | 'existing';

export type WorkStatus =
  | 'draft'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'needs-review';

export interface OfflineCalculatorWork {
  clientId: string;
  serverId?: string;
  payload: Record<string, unknown>;
}

export type OfflineDocumentCategory = 'agreement' | 'orderSheet';

export const documentRootKey = (category: OfflineDocumentCategory): 'agreements' | 'orderSheets' =>
  category === 'agreement' ? 'agreements' : 'orderSheets';

export interface OfflineJobDocument {
  clientId: string;
  category: OfflineDocumentCategory;
  name: string;
  uri: string;
  contentType: string;
  uploadedAt?: string;
}

export const offlineDocumentName = (
  category: OfflineDocumentCategory,
  extension: string,
  now: number = Date.now()
): string =>
  `${category === 'agreement' ? 'Agreement' : 'OrderSheet'}_offline_${now}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${extension}`;

export interface OfflineConsentForm {
  clientId: string;
  kind: ConsentFormKind;
  payload: Record<string, unknown>;
  signatureUri?: string;
  signatureName?: string;
  signatureType?: string;
  knownFiledBefore?: boolean;
  submittedAt?: string;
  pdfPath?: string;
  uploadedAt?: string;
}

export interface OfflineLeadWork {
  clientId: string;
  ownerId?: string;
  origin: WorkOrigin;
  status: WorkStatus;
  serverIds: {
    leadId?: string;
    appointmentId?: string;
    calculators: Record<string, string>;
  };
  lead?: Record<string, unknown>;
  appointment?: Record<string, unknown>;
  appointmentClientId?: string;
  calculators: OfflineCalculatorWork[];
  outcome?: Record<string, unknown>;
  outcomeCalculatorClientId?: string;
  documents?: OfflineJobDocument[];
  remoteSignature?: Record<string, unknown>;
  consents?: OfflineConsentForm[];
  archive?: { isArchive: boolean; lead?: Record<string, unknown> };
  deleteLead?: boolean;
  workStarted?: { userId: string; at: string };
  /** The rep left the lead. Releases `workStartedBy` once there is signal. */
  workEnded?: { at: string };
  customer?: { customerId: string; payload: Record<string, unknown> };
  funding?: Record<string, unknown>;
  /** The rep pressed Submit Funding offline; the save above has to land first. */
  fundingSubmitted?: { at: string };
  /**
   * A My Deals addendum raised offline: the full `submitJobBuilderDraft` payload.
   *
   * ⚠️ `hasRefund` decides whether the addendum may be RELEASED to the homeowner by this
   * device. A refund addendum is released server-side by the approver instead - see
   * `addendumRelease`.
   */
  addendum?: {
    payload: Record<string, unknown>;
    contact: { customerEmail?: string; customerPhone?: string };
    hasRefund: boolean;
    at: string;
  };
  /** Set by the `addendumDraft` step once the server has minted the draft. */
  addendumDraftId?: string;
  /**
   * The cheque refund that rides with this addendum.
   *
   * ⚠️ CHEQUE ONLY. A card refund reverses the charge through the processor and cannot be
   * queued; `addendumOfflineBlock` refuses to save one.
   */
  addendumRefund?: {
    pid: string;
    amount: number;
    reason: string;
    note?: string;
    assignedToUserId?: string;
  };
  /**
   * Check payments the rep took in hand offline, by `pid`.
   *
   * Safe to address by pid because the pid is minted on the DEVICE and sent in the save
   * above - the server keeps it, so no re-keying is needed here.
   */
  fundingCollected?: string[];
  /**
   * Lender answers the rep recorded offline, by `pid` (last write per pid wins).
   *
   * ⚠️ The drain sends the link first if the server has none: the decision endpoint answers 409
   * "Send the application link first" otherwise, and offline the link could not be created.
   */
  fundingDecisions?: { pid: string; decision: 'full' | 'short' | 'declined'; approvedAmt?: number }[];
  /** Loans the rep activated offline, by `pid`. Ordered after `fundingDecision`. */
  fundingActivated?: string[];
  submit?: Record<string, unknown>;
  chatCreated?: boolean;
  done: UploadStep[];
  label: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError?: string;
}

export const newWorkId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const isClientId = (id: unknown): boolean =>
  typeof id === 'string' && /^(lead|appt|calc|work)-\d{10,}-/.test(id);

export const createOfflineWork = (
  leadPayload: Record<string, unknown>,
  label: string,
  now: number = Date.now()
): OfflineLeadWork => ({
  clientId: newWorkId('work'),
  origin: 'created-offline',
  status: 'draft',
  serverIds: { calculators: {} },
  lead: leadPayload,
  calculators: [],
  done: [],
  label,
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  attempts: 0,
});

export const adoptExistingWork = (
  leadId: string,
  label: string,
  seed: Partial<Pick<OfflineLeadWork, 'appointment' | 'calculators' | 'outcome'>> = {},
  now: number = Date.now()
): OfflineLeadWork => ({
  clientId: newWorkId('work'),
  origin: 'existing',
  status: 'draft',
  serverIds: { leadId, calculators: {} },
  calculators: seed.calculators || [],
  appointment: seed.appointment,
  outcome: seed.outcome,
  done: ['lead'],
  label,
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  attempts: 0,
});

export const isStepApplicable = (work: OfflineLeadWork, step: UploadStep): boolean => {
  if (work.deleteLead && step !== 'delete') return false;
  switch (step) {
    case 'lead':
      return work.origin === 'created-offline' && !!work.lead;
    case 'appointment':
      return !work.serverIds.appointmentId && !!work.appointment;
    case 'calculator':
      return work.calculators.some((c) => !c.serverId && !work.serverIds.calculators[c.clientId]);
    case 'calculatorState':
      return work.calculators.length > 0;
    case 'outcome':
      return !!work.outcome;
    case 'documents':
      return !!work.documents?.some((d) => !d.uploadedAt);
    case 'remoteSignature':
      return !!work.remoteSignature;
    case 'funding':
      return !!work.funding;
    case 'addendumDraft':
      return !!work.addendum && !work.addendumDraftId;
    /**
     * ⚠️ NEVER applicable when the addendum carries a refund. The approver releases those
     * server-side; releasing here puts the paperwork in front of the homeowner before the
     * approval, and `refundMovesForDecision` then silently drops the signature - the money
     * never moves, with no error anywhere.
     */
    /** Needs the draft's real id, so it can only run once `addendumDraft` has landed. */
    case 'addendumRefund':
      return !!work.addendumRefund && !!work.addendumDraftId;
    case 'addendumRelease':
      return !!work.addendum && !work.addendum.hasRefund && !!work.addendumDraftId;
    case 'fundingCollect':
      return !!work.fundingCollected?.length && !!work.funding;
    case 'fundingDecision':
      return !!work.fundingDecisions?.length && !!work.funding;
    case 'fundingActivate':
      return !!work.fundingActivated?.length && !!work.funding;
    case 'fundingSubmit':
      return !!work.fundingSubmitted && !!work.funding;
    case 'submit':
      return !!work.submit;
    case 'consent':
      return !!work.consents?.some((c) => !c.uploadedAt);
    case 'work':
      return !!work.workStarted && !work.submit;
    case 'workEnd':
      return !!work.workEnded && !work.submit;
    case 'chat':
      return !!work.workStarted && !work.chatCreated;
    case 'customer':
      return !!work.customer?.customerId;
    case 'archive':
      return !!work.archive;
    case 'delete':
      return work.deleteLead === true;
    default:
      return false;
  }
};

export const isStepPending = (work: OfflineLeadWork, step: UploadStep): boolean =>
  !work.done.includes(step) && isStepApplicable(work, step);

/**
 * Is a check-in for this lead still waiting to reach the server?
 *
 * ⚠️ Matches on BOTH ids. A lead created offline is queued under a client id and keeps it
 * until the `lead` step drains, so a check-in made before the sync is filed under the client
 * id while the list now shows the server id. Matching only one of them makes the overlay
 * vanish the moment the lead syncs, which is the opposite error.
 */
export const hasPendingCheckIn = (
  all: OfflineLeadWork[] | null | undefined,
  leadId: unknown
): boolean => {
  const id = String(leadId ?? '').trim();
  if (!id) return false;
  return (all || []).some(
    (w) =>
      !!w &&
      (w.clientId === id || w.serverIds?.leadId === id) &&
      isStepPending(w, 'work')
  );
};

export const rearmStep = (work: OfflineLeadWork, step: UploadStep): OfflineLeadWork =>
  work.done.includes(step) ? { ...work, done: work.done.filter((s) => s !== step) } : work;

export const hasUnsyncedDealCenter = (work: OfflineLeadWork | null | undefined): boolean =>
  !!work && (isStepPending(work, 'calculator') || isStepPending(work, 'calculatorState'));

export const reopenIfPending = (work: OfflineLeadWork): OfflineLeadWork =>
  work.status === 'uploaded' && nextUploadStep(work) !== null
    ? { ...work, status: 'draft', attempts: 0, lastError: undefined }
    : work;

const stepPayloadOf = (work: OfflineLeadWork, step: UploadStep): unknown => {
  switch (step) {
    case 'calculator':
    case 'calculatorState':
      return work.calculators;
    case 'outcome':
      return work.outcome;
    case 'customer':
      return work.customer;
    case 'archive':
      return work.archive;
    case 'consent':
      return (work.consents || []).map((c) => c.clientId);
    case 'documents':
      return (work.documents || []).map((d) => d.clientId);
    default:
      return undefined;
  }
};

export const stepPayloadChanged = (
  sent: OfflineLeadWork,
  now: OfflineLeadWork,
  step: UploadStep
): boolean => {
  const a = stepPayloadOf(sent, step);
  const b = stepPayloadOf(now, step);
  if (a === b) return false;
  try {
    return JSON.stringify(a) !== JSON.stringify(b);
  } catch {
    return true;
  }
};

export const nextUploadStep = (work: OfflineLeadWork): UploadStep | null => {
  for (const step of UPLOAD_STEPS) {
    if (work.done.includes(step)) continue;
    if (!isStepApplicable(work, step)) continue;
    return step;
  }
  return null;
};

export const markStepDone = (
  work: OfflineLeadWork,
  step: UploadStep,
  ids: { leadId?: string; appointmentId?: string; calculators?: Record<string, string> } = {},
  now: number = Date.now()
): OfflineLeadWork => {
  const next: OfflineLeadWork = {
    ...work,
    serverIds: {
      leadId: ids.leadId || work.serverIds.leadId,
      appointmentId: ids.appointmentId || work.serverIds.appointmentId,
      calculators: { ...work.serverIds.calculators, ...(ids.calculators || {}) },
    },
    done: work.done.includes(step) ? work.done : [...work.done, step],
    attempts: 0,
    lastError: undefined,
    updatedAt: new Date(now).toISOString(),
  };
  return { ...next, status: nextUploadStep(next) === null ? 'uploaded' : next.status };
};

export type StepDecision =
  | 'retry'
  | 'retry-guarded'
  | 'done'
  | 'failed'
  | 'needs-review'
  // Session expired: leave the work as it is (draft, no attempt spent) for the next sign-in.
  | 'pause';

export const resolveStepDecision = (
  outcome: CreateOutcome,
  work: OfflineLeadWork,
  step: UploadStep
): StepDecision => {
  const safety = stepReplaySafety(step);

  switch (outcome) {
    case 'unauthorized':
      return 'pause';
    case 'never-sent':
      return 'retry';
    case 'rejected':
      return 'failed';
    case 'duplicate':
      return safety === 'unique-key' && hasServerUniqueKey(work.lead) ? 'done' : 'needs-review';
    case 'ambiguous':
      if (safety === 'idempotent') return 'retry';
      if (safety === 'guarded') return 'retry-guarded';
      if (safety === 'manual') return 'needs-review';
      return hasServerUniqueKey(work.lead) ? 'retry' : 'needs-review';
    default:
      return 'needs-review';
  }
};

export const readExistingAppointmentId = (err: any): string | null => {
  const body = err?.response?.data ?? err;
  const is409 =
    body?.code === 409 ||
    err?.response?.status === 409 ||
    err?.status === 409 ||
    /already has an appointment/i.test(String(body?.message || err?.message || ''));
  if (!is409) return null;

  const candidates = [
    body?.data?.appointmentId,
    body?.appointmentId,
    body?.data?._id,
    err?.response?.data?.data?.appointmentId,
  ];
  const found = candidates.find((v) => typeof v === 'string' && v.trim());
  return found ? String(found) : null;
};

export const readCreatedId = readCreatedLeadId;

export const decideAfterStepError = (
  err: unknown,
  work: OfflineLeadWork,
  step: UploadStep
): StepDecision => resolveStepDecision(classifyCreateOutcome(err), work, step);

export const applyStepDecision = (
  work: OfflineLeadWork,
  decision: StepDecision,
  error?: string,
  now: number = Date.now()
): OfflineLeadWork => {
  if (decision === 'pause') {
    return { ...work, status: 'draft', lastError: error, updatedAt: new Date(now).toISOString() };
  }
  const attempts = work.attempts + 1;
  const base = { ...work, attempts, lastError: error, updatedAt: new Date(now).toISOString() };

  switch (decision) {
    case 'retry':
    case 'retry-guarded':
      return attempts >= MAX_CREATE_ATTEMPTS
        ? { ...base, status: 'needs-review' }
        : { ...base, status: 'draft' };
    case 'failed':
      return { ...base, status: 'failed' };
    case 'done':
      return base;
    default:
      return { ...base, status: 'needs-review' };
  }
};

export const offlineWorkToLead = (work: OfflineLeadWork): Record<string, any> | null => {
  if (work.origin !== 'created-offline' || !work.lead) return null;
  const payload = work.lead as Record<string, any>;
  const customer = (payload.customer || {}) as Record<string, any>;
  const address = payload.fullAddress || customer.address || '';

  const isIssued = payload.leadType === 'lfLead';

  return {
    _id: workLeadId(work),
    clientId: work.clientId,
    __offline: true,
    __offlineStatus: work.status,
    leadType: payload.leadType || 'selfGen',
    status: isIssued ? 'lfLead' : 'selfGenerated',
    fullAddress: address,
    leadId: payload.lfLeadId || 'N/A',
    leadCode: payload.leadCode || (isIssued ? 'N/A' : 'SelfGen'),
    leadDatetime: payload.lfLeadDate || work.createdAt,
    leadTime: payload.lfLeadTime || 'N/A',
    lowesLead: payload.lowesLead === true,
    location: payload.location,
    lfLeadTime: payload.lfLeadTime,
    customerDetails: {
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address,
    },
    createdAt: work.createdAt,
  };
};

export const isOfflineLead = (lead: any): boolean => lead?.__offline === true;

export const findWorkForLead = (
  items: OfflineLeadWork[] | undefined,
  leadId: string
): OfflineLeadWork | undefined => {
  const id = String(leadId || '');
  if (!id) return undefined;
  return (items || []).find((w) => w.clientId === id || w.serverIds.leadId === id);
};

export const hasQueuedConsent = (
  items: OfflineLeadWork[] | undefined,
  leadId: string,
  kind: ConsentFormKind,
  onlyPending = false
): boolean => {
  const id = String(leadId || '');
  return (
    !!id &&
    (items || []).some(
      (w) =>
        (w.clientId === id || w.serverIds.leadId === id) &&
        !!w.consents?.some((c) => c.kind === kind && !(onlyPending && c.uploadedAt))
    )
  );
};

export const hasPendingConsent = (
  items: OfflineLeadWork[] | undefined,
  leadId: string,
  kind: ConsentFormKind
): boolean => hasQueuedConsent(items, leadId, kind, true);

/**
 * The results a rep can record at a door with no connection.
 *
 * ⚠️ This used to be `sale` and `demo` only, so **No Demo, Not Hit and Reset** were queued
 * (they share the `submit` step and the same `submitJobBuilder` endpoint) but the leads list
 * still showed the lead as unresulted until it synced. A rep resulting a lead and seeing nothing
 * change assumes it failed and does it again.
 *
 * ⚠️ These three are ORDINARY lead results, not the destructive "Reset Job Docs"
 * (`LeadService.resetLead`, `lead/v1/{id}/reset`), which wipes uploaded documents and is a
 * different control entirely. Do not conflate them: queueing that one would let a replay destroy
 * work the rep did after it.
 */
export const OFFLINE_RESULTABLE: ReadonlySet<string> = new Set([
  'sale',
  'demo',
  'nodemo',
  'nothit',
  'reset',
]);

export const offlineResultOverlay = (
  work: OfflineLeadWork | null | undefined
): Record<string, any> | null => {
  if (!work || work.status === 'uploaded') return null;
  const leadData = (work.submit as Record<string, any> | undefined)?.leadData as
    | Record<string, any>
    | undefined;
  if (!leadData) return null;

  const result = String(leadData.result || '').toLowerCase();
  if (!OFFLINE_RESULTABLE.has(result)) return null;

  /**
   * ⚠️ `status` is NOT always the result. A sale/demo names its own status, but the
   * no-sale outcomes carry a distinct one (`leadData.status`), which is what the leads list and
   * the lead card colour-code on. Reusing `result` for both showed a resulted lead as unresulted
   * until it synced.
   */
  return {
    status: String(leadData.status || result),
    result: leadData.result,
    originalContractPrice: leadData.originalContractPrice,
    lastPriceQuoted: leadData.lastPriceQuoted,
    downPayment: leadData.downPayment,
    balance: leadData.balance,
    paymentMethod: leadData.paymentMethod,
    balancePaymentMethod: leadData.balancePaymentMethod,
    reason: leadData.reason,
    explain: leadData.explain,
    oneLeg: leadData.oneLeg,
    selectedCalculatorId: leadData.selectedCalculatorId,
    __offlineResult: true,
  };
};

export const offlineCustomerOverlay = (
  work: OfflineLeadWork | null | undefined
): Record<string, any> | null => {
  if (!work || work.status === 'uploaded') return null;
  const payload = work.customer?.payload as Record<string, any> | undefined;
  if (!payload || work.done.includes('customer')) return null;
  return payload;
};

export const applyOfflineResult = <T extends Record<string, any> | null | undefined>(
  lead: T,
  items: OfflineLeadWork[] | null | undefined
): T => {
  if (!lead) return lead;
  const id = String((lead as any)._id || (lead as any).id || '');
  if (!id) return lead;
  const work = (items || []).find(
    (w) => w.clientId === id || w.serverIds.leadId === id
  );
  const overlay = offlineResultOverlay(work);
  const customer = offlineCustomerOverlay(work);
  if (!overlay && !customer) return lead;
  const out: Record<string, any> = { ...(lead as object), ...(overlay || {}) };
  if (customer) {
    out.customerDetails = { ...(out.customerDetails || {}), ...customer };
    if (customer.address) out.fullAddress = customer.address;
  }
  return out as T;
};

export const pendingLeadDeletes = (
  items: OfflineLeadWork[] | null | undefined
): Set<string> => {
  const out = new Set<string>();
  (items || []).forEach((w) => {
    if (!isStepPending(w, 'delete')) return;
    if (w.serverIds.leadId) out.add(w.serverIds.leadId);
    out.add(w.clientId);
  });
  return out;
};

export const pendingLeadArchives = (
  items: OfflineLeadWork[] | null | undefined
): Map<string, boolean> => {
  const out = new Map<string, boolean>();
  (items || []).forEach((w) => {
    if (!isStepPending(w, 'archive') || !w.archive) return;
    if (w.serverIds.leadId) out.set(w.serverIds.leadId, w.archive.isArchive);
    out.set(w.clientId, w.archive.isArchive);
  });
  return out;
};

export const offlineArchivedLeads = (
  items: OfflineLeadWork[] | null | undefined,
  options?: { serverLeadIds?: Iterable<string> | null | undefined }
): Record<string, any>[] => {
  const onServer = idSet(options?.serverLeadIds);
  return (items || [])
    .filter((w) => isStepPending(w, 'archive') && w.archive?.isArchive === true)
    .filter((w) => !onServer.has(workLeadId(w)))
    .map((w) => w.archive?.lead)
    .filter((l): l is Record<string, any> => !!l && !!(l as any)._id);
};

export interface OfflineLeadsForTabOptions {
  serverLeadIds?: Iterable<string> | null | undefined;
  keepUploaded?: Iterable<string> | null | undefined;
}

const idSet = (values: Iterable<string> | null | undefined): Set<string> => {
  const out = new Set<string>();
  if (!values) return out;
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) out.add(trimmed);
  }
  return out;
};

export const offlineLeadsForTab = (
  items: OfflineLeadWork[] | null | undefined,
  leadType: 'selfGen' | 'lfLead',
  options?: OfflineLeadsForTabOptions
): Record<string, any>[] => {
  const onServer = idSet(options?.serverLeadIds);
  const bridging = idSet(options?.keepUploaded);
  return (items || [])
    .filter((w) => !w.deleteLead)
    .filter((w) => w.status !== 'uploaded' || bridging.has(w.clientId))
    .filter((w) => !onServer.has(workLeadId(w)))
    .slice()
    .sort((a, b) => createdAtMs(b) - createdAtMs(a))
    .map(offlineWorkToLead)
    .filter((l): l is Record<string, any> => !!l && (l.leadType === leadType));
};

const createdAtMs = (work: OfflineLeadWork): number => {
  const at = Date.parse(String(work?.createdAt || ''));
  return Number.isNaN(at) ? 0 : at;
};

export const buildIdMap = (work: OfflineLeadWork): Record<string, string> => {
  const map: Record<string, string> = {};
  if (work.serverIds.leadId) map[work.clientId] = work.serverIds.leadId;
  if (work.appointmentClientId && work.serverIds.appointmentId) {
    map[work.appointmentClientId] = work.serverIds.appointmentId;
  }
  Object.entries(work.serverIds.calculators).forEach(([clientId, serverId]) => {
    if (serverId) map[clientId] = serverId;
  });
  return map;
};

export const resolveClientIds = <T,>(value: T, map: Record<string, string>): T => {
  if (typeof value === 'string') return (map[value] ?? value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => resolveClientIds(v, map)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      out[k] = resolveClientIds(v, map);
    });
    return out as unknown as T;
  }
  return value;
};

export const findUnresolvedClientIds = (value: unknown, seen: string[] = []): string[] => {
  if (typeof value === 'string') {
    if (isClientId(value) && !seen.includes(value)) seen.push(value);
    return seen;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => findUnresolvedClientIds(v, seen));
    return seen;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((v) => findUnresolvedClientIds(v, seen));
  }
  return seen;
};

export const uploadProgress = (work: OfflineLeadWork): { done: number; total: number } => {
  const applicable = UPLOAD_STEPS.filter(
    (s) => work.done.includes(s) || isStepApplicable(work, s)
  );
  return { done: applicable.filter((s) => work.done.includes(s)).length, total: applicable.length };
};

export const uploadableWork = (items: OfflineLeadWork[] | null | undefined): OfflineLeadWork[] =>
  (items || []).filter((w) => w.status === 'draft' && nextUploadStep(w) !== null);

export const activeWork = (items: OfflineLeadWork[] | null | undefined): OfflineLeadWork[] =>
  (items || []).filter(
    (w) =>
      w.status !== 'uploaded' &&
      (w.status === 'failed' || w.status === 'needs-review' || nextUploadStep(w) !== null)
  );

export const workLeadId = (work: OfflineLeadWork): string =>
  work.serverIds.leadId || work.clientId;

export const createdAtTheDoor = (work: OfflineLeadWork | null | undefined): boolean =>
  !!work && work.origin === 'created-offline' && isStepPending(work, 'lead');

/**
 * Which check-in log an offline "start appointment" writes ('' = none). Online, the geofence plan
 * decides. A lead created offline carries no coordinates yet (they are resolved at sync), so the
 * plan finds it "out of range" and logs nothing - the rep who just made the lead at the door still
 * checked in, so that lead is a check-in whatever the plan says.
 */
export const offlineCheckInModule = (
  plan: { shouldCallWork: boolean; logModule: string },
  atTheDoor: boolean
): string => {
  if (!plan.shouldCallWork && !atTheDoor) return '';
  return plan.logModule || (atTheDoor ? 'lead_check_in' : '');
};
