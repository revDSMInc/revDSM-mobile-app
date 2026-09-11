/**
 * offline-lead-work.ts — the rules for a whole lead worked with no signal.
 *
 * `offline-lead-queue.ts` (which this builds on and does not replace) answers one question: how do
 * you replay a lead CREATE whose outcome is unknown. This file answers the larger one the rep
 * actually has — they knock a door in a dead zone, create the lead, price it in the Deal Center,
 * present it in the Investment Center, result it and submit the job, and none of that may touch
 * the network until they are back in the truck.
 *
 * ## Why this is a STORE and not a queue of requests
 *
 * The first design here was an outbox of HTTP calls. It was wrong, and the reason is worth keeping:
 * the Deal Center has to RENDER that calculator while offline, so the data must live on the device
 * regardless. An outbox would have stored it twice — once as a queued request, once as a read model
 * for the screens — and two copies of one truth drift. So there is one store: it is what the
 * screens read AND what gets uploaded.
 *
 * It also makes coalescing a non-problem. A queue of edits would need "keep only the latest write
 * per calculator" or 500 keystrokes become 500 requests; a store of STATE is simply the current
 * value, and a whole offline session uploads as ~6 requests.
 *
 * ## The server ids are the whole difficulty
 *
 * Every write past the lead create is addressed by an id the server issues:
 *
 *     POST /appointments                          -> needs the lead's _id
 *     POST /appointments/{apptId}/lfcalculators   -> needs the appointment's _id
 *     PUT  /lfcalculators/{calcId}                -> needs the calculator's _id
 *     PUT  /lead/v1/{leadId}/outcome/{calcId}     -> needs both
 *     POST /lead/v1/{leadId}/job-builder          -> needs the lead's _id
 *
 * Offline none of them exist, so the work is recorded against CLIENT ids and the upload resolves
 * them in order, recording each server id as it lands (`serverIds`). `UPLOAD_STEPS` is that order.
 *
 * ## One machine, two origins
 *
 * A rep works both a lead they just created offline and one already assigned to them. Those are
 * NOT two flows — an `existing` lead simply starts with `leadId` already known, so the `lead` step
 * is already satisfied and the machine begins at `appointment`. Everything downstream is identical.
 *
 * ## Resuming, not restarting
 *
 * `done` is the set of steps already applied to the server. A failed upload resumes at the first
 * step not in it, so a step that already recorded an id is never re-run. That is what carries most
 * of the replay safety structurally, rather than by remembering to check.
 *
 * Pure and RN-free (no MMKV, no axios) so every rule here is testable; `services/offlineLeadStore`
 * is the storage and the uploader.
 */

import {
  classifyCreateOutcome,
  hasServerUniqueKey,
  MAX_CREATE_ATTEMPTS,
  readCreatedLeadId,
  type CreateOutcome,
} from './offline-lead-queue';

// ─── The steps, in the only order they can run ────────────────────────────────

export type UploadStep =
  /** `POST lead/v1/create` — skipped outright when the lead already exists on the server. */
  | 'lead'
  /** `POST /appointments` — the calculator hangs off it. */
  | 'appointment'
  /** `POST /appointments/{id}/lfcalculators` — one per calculator the rep built. */
  | 'calculator'
  /** `PUT /lfcalculators/{id}` — entries, totals, price, drops. The whole session in one body. */
  | 'calculatorState'
  /** `PUT lead/v1/{leadId}/outcome/{calcId}` — the result + the job-builder draft. */
  | 'outcome'
  /**
   * The signed agreement and any order sheets captured at the door, filed one at a time through
   * `PUT lead/v1/{leadId}/outcome/{calcId}`.
   *
   * ⚠️ This is NOT `pdf-reports/.../sign`, and that is the whole offline agreement design. The
   * sign endpoint renders the PDF on the server, so it cannot run at the door; offline the device
   * renders the agreement from the cached company config, the customer signs on the same screen,
   * and the finished document is filed exactly like a SCANNED one. So an agreement signed offline
   * takes a path the app already has, and no new endpoint is needed.
   */
  | 'documents'
  /**
   * `POST pdf-reports/v1/agreement/{leadId}/send-remote` — the rep chose to have the customer
   * sign on their own phone instead of at the door.
   *
   * ⚠️ Queueable only because this request carries NO agreement id: it names the lead and the
   * signers, and the server renders and sends the document itself. So the rep can take the
   * customer's number with no signal and the link goes out the moment there is one.
   */
  | 'remoteSignature'
  /** `POST lead/v1/{leadId}/job-builder` — the submit. Only when the rep finished the job. */
  | 'submit';

/**
 * ⚠️ ORDER IS LOAD-BEARING and is a dependency chain, not a preference: each step's URL or body
 * needs an id the step before it produces. Do not reorder to "get the submit in early".
 */
export const UPLOAD_STEPS: readonly UploadStep[] = [
  'lead',
  'appointment',
  'calculator',
  'calculatorState',
  'outcome',
  'documents',
  'remoteSignature',
  'submit',
] as const;

// ─── How safe is each step to REPLAY when its outcome was unknown? ─────────────

export type ReplaySafety =
  /** A full-state PUT. Sending it twice lands the same state; replay is free. */
  | 'idempotent'
  /** A POST, but a cheap read can tell us whether the first attempt landed. Look, then create. */
  | 'guarded'
  /** A POST whose safety depends on the payload carrying a server-enforced unique key. */
  | 'unique-key'
  /** ⚠️ A POST we will not guess at. An unknown outcome goes to the rep, never to a replay. */
  | 'manual';

/**
 * ⚠️ This table is the reason we need NO `Idempotency-Key` from the backend to ship this.
 *
 * Every create in this flow already has a matching read the app performs anyway, so a replay can
 * look before it writes. The reads are NOT part of the happy path — offline-created work has
 * nothing on the server to find, and looking would be a wasted round trip. They fire only when we
 * are retrying a step whose outcome was genuinely undecidable (`ambiguous`).
 */
export const stepReplaySafety = (step: UploadStep): ReplaySafety => {
  switch (step) {
    case 'calculatorState':
    case 'outcome':
      return 'idempotent';
    case 'lead':
      return 'unique-key';
    case 'remoteSignature':
      // The server answers 409 when an agreement is already out for this lead, which IS the
      // evidence a replay needs — see the step, which reads that as "already sent".
      return 'guarded';
    case 'documents':
      // ⚠️ Guarded, and the guard is only sound because we NAME the document.
      //
      // This PUT APPENDS — that is exactly how this repo shipped a duplicate signed agreement once
      // (CLAUDE.md, "the backend files a SECOND agreement row on submit"), and the artefact here is
      // the contract the customer signed. So a replay may never be a guess: `findFiledDocument`
      // looks for the document's own name, which `offlineDocumentName` stamps with a timestamp
      // precisely so it cannot collide with another. Match found -> already filed, do not re-send.
      //
      // Each document is also marked uploaded the instant ITS OWN put returns, so an interrupted
      // run resumes at the first unfiled one rather than re-filing the ones that landed.
      return 'guarded';
    default:
      return 'guarded';
  }
};

// ─── The record ───────────────────────────────────────────────────────────────

export type WorkOrigin =
  /** The rep created this lead with no signal. The server has never heard of it. */
  | 'created-offline'
  /** Already on the server (an Issued lead, or one created online) and worked offline. */
  | 'existing';

export type WorkStatus =
  /** The rep is still working it, or it is waiting for a connection. The normal state. */
  | 'draft'
  /** An upload is in flight right now. */
  | 'uploading'
  /** Every applicable step landed. */
  | 'uploaded'
  /** The server refused something a retry cannot fix. The rep must act. */
  | 'failed'
  /** ⚠️ Outcome UNKNOWN and not safe to replay unattended. The rep must confirm. */
  | 'needs-review';

export interface OfflineCalculatorWork {
  /** Client id while offline; the key `serverIds.calculators` maps to a real `_id`. */
  clientId: string;
  /** Present from the start for a calculator that already existed on the server. */
  serverId?: string;
  /** Exactly the body `LeadService.updateCalculator` would PUT. */
  payload: Record<string, unknown>;
}

/** Which card on the Summary tab a document belongs to — and which key it is filed under. */
export type OfflineDocumentCategory = 'agreement' | 'orderSheet';

/** The root key this category occupies in the outcome PUT. */
export const documentRootKey = (category: OfflineDocumentCategory): 'agreements' | 'orderSheets' =>
  category === 'agreement' ? 'agreements' : 'orderSheets';

/**
 * One document captured with no signal — a device-rendered signed agreement, or a scanned order
 * sheet — waiting to be filed.
 */
export interface OfflineJobDocument {
  clientId: string;
  category: OfflineDocumentCategory;
  /**
   * ⚠️ Load-bearing, not cosmetic. This is what the guarded replay matches on to decide whether an
   * interrupted upload already filed this document, so it must be unique — see `offlineDocumentName`.
   */
  name: string;
  /**
   * A `file://` path on disk — NOT the document's bytes.
   *
   * ⚠️ This record lives in MMKV, and MMKV rewrites the whole store on every write. A signed
   * agreement is megabytes; holding its base64 here would mean re-serializing those megabytes on
   * every keystroke the Job Builder autosaves. The bytes stay on disk and are read once, at send.
   */
  uri: string;
  contentType: string;
  /** Set the instant the server confirms THIS document. A filed document is never re-sent. */
  uploadedAt?: string;
}

/**
 * Name a document so a replay can recognise it.
 *
 * The timestamp is the point: two order sheets scanned at one door are otherwise both
 * "Order Sheet", and a guarded retry that matched on that name would treat the second as already
 * filed and silently drop it.
 */
export const offlineDocumentName = (
  category: OfflineDocumentCategory,
  extension: string,
  now: number = Date.now()
): string =>
  `${category === 'agreement' ? 'Agreement' : 'OrderSheet'}_offline_${now}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${extension}`;

export interface OfflineLeadWork {
  /** Stable handle for this unit of work. Never regenerated — a retry must be recognisable. */
  clientId: string;
  origin: WorkOrigin;
  status: WorkStatus;
  /** Filled in as the upload walks the steps. `leadId` is present from the start for `existing`. */
  serverIds: {
    leadId?: string;
    appointmentId?: string;
    /** calculator clientId -> server `_id`. */
    calculators: Record<string, string>;
  };
  /** The `POST lead/v1/create` body. Absent for `existing`. */
  lead?: Record<string, unknown>;
  /** The `POST /appointments` body. */
  appointment?: Record<string, unknown>;
  /** The id the appointment was addressed by offline, so payloads referencing it can be rewritten. */
  appointmentClientId?: string;
  calculators: OfflineCalculatorWork[];
  /** The `PUT .../outcome/{calcId}` body — result fields + the dynamic job state. */
  outcome?: Record<string, unknown>;
  /** WHICH calculator the outcome hangs off — that id is in the URL, so it must be resolvable. */
  outcomeCalculatorClientId?: string;
  /** Signed agreements and order sheets captured at the door, each filed once. */
  documents?: OfflineJobDocument[];
  /** `{ signers }` for a remote signing session the rep set up with no signal. */
  remoteSignature?: Record<string, unknown>;
  /** The `POST .../job-builder` body. Present only once the rep completed the job. */
  submit?: Record<string, unknown>;
  /** Steps already applied to the server. The resume pointer. */
  done: UploadStep[];
  /** For the pending list, so a rep sees WHICH lead is waiting without opening it. */
  label: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError?: string;
}

// ─── Identity ─────────────────────────────────────────────────────────────────

/** Same shape as `newLeadClientId` — this repo has no uuid dependency and one is not worth adding. */
export const newWorkId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

/**
 * True for an id this device minted, i.e. one the server has never seen.
 *
 * ⚠️ Every screen that reads `lead._id` offline must fall back to the client id, and every write
 * must refuse to put one of these in a URL — that is a request to `/lfcalculators/lead-1773…`,
 * which 404s rather than failing usefully.
 */
export const isClientId = (id: unknown): boolean =>
  typeof id === 'string' && /^(lead|appt|calc|work)-\d{10,}-/.test(id);

// ─── Building a record ────────────────────────────────────────────────────────

/** A lead the rep created with no signal: nothing on the server, so every step is still to do. */
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

/**
 * A lead already on the server, opened and worked offline.
 *
 * ⚠️ `done` starts holding `'lead'` — not because a create succeeded, but because there is nothing
 * to create. The step machine reads "already satisfied", which is what lets ONE uploader serve both
 * origins instead of two near-identical ones.
 */
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

// ─── The step machine ─────────────────────────────────────────────────────────

/**
 * Does this step have anything to do for this record?
 *
 * ⚠️ "Not applicable" and "not done yet" are different, and conflating them stalls the upload
 * forever: a lead the rep priced but did not result has no `outcome` and no `submit`, and must
 * still upload its calculator rather than waiting for a result that is never coming.
 */
export const isStepApplicable = (work: OfflineLeadWork, step: UploadStep): boolean => {
  switch (step) {
    case 'lead':
      return work.origin === 'created-offline' && !!work.lead;
    case 'appointment':
      // An appointment already resolved online needs no create.
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
    case 'submit':
      return !!work.submit;
    default:
      return false;
  }
};

/** The first step still to run, or `null` when the record is fully uploaded. */
export const nextUploadStep = (work: OfflineLeadWork): UploadStep | null => {
  for (const step of UPLOAD_STEPS) {
    if (work.done.includes(step)) continue;
    if (!isStepApplicable(work, step)) continue;
    return step;
  }
  return null;
};

/**
 * Record a step as landed, folding in any server ids it produced.
 *
 * Returns a NEW record — never mutates, so a caller holding the previous value (a render, an
 * in-flight comparison) cannot observe a half-applied update.
 */
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

// ─── What to do when a step fails ─────────────────────────────────────────────

export type StepDecision =
  /** Safe to send again on the next reconnect. */
  | 'retry'
  /** Send again, but READ FIRST to see whether the earlier attempt landed. */
  | 'retry-guarded'
  /** Already on the server. Treat as done and move on. */
  | 'done'
  /** The server refused it for a reason a retry cannot fix. */
  | 'failed'
  /** ⚠️ Undecidable and not safe to guess. Park it for the rep. */
  | 'needs-review';

/**
 * The decision table, per step.
 *
 * ⚠️ The row that carries the design is `ambiguous` — a timeout or a 5xx, where the connection
 * existed and the server MAY have committed. `never-sent` is provably safe (nothing was written);
 * `ambiguous` is the genuinely undecidable one, and what each step does with it is exactly the
 * `stepReplaySafety` table:
 *
 *   idempotent  -> retry           a repeated PUT lands the same state
 *   guarded     -> retry-guarded   look for what the first attempt may have created, then decide
 *   unique-key  -> retry if the payload carries one, else needs-review
 */
export const resolveStepDecision = (
  outcome: CreateOutcome,
  work: OfflineLeadWork,
  step: UploadStep
): StepDecision => {
  const safety = stepReplaySafety(step);

  switch (outcome) {
    case 'never-sent':
      return 'retry';
    case 'rejected':
      return 'failed';
    case 'duplicate':
      // ⚠️ Only meaningful where the server actually holds a unique index. A "duplicate" message on
      // a step with no such key is about something we do not understand, and reading it as success
      // would discard work that was never filed.
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

/**
 * The appointment id out of a 409 "This lead already has an appointment".
 *
 * ⚠️ A 409 from `POST /appointments` is NOT a failure — it is the server answering with the
 * appointment that already exists, and the id is in the body. Treating it as a rejection strands
 * the upload permanently: the retry re-posts the same create, gets the same 409, and the rep sees
 * "Couldn't be uploaded" with a Try again that can never succeed.
 *
 * ⚠️ The axios interceptor rejects with the response BODY, so a 409 usually arrives already
 * unwrapped as `{ code: 409, message, data: { appointmentId } }` — every shape is checked, the
 * same way `resolveAppointmentId` in the Deal Center does.
 */
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

/**
 * The server `_id` out of a create response, whatever the deployment wraps it in.
 *
 * ⚠️ Reused verbatim from the lead create rather than re-derived: appointments and calculators come
 * back through the same axios wrapper and the same envelope shapes, and two extractors that drift
 * apart would show up as a step that silently records no id and re-creates on every drain.
 */
export const readCreatedId = readCreatedLeadId;

/** Classify the error and decide, in one call — the shape the uploader wants. */
export const decideAfterStepError = (
  err: unknown,
  work: OfflineLeadWork,
  step: UploadStep
): StepDecision => resolveStepDecision(classifyCreateOutcome(err), work, step);

/**
 * Apply a decision to the record.
 *
 * ⚠️ The attempt cap moves a record to `needs-review`, NEVER to deletion — the rep's work is never
 * discarded by a counter. Same rule as `applyDecision` in `offline-lead-queue`.
 */
export const applyStepDecision = (
  work: OfflineLeadWork,
  decision: StepDecision,
  error?: string,
  now: number = Date.now()
): OfflineLeadWork => {
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

// ─── Showing offline work as a LEAD ───────────────────────────────────────────

/**
 * Project a record the rep created offline into the shape the Leads list and the Lead Center
 * render, so it appears and opens like any other lead.
 *
 * ⚠️ The create payload and the lead RECORD are not the same shape — the payload nests the person
 * under `customer`, the record under `customerDetails`. Reading one as the other is what leaves a
 * row on screen with a blank name and no address.
 *
 * ⚠️ `null` for an `existing` lead, deliberately: that one is already in the list from the server
 * (or from cache), and projecting it again would show the rep the same door twice.
 */
export const offlineWorkToLead = (work: OfflineLeadWork): Record<string, any> | null => {
  if (work.origin !== 'created-offline' || !work.lead) return null;
  const payload = work.lead as Record<string, any>;
  const customer = (payload.customer || {}) as Record<string, any>;
  const address = payload.fullAddress || customer.address || '';

  return {
    // ⚠️ The CLIENT id, until the create lands. Every screen this opens must therefore guard with
    // `isClientId` before putting it in a URL.
    _id: workLeadId(work),
    clientId: work.clientId,
    /** The marker every offline-aware screen branches on. */
    __offline: true,
    __offlineStatus: work.status,
    leadType: payload.leadType || 'selfGen',
    status: payload.leadType === 'lfLead' ? 'issued' : 'selfGenerated',
    fullAddress: address,
    leadId: payload.lfLeadId || '',
    leadCode: payload.leadCode || '',
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

/** True for a lead row this device is still holding — the list and Lead Center both branch on it. */
export const isOfflineLead = (lead: any): boolean => lead?.__offline === true;

/**
 * The offline rows belonging to one tab of the Leads list.
 *
 * ⚠️ Scoped by lead TYPE, so a self-gen created at the door does not appear under Issued (and an
 * Issued Lead entered offline does not land in Self Gens, where the rep would never look for it).
 */
export const offlineLeadsForTab = (
  items: OfflineLeadWork[] | null | undefined,
  leadType: 'selfGen' | 'lfLead'
): Record<string, any>[] =>
  (items || [])
    .filter((w) => w.status !== 'uploaded')
    .map(offlineWorkToLead)
    .filter((l): l is Record<string, any> => !!l && (l.leadType === leadType));

// ─── Rewriting client ids inside a payload ────────────────────────────────────

/**
 * Every id this record knows, client -> server.
 *
 * ⚠️ The LEAD is keyed by `work.clientId` itself, because that is what `workLeadId` hands the
 * screens while offline, so that is the string that ends up written into the bodies they build.
 */
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

/**
 * Deep-replace every client id in a payload with the server id it resolved to.
 *
 * ⚠️ Client ids do NOT only appear in URLs. The result modal writes `selectedCalculatorId`, the
 * submit body carries `calculatorId` / `appointmentId`, and the job state references the lead — all
 * built while offline, so all holding ids the server has never seen. Sending one produces a record
 * that points at nothing: no error, no 404, just a deal wired to a calculator that does not exist.
 *
 * Returns a new structure; the stored record is never mutated.
 */
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

/**
 * Any client id still in the payload after the rewrite — i.e. one we have no server id for.
 *
 * ⚠️ This is the last gate before a send, and it must PARK the record rather than let it through.
 * A surviving client id means an earlier step did not record its id, and sending anyway files a
 * real row on the server holding a reference that can never resolve — silent, and only visible
 * later as a deal whose calculator is missing.
 */
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

// ─── Reading the store ────────────────────────────────────────────────────────

/**
 * How far along the upload is, for the rep.
 *
 * ⚠️ `total` counts only the steps that APPLY to this record, so a lead the rep priced but never
 * resulted reads "2 of 3" and completes, rather than sitting at "2 of 7" forever waiting on a
 * result that is not coming.
 */
export const uploadProgress = (work: OfflineLeadWork): { done: number; total: number } => {
  const applicable = UPLOAD_STEPS.filter(
    (s) => work.done.includes(s) || isStepApplicable(work, s)
  );
  return { done: applicable.filter((s) => work.done.includes(s)).length, total: applicable.length };
};

/** Records with work still to send. */
export const uploadableWork = (items: OfflineLeadWork[] | null | undefined): OfflineLeadWork[] =>
  (items || []).filter((w) => w.status === 'draft' && nextUploadStep(w) !== null);

/** Records the rep still has a reason to see. */
export const activeWork = (items: OfflineLeadWork[] | null | undefined): OfflineLeadWork[] =>
  (items || []).filter((w) => w.status !== 'uploaded');

/**
 * The id a screen should address this lead by: the server's once known, else the client's.
 *
 * ⚠️ Read THROUGH this rather than `lead._id` anywhere that runs offline, and pair it with
 * `isClientId` before putting the result in a URL.
 */
export const workLeadId = (work: OfflineLeadWork): string =>
  work.serverIds.leadId || work.clientId;
