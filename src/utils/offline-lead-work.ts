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
    /**
     * ⚠️ `idempotent` ONLY because the server honours our idempotency key on
     * `POST lead/v1/create` (deployed 2026-10-16). Do NOT set this without that.
     *
     * It was `unique-key`: retry an ambiguous failure only if the payload carries something
     * the server will reject twice. An Issued lead has `lfLeadId`; a **Self Gen has nothing
     * unique**, because two real leads can share a name and an address. So the rule had
     * nothing to test and fell through to `needs-review` - the rep's typed lead sat parked
     * while the create they could not see had often already landed, which is how one door
     * became two leads.
     *
     * With the key, a replay returns the ORIGINAL lead and its `_id`, so retrying is safe for
     * both lead types. ⚠️ Reverting the server without reverting this would turn an
     * occasional duplicate into a reliable one.
     */
    case 'lead':
      return 'idempotent';
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
      /**
       * ⚠️ Scoped to the LEAD step explicitly. It used to read `safety === 'unique-key'`,
       * which happened to mean the same thing; reclassifying `lead` to `idempotent` broke
       * that coupling, and dropping the check outright made EVERY step return `done` on a
       * duplicate whenever the lead carried an `lfLeadId` - an appointment collision is not
       * evidence about the lead's unique key.
       *
       * An Issued lead's create still resolves to `done`: the server rejected it on
       * `lfLeadId`, which proves the first create landed.
       *
       * ⚠️ A duplicate on a KEYED create is a genuine conflict, not a replay: the server
       * replays a key it has already seen rather than rejecting it. So a Self Gen duplicate
       * still goes to needs-review for a human to look at.
       */
      return step === 'lead' && hasServerUniqueKey(work.lead) ? 'done' : 'needs-review';
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

/**
 * ⚠️ A failure the NETWORK caused must not spend an attempt.
 *
 * Reported from the field: offline work synced over slow mobile data produced DUPLICATE leads.
 * `MAX_CREATE_ATTEMPTS` is 5 and every failure counted, so five timeouts on a weak radio pushed
 * the work to `needs-review` - the state that asks the rep "is this on the server? retry if
 * not" - even though the server had never answered and nothing was wrong with the payload.
 * A rep looking at a lead they know they created taps retry, and that is the second lead.
 *
 * The counter exists to stop work the server keeps REFUSING from cycling forever. A timeout is
 * not that: it is the same work, undelivered. The create is idempotent (the work's `clientId`
 * is the key), so retrying it indefinitely is safe; giving up on it is what is not.
 */
export const applyStepDecision = (
  work: OfflineLeadWork,
  decision: StepDecision,
  error?: string,
  now: number = Date.now(),
  failure: 'transport' | 'rejected' = 'rejected'
): OfflineLeadWork => {
  if (decision === 'pause') {
    return { ...work, status: 'draft', lastError: error, updatedAt: new Date(now).toISOString() };
  }
  // ⚠️ Undelivered, not refused: stay `draft` and spend nothing, so the next sweep retries it.
  if (failure === 'transport' && (decision === 'retry' || decision === 'retry-guarded')) {
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

/**
 * The LOCAL calendar day of an instant, as a date-only string (`YYYY-MM-DD`).
 *
 * ⚠️ THE CARD FORMATS THIS WITH `new Date(...)`, so the value handed to it decides the day.
 * `work.createdAt` is a UTC instant (`toISOString()`), and a lead created at 22:30 UTC on the
 * 22nd renders as the **23rd** for a rep at +05:00 - the same off-by-one that put yesterday's
 * leads on the Today tab. Emitting the local Y/M/D means the card prints the day the rep
 * actually made the lead.
 *
 * ⚠️ Date-ONLY on purpose, matching what the server sends (`2026-10-22T00:00:00-04:00`
 * parses back to midnight local). Do not append a time or a `Z`: a `Z` re-introduces the shift.
 */
export const localDateOnly = (iso: string | null | undefined): string => {
  const ms = Date.parse(String(iso || ''));
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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
    /**
     * ⚠️ `leadDate` IS A SEPARATE FIELD FROM `leadDatetime`, and the lead CARD reads this one.
     *
     * Reported: a lead created offline showed its date as **N/A** on the leads list, while Lead
     * Center showed it correctly. Both were right about their own data - Lead Center renders
     * `leadDatetime` (set above), `LeadCard` renders `leadDate` (never set). A server lead
     * carries BOTH, so the gap only ever showed on an offline-created lead.
     */
    leadDate: payload.lfLeadDate ? localDateOnly(payload.lfLeadDate) : localDateOnly(work.createdAt),
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
  /**
   * Keep only work created on this calendar day. The Leads screen passes `Date.now()` for the
   * TODAY sub-tab and omits it everywhere else (Archived / Sold / Rehash are not day-scoped).
   */
  todayAt?: number | null;
}

/**
 * Same CALENDAR day in the DEVICE's timezone.
 *
 * ⚠️ Not a rolling 24h window, and not `AT_THE_DOOR_TTL_MS`. "Today" on this screen is the day
 * the rep is living in - the tab's own caption says *"All Self Gen Leads will be archived end of
 * day"* - so it has to RESET AT MIDNIGHT. A 24h TTL would keep a lead made at 11pm yesterday on
 * Today until 11pm tonight, which is the reported bug with extra steps.
 *
 * ⚠️ Local, deliberately. This is compared against the rep's own clock and the server's
 * `period: 'today'`, both of which mean the rep's day. Normalising to UTC would move the boundary
 * by the offset and drop a lead made this evening in a UTC-negative timezone.
 *
 * ⚠️ `createdAt` is a full ISO INSTANT (`new Date().toISOString()`), not a bare calendar date,
 * so `new Date()` is correct here - this is not the date-as-text trap from the root guide, which
 * is about bare `YYYY-MM-DD` strings being shifted by an offset.
 */
export const isSameLocalDay = (aMs: number, bMs: number): boolean => {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

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
  const todayAt = typeof options?.todayAt === 'number' ? options.todayAt : null;
  return (items || [])
    .filter((w) => !w.deleteLead)
    .filter((w) => w.status !== 'uploaded' || bridging.has(w.clientId))
    .filter((w) => !onServer.has(workLeadId(w)))
    /**
     * ⚠️ THE TODAY TAB IS DAY-SCOPED, and this overlay used to ignore that entirely.
     *
     * Reported: "when I go offline it also shows the old leads - I made those yesterday and it's
     * showing them under Today." The SERVER list is filtered with `period: 'today'`, but these
     * queued leads are prepended by the device, so every un-uploaded lead ever made stayed on
     * Today until it synced. A rep with no signal for two days saw both days piled together, with
     * yesterday's dates printed on the cards.
     *
     * ⚠️ The lead is NOT lost or deleted - it is still queued, still syncs, and still appears on
     * the pending-uploads banner. It is only kept off a tab that promises one day.
     */
    .filter((w) => todayAt === null || isSameLocalDay(createdAtMs(w), todayAt))
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

/**
 * Could any queued work still MINT a server id?
 *
 * ⚠️ NOT `uploadableWork`. That one answers "what should the drain pick up next", so it
 * requires `status === 'draft'` - and during a drain the item is `'uploading'`. The activity-log
 * hold policy asked `uploadableWork(...).length > 0` and therefore went FALSE for the whole
 * drain, exactly when ids are being minted. `hasUnresolvedIds` collapsed to false with it, so a
 * lead-scoped log queued or drained in that window was sent carrying its raw client id
 * (`lead-1792...`) and the backend discarded it.
 *
 * That is why `leads_list` logs arrived and `lead_check_in` never did: `leads_list` is in
 * `ExcludedModuleTypes`, so it carries no `leadId` at all and had nothing to resolve.
 *
 * `'uploading'` counts here. `'uploaded'` does not - that work is finished and will mint nothing
 * further, which is what stops a log being held for an id that is never coming.
 */
export const workCanStillMintIds = (items: OfflineLeadWork[] | null | undefined): boolean =>
  (items || []).some(
    (w) => (w.status === 'draft' || w.status === 'uploading') && nextUploadStep(w) !== null
  );

export const activeWork = (items: OfflineLeadWork[] | null | undefined): OfflineLeadWork[] =>
  (items || []).filter(
    (w) =>
      w.status !== 'uploaded' &&
      (w.status === 'failed' || w.status === 'needs-review' || nextUploadStep(w) !== null)
  );

export const workLeadId = (work: OfflineLeadWork): string =>
  work.serverIds.leadId || work.clientId;

/**
 * A lead the rep created themselves, at the door, with no signal.
 *
 * Its own creation is the arrival evidence: a lead created offline carries no resolved
 * coordinates, so the geofence plan calls it "out of range" and would log nothing.
 *
 * ⚠️ Bounded by the WORK SESSION, not by whether the create has uploaded. It used to be
 * `isStepPending(work, 'lead')`, which lost the reported check-in: the rep created the lead
 * offline, the `lead` step drained on reconnect, and only THEN did they press Start - by which
 * point this was false and nothing rescued the plan, so the check-in was never queued at all
 * and the second device correctly showed "Start Appointment".
 *
 * ⚠️ It must still STOP applying eventually. Re-opening the same lead days later is an
 * ordinary server lead and has to go back through the geofence rather than re-checking-in on
 * the strength of its origin - so this expires with the work item's own day.
 */
export const AT_THE_DOOR_TTL_MS = 12 * 60 * 60 * 1000;

export const createdAtTheDoor = (
  work: OfflineLeadWork | null | undefined,
  now: number = Date.now()
): boolean => {
  if (!work || work.origin !== 'created-offline') return false;
  // Still queued: unambiguously the same visit.
  if (isStepPending(work, 'lead')) return true;
  const created = Date.parse(work.createdAt || '');
  if (Number.isNaN(created)) return false;
  return now - created <= AT_THE_DOOR_TTL_MS;
};

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
