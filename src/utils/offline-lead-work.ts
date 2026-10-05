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

import type { ConsentFormKind } from './consent-forms';

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
  | 'submit'
  /**
   * `POST user/consent/v1/mobile/create` / `POST lead/v1/{leadId}/mobile/waiver-form` — a Customer
   * Consent Form or a Roof Waiver the customer signed at the door.
   *
   * ⚠️ Unlike the agreement, this one CANNOT be rendered on the device: the endpoint answers WITH
   * the PDF, so the document only exists once the form uploads. What is captured offline is the
   * form and the signature; the PDF and its `generatedReport` row arrive with the connection.
   */
  | 'consent'
  /**
   * `PUT lead/v1/{id}/work` — the rep started or resumed the appointment at the door.
   *
   * ⚠️ This was deliberately NOT replayed at first, on the reasoning that `work` says a rep is on
   * site RIGHT NOW and re-sending it hours later would put them at a door they left before lunch.
   * That is retired, and the thing that retires it is the HELD ACTIVITY LOG beside it: the arrival
   * time already reaches the portal accurately, stamped `meta.occurredAt` at the door. So all this
   * call carries is the lead's STATE — and without it the office never learns the door was worked
   * at all, and the card falls back to **Start Appointment** on a lead the rep already visited.
   */
  | 'work'
  /**
   * `PATCH lead/v1/customer/{customerId}` — the rep corrected the customer's own details at the
   * door: a name, a phone number, an email, the address, a co-buyer.
   *
   * ⚠️ Addressed by the CUSTOMER record's id, which is a different document from the lead — so
   * this step is only ever queued for a lead whose customer the server already has. A lead created
   * at the door has no customer record yet, and an edit made before its create lands is folded
   * into the create body instead (`queueCustomerUpdate`), which files the right values first time
   * rather than filing the old ones and correcting them a request later.
   */
  | 'customer'
  /**
   * `PATCH lead/v1/archive/{id}` — the rep archived (or un-archived) the lead with no signal.
   *
   * ⚠️ Queueable because the body carries the STATE (`{ isArchive }`), not a toggle. Sending it
   * twice lands the same answer, so an ambiguous retry costs nothing and needs no guard read.
   */
  | 'archive'
  /**
   * `DELETE lead/v1/delete/{id}` — the rep deleted the lead with no signal.
   *
   * ⚠️ Only ever reached for a lead that IS on the server. One the rep created at the door and
   * then deleted before it uploaded is dropped from the store outright — queueing a create so a
   * delete can undo it would file the lead on the portal for as long as the two requests take.
   */
  | 'delete';

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
  // ⚠️ LAST, and it is failure isolation rather than an ordering preference. A step that fails
  // stops the whole record, so anything placed ahead of `submit` can hold the SALE behind it — and
  // of the two, a consent form is the one the office can chase by hand. It depends on nothing but
  // the lead, so it is free to sit at the end; and arrival order changes nothing about the record,
  // since the form carries the date and time it was actually signed in its own fields.
  'consent',
  // ⚠️ AFTER the submit, and that ordering is the guard rather than a preference — see
  // `isStepApplicable`, where a resulted lead skips this step outright. A check-in is the weaker
  // statement of the two; replaying it over a result would put a sold lead back in progress.
  'work',
  // ⚠️ After `work` and before the two terminal actions, for the same failure-isolation reason as
  // `consent`: a customer's spelling is not worth holding a sale behind. It depends on nothing but
  // the customer id, which is known the moment the rep presses Save, so the end costs it nothing.
  'customer',
  // ⚠️ The two lead-level actions run LAST, for the same failure-isolation reason as `consent`:
  // neither is worth holding a sale behind. `delete` is last of all because it is terminal — see
  // `isStepApplicable`, where it suppresses every other step, so its position is a formality.
  'archive',
  'delete',
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
    case 'work':
    case 'customer':
    case 'archive':
    case 'delete':
      // ⚠️ Each sets a STATE rather than appending a record, so replaying one lands exactly where
      // the first attempt would have. `PATCH { isArchive }` is not a toggle, the customer PATCH
      // carries the whole corrected record, and deleting an already-deleted lead is the state we
      // wanted — the step reads that 404 as success.
      return 'idempotent';
    case 'lead':
      return 'unique-key';
    case 'remoteSignature':
      // The server answers 409 when an agreement is already out for this lead, which IS the
      // evidence a replay needs — see the step, which reads that as "already sent".
      return 'guarded';
    case 'consent':
      // ⚠️ Guarded, and the guard is a read THE APP ALREADY MAKES: a filed form appears as a
      // `generatedReport` on the lead, which is the same row every "is it signed?" check reads. So
      // an ambiguous retry can look before it writes, and a second consent form — a second legal
      // record of one signature — is never filed on a guess.
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

/**
 * A Customer Consent Form or Roof Waiver signed with no signal, waiting to be filed.
 *
 * ⚠️ The consent is the GATE — the rep may not present a quote until the customer has signed one —
 * so this record has a second job beyond uploading: it is what keeps the answer to "is it signed?"
 * YES on a device that has not been able to tell the server yet. Losing it would put the gate back
 * up in front of a customer who has already signed.
 */
export interface OfflineConsentForm {
  clientId: string;
  kind: ConsentFormKind;
  /** Exactly the multipart fields the online mutation posts, minus the signature file. */
  payload: Record<string, unknown>;
  /**
   * A `file://` path to the signature SVG — NOT its contents.
   *
   * ⚠️ Same rule as `OfflineJobDocument.uri`, for the same reason: this record lives in MMKV, which
   * rewrites its whole store on every write. It is copied out of the CACHES directory on the way in,
   * because iOS empties caches under pressure and a queued signature that evaporates is a consent
   * the rep watched the customer sign and the office never receives.
   */
  signatureUri?: string;
  signatureName?: string;
  signatureType?: string;
  /**
   * Whether the lead ALREADY carried a filed form of this kind when this one was signed.
   *
   * ⚠️ This is what makes the guarded replay sound rather than merely usually-right. The guard asks
   * "is a form of this kind on the lead now?" and reads yes as "my POST landed" — which is only
   * true if there was not one there to begin with. In practice it is always false (neither surface
   * offers the form when one is already filed), and a `true` here sends the retry to the rep rather
   * than letting it guess.
   */
  knownFiledBefore?: boolean;
  /**
   * Set the instant the multipart POST returns — the form IS filed and the PDF rendered.
   *
   * ⚠️ Recorded separately from `uploadedAt` because filing the form and registering its PDF are
   * two requests. A connection that dies between them must resume at the SECOND one: starting over
   * would file the customer's one signature as two consent records.
   */
  submittedAt?: string;
  /** Where the rendered PDF was kept, so the finalize can be retried without re-submitting. */
  pdfPath?: string;
  /** Set once the PDF is registered as a `generatedReport`. A filed form is never re-sent. */
  uploadedAt?: string;
}

export interface OfflineLeadWork {
  /** Stable handle for this unit of work. Never regenerated — a retry must be recognisable. */
  clientId: string;
  /**
   * The rep this work belongs to.
   *
   * ⚠️ Stamped by `putOfflineWork` and enforced on every read AND on the drain — see
   * `utils/session-scope.ts`. Field crews share handsets, and without it a lead one rep created at
   * a door appeared in the next rep's list and queued to upload under THEIR token.
   *
   * Optional only because records written before this existed have none; those belong to nobody,
   * so they are neither shown nor uploaded.
   */
  ownerId?: string;
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
  /** Consent forms and roof waivers signed at the door, each filed exactly once. */
  consents?: OfflineConsentForm[];
  /**
   * The rep archived — or un-archived — this lead with no signal.
   *
   * `lead` is a pruned snapshot of the row, held ONLY so the Archived tab can draw it before the
   * PATCH lands. Without it an archived lead leaves Today and appears nowhere, which reads as a
   * delete; the rep is then told a lead is queued and cannot see the lead it is about.
   */
  archive?: { isArchive: boolean; lead?: Record<string, unknown> };
  /** The rep deleted this lead with no signal. Terminal — see `isStepApplicable`. */
  deleteLead?: boolean;
  /** The rep started or resumed the appointment at the door. `userId` is who `work` is filed as. */
  workStarted?: { userId: string; at: string };
  /**
   * Customer details corrected with no signal.
   *
   * ⚠️ `customerId` is the CUSTOMER record's `_id`, never the lead's — they are different
   * documents, and this repo has already recorded the trap: `handleCustomerSubmit` falls back to
   * the lead id when resolving the PATCH url, and letting that fallback reach here would file one
   * rep's edit against the wrong record. `queueCustomerUpdate` refuses rather than guessing.
   */
  customer?: { customerId: string; payload: Record<string, unknown> };
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
  // ⚠️ A queued DELETE outranks every other step, and this is the whole of that rule.
  //
  // The rep said remove this door. Filing its appointment, its calculator and its photos first —
  // onto a lead that is about to stop existing — is work nobody asked for, and each of those steps
  // is another chance for the record to stall on a 4xx and leave the delete un-run behind it. So a
  // record marked for deletion has exactly one applicable step.
  if (work.deleteLead && step !== 'delete') return false;
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
    case 'consent':
      return !!work.consents?.some((c) => !c.uploadedAt);
    case 'work':
      // ⚠️ Skipped once the lead has been RESULTED. The result is the stronger statement about
      // where the lead got to, and flipping a sold door back to `resume` on the ops board is worse
      // than not recording the check-in — which the activity log has recorded anyway.
      return !!work.workStarted && !work.submit;
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

/** Applicable, and not yet applied to the server. */
export const isStepPending = (work: OfflineLeadWork, step: UploadStep): boolean =>
  !work.done.includes(step) && isStepApplicable(work, step);

/**
 * Re-arm a step whose payload has just been rewritten.
 *
 * ⚠️ `done` means "the server has this", and for a FULL-STATE step that stops being true the
 * moment the rep edits again. Without this, a lead that drained once and was then worked offline a
 * second time stored the new state and never uploaded it: `nextUploadStep` skips anything in
 * `done`, so the writes sat on the device looking saved. Silent, and the rep has no way to see it.
 *
 * ⚠️ Only ever called for steps that are safe to repeat — `calculator` (creates only the tabs that
 * still lack an id), `calculatorState` and `outcome` (idempotent full-state PUTs). Re-arming a
 * step that POSTs a new record would file it twice; that is what `stepReplaySafety` is for.
 */
export const rearmStep = (work: OfflineLeadWork, step: UploadStep): OfflineLeadWork =>
  work.done.includes(step) ? { ...work, done: work.done.filter((s) => s !== step) } : work;

/**
 * Does this record hold Deal Center work the server has not got?
 *
 * ⚠️ The Deal Center asks this on OPEN, and the answer decides which copy the rep is shown. When it
 * is true the DEVICE is authoritative, because the record is by definition the writes that have not
 * reached the server yet — the server's copy can only be older. Reading the server there is what
 * made a rep's whole quote vanish: they built it with no signal, came back with a bar of signal,
 * and the screen dutifully painted the empty calculator the backend still had.
 */
export const hasUnsyncedDealCenter = (work: OfflineLeadWork | null | undefined): boolean =>
  !!work && (isStepPending(work, 'calculator') || isStepPending(work, 'calculatorState'));

/**
 * A record marked `uploaded` that has picked up NEW work goes back to `draft`.
 *
 * ⚠️ `uploadableWork` only drains `draft` records, and `rearmStep` only edits `done` — so before this,
 * a lead whose queue drained once and was then worked offline AGAIN stored the new state, re-armed
 * its steps, and still read `uploaded`. It never uploaded, and the pending banner (which also skips
 * `uploaded`) never mentioned it. Applied on every write (`putOfflineWork`), so a writer cannot
 * forget it — including a step that was never applicable before, which `rearmStep` cannot see.
 */
export const reopenIfPending = (work: OfflineLeadWork): OfflineLeadWork =>
  work.status === 'uploaded' && nextUploadStep(work) !== null
    ? { ...work, status: 'draft', attempts: 0, lastError: undefined }
    : work;

/** What a full-state step SENDS, so an edit made while it was in flight can be detected. */
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
    // ⚠️ Per-item steps compare the LIST of items, not their contents: the step itself stamps
    // `uploadedAt` on each as it lands, which is not an edit. A form or document added mid-run is.
    case 'consent':
      return (work.consents || []).map((c) => c.clientId);
    case 'documents':
      return (work.documents || []).map((d) => d.clientId);
    default:
      return undefined;
  }
};

/**
 * Did the rep change what this step sends while its request was in flight?
 *
 * ⚠️ The uploader marks a step done against the LATEST record. If the rep edited the Deal Center
 * during the `calculatorState` PUT, that edit re-armed nothing (the step was not in `done` yet) and
 * marking it done afterwards would record the edit as sent when the request carried the old state.
 * When this is true the caller marks the step done (keeping any ids it produced) and re-arms it.
 */
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

  const isIssued = payload.leadType === 'lfLead';

  return {
    // ⚠️ The CLIENT id, until the create lands. Every screen this opens must therefore guard with
    // `isClientId` before putting it in a URL.
    _id: workLeadId(work),
    clientId: work.clientId,
    /** The marker every offline-aware screen branches on. */
    __offline: true,
    __offlineStatus: work.status,
    leadType: payload.leadType || 'selfGen',
    /**
     * ⚠️ `'lfLead'`, NOT `'issued'` — and the difference is not cosmetic.
     *
     * `LeadCard` decides whether a lead has been worked with
     * `!NON_RESULTED_STATUSES.includes(lead.status)`, and that list is web parity:
     * `['lfLead', 'selfGenerated', 'scheduled']`. `'issued'` reads to it as a status it does not
     * recognise, i.e. as an OUTCOME — so an Issued Lead created at a door came back with a grey
     * RESULTED badge and `Resulted — issued` where its `Start Appointment` button should be. The
     * rep could not open the appointment they had just created.
     *
     * `'lfLead'` is what the server itself stores for an issued lead that has not been worked; it
     * is the value the Leads screen queries the Issued tab by. So the row now reads identically
     * before and after it uploads, which is the same rule the four header fields below follow.
     */
    status: isIssued ? 'lfLead' : 'selfGenerated',
    fullAddress: address,
    // ⚠️ The four fields below are what the Lead Center's own header prints, and they must
    // carry the SERVER's placeholders rather than blanks — not for tidiness, but because a
    // header with an empty value beside its label reads as data that failed to load, which on a
    // lead the rep just created is exactly the wrong thing to tell them. QA compared the two
    // screenshots side by side: online read `Lead ID: N/A` / `Lead Code: SelfGen` / a date / a
    // time, offline read a blank, `N/A`, an em dash and another blank.
    //
    // A self-gen lead genuinely has no issued id and no appointment window, and the backend
    // spells that absence `N/A` / `SelfGen`. Matching it means the same lead reads identically
    // before and after it uploads, so nothing on the header appears to CHANGE when the create
    // lands — which would otherwise look like the queued lead having been replaced by another.
    leadId: payload.lfLeadId || 'N/A',
    leadCode: payload.leadCode || (isIssued ? 'N/A' : 'SelfGen'),
    // The issued date the rep entered, else the moment they created it at the door. Without it
    // `formatDate` has nothing to format and the header shows the em-dash placeholder on a lead
    // that was created today.
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

/** True for a lead row this device is still holding — the list and Lead Center both branch on it. */
export const isOfflineLead = (lead: any): boolean => lead?.__offline === true;

// ─── The consent gate, before the form has uploaded ───────────────────────────

/**
 * The work record a screen's lead belongs to.
 *
 * ⚠️ Matches on BOTH ids, the rule `ensureOfflineWorkForLead` documents: a lead created offline is
 * addressed by the record's own `clientId`, one already on the server by `serverIds.leadId`.
 */
export const findWorkForLead = (
  items: OfflineLeadWork[] | undefined,
  leadId: string
): OfflineLeadWork | undefined => {
  const id = String(leadId || '');
  if (!id) return undefined;
  return (items || []).find((w) => w.clientId === id || w.serverIds.leadId === id);
};

/**
 * Has the customer signed a form of this kind that this device is still holding?
 *
 * ⚠️ This is what stops the consent gate re-closing in front of a customer who already signed.
 * `hasFiledConsentReport` reads the SERVER's record, which offline says no however many forms are
 * sitting in the queue — and after an app kill the screen's local "just signed" flag is gone too.
 * A queued form is a signed form; the only thing missing is the upload.
 *
 * ⚠️ An UPLOADED entry deliberately still counts. The server's own record is the better answer
 * once it exists, but the lead in hand may not have been refetched yet, and a gate that flickers
 * shut between the upload landing and the next fetch is the same failure one moment later.
 */
export const hasQueuedConsent = (
  items: OfflineLeadWork[] | undefined,
  leadId: string,
  kind: ConsentFormKind,
  onlyPending = false
): boolean => {
  const id = String(leadId || '');
  // ⚠️ EVERY record for the lead, not `findWorkForLead`'s first: a lead worked twice holds a drained
  // record ahead of the live one, and the form queued on the live one read as unsigned.
  return (
    !!id &&
    (items || []).some(
      (w) =>
        (w.clientId === id || w.serverIds.leadId === id) &&
        !!w.consents?.some((c) => c.kind === kind && !(onlyPending && c.uploadedAt))
    )
  );
};

/**
 * A signed form this device has NOT filed yet. The badge reads `hasQueuedConsent`; tapping the card
 * reads this, so a form that has already uploaded opens the server's PDF instead of claiming it is
 * still waiting for a connection.
 */
export const hasPendingConsent = (
  items: OfflineLeadWork[] | undefined,
  leadId: string,
  kind: ConsentFormKind
): boolean => hasQueuedConsent(items, leadId, kind, true);

// ─── Showing a job COMPLETED offline, before it has uploaded ────────────────────────

/**
 * The lead fields a finished-but-unsent job implies, ready to spread over the lead record.
 *
 * ⚠️ Without this the rep completes a job at a door, lands back on the Lead Center, and the
 * screen still shows **No demo / Reset / Not hit** and no contract card — i.e. it tells them the
 * job they just submitted never happened. Everything the screen needs is already in the stored
 * submit body; nothing here is invented, it is only re-addressed onto the record's own field
 * names so `JobDocsSection`'s `isResulted` / `hasContract` and the contract card can read it.
 *
 * ⚠️ `outcomeData` in `JobDocsSection` IS the lead object, so the money rows read these same
 * keys — which is what lets one overlay serve both the status and the figures.
 *
 * ⚠️ Returns null once the record has UPLOADED. From that point the server's own copy is the
 * truth and must win: it carries the filed document rows, the real ids, and any correction made
 * on the portal. An overlay that outlived the upload would quietly pin the screen to whatever the
 * device happened to send.
 */
export const offlineResultOverlay = (
  work: OfflineLeadWork | null | undefined
): Record<string, any> | null => {
  if (!work || work.status === 'uploaded') return null;
  const leadData = (work.submit as Record<string, any> | undefined)?.leadData as
    | Record<string, any>
    | undefined;
  if (!leadData) return null;

  // `buildSubmitLeadData` writes 'Sale' | 'Demo'; the lead record spells its status lowercase, and
  // that spelling is what `isResulted` / `hasContract` normalise against.
  const result = String(leadData.result || '').toLowerCase();
  if (result !== 'sale' && result !== 'demo') return null;

  return {
    status: result,
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
    /** So the screen can say the figures are the device's, not the server's confirmation. */
    __offlineResult: true,
  };
};

/**
 * The customer details a queued edit implies, ready to merge into `lead.customerDetails`.
 *
 * ⚠️ Without this the rep corrects a name or a phone number at the door, the modal closes, and the
 * header goes back to the old value the moment anything re-reads the lead — a relaunch, a focus
 * refetch, the cached detail record. The edit is not lost (it is in the upload store) but the
 * screen says it is, which is the failure this repo has already shipped twice.
 *
 * ⚠️ Null once the record has UPLOADED, for the same reason `offlineResultOverlay` is: from that
 * point the server's copy is the truth, including any correction made on the portal.
 */
export const offlineCustomerOverlay = (
  work: OfflineLeadWork | null | undefined
): Record<string, any> | null => {
  if (!work || work.status === 'uploaded') return null;
  const payload = work.customer?.payload as Record<string, any> | undefined;
  if (!payload || work.done.includes('customer')) return null;
  return payload;
};

/**
 * The lead as the screen should render it: the record, plus anything this device has done but not
 * yet sent — a job finished at the door, and a customer's details corrected there.
 *
 * ⚠️ Returns the SAME object when there is nothing to overlay. Every consumer of the Lead
 * Center's `lead` is in a dependency array somewhere; handing back a fresh object each render
 * would re-run the photo resolution and the hydrate on every tick.
 */
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
    // ⚠️ MERGED into `customerDetails`, not spread flat like the result overlay. The queued
    // payload is the PATCH body — first/last/phone/email/address/coBuyers — and the record's own
    // `_id` and everything else on that sub-object has to survive it, `_id` above all: it is what
    // the next edit addresses its PATCH by.
    out.customerDetails = { ...(out.customerDetails || {}), ...customer };
    // The header reads `fullAddress` first, so an address correction has to reach both.
    if (customer.address) out.fullAddress = customer.address;
  }
  return out as T;
};

// ─── Lead-level actions the rep took with no signal ─────────────────────────

/**
 * Every id a record with an UN-RUN delete answers to — both of them, deliberately.
 *
 * ⚠️ A lead created at the door is drawn from `workLeadId`, which is the client id until the
 * create lands and the server id afterwards, so a set holding only one of the two lets the row
 * back onto the list the moment the record moves between those states. The Leads list has no other
 * defence: `removeLocalLead` prunes the query cache, and the next refetch — or the cached list a
 * relaunch serves — puts the deleted door straight back in front of the rep.
 */
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

/**
 * Lead id -> the archive state this device holds and the server does not.
 *
 * Keyed by BOTH ids for the reason above. `true` means "archived here, still listed as active on
 * the server"; `false` is the un-archive, which has to move the row the other way.
 */
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

/**
 * The rows to draw on the ARCHIVED tab for leads archived with no signal.
 *
 * ⚠️ Snapshots, and they are held for a reason rather than for completeness: the archived list
 * is a separate server query, so a lead archived offline is in neither it nor Today. It would
 * simply be gone — indistinguishable from the delete the rep did not perform.
 *
 * A lead the ARCHIVED list already carries is skipped, so the PATCH landing swaps the snapshot for
 * the server's own row rather than printing the lead twice.
 */
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

/** How the Leads list hands a row over from this device to the server. See below. */
export interface OfflineLeadsForTabOptions {
  /**
   * The lead ids the SERVER list already carries, so a lead that has landed is drawn once.
   *
   * ⚠️ Without this a record whose CREATE has landed but whose remaining work is still
   * uploading shows TWICE the moment anything refetches the list — once from the server and once
   * from this projection, both for the same door.
   */
  serverLeadIds?: Iterable<string> | null | undefined;
  /**
   * Records that finished uploading a moment ago and whose server row has not arrived yet.
   *
   * ⚠️ This is the whole of the handover, and without it the rep watches their lead VANISH.
   * The drain marks a record `uploaded` the instant its last step lands, which drops it from the
   * projection — but the server list in hand was fetched before the lead existed, so for the
   * length of one refetch there is no row from either source and the list paints its empty state.
   * QA reported exactly that: "it automatically uploaded but disappear from here, it will only show
   * when i pull to refresh".
   */
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

/**
 * The offline rows belonging to one tab of the Leads list.
 *
 * ⚠️ Scoped by lead TYPE, so a self-gen created at the door does not appear under Issued (and an
 * Issued Lead entered offline does not land in Self Gens, where the rep would never look for it).
 *
 * The two options implement one rule between them: **a door is shown exactly once, and never by
 * nobody.** A record is projected while the server has no row for it, and dropped the moment the
 * server does — so the handover happens on the refetch rather than on the upload, and there is no
 * frame in which the lead belongs to neither source.
 */
export const offlineLeadsForTab = (
  items: OfflineLeadWork[] | null | undefined,
  leadType: 'selfGen' | 'lfLead',
  options?: OfflineLeadsForTabOptions
): Record<string, any>[] => {
  const onServer = idSet(options?.serverLeadIds);
  const bridging = idSet(options?.keepUploaded);
  return (items || [])
    // ⚠️ A door the rep DELETED is never projected, whatever else the record says. Without this
    // the handover hold below would put it back on screen the moment the delete landed, because
    // that transition is exactly what `keepUploaded` is watching for.
    .filter((w) => !w.deleteLead)
    .filter((w) => w.status !== 'uploaded' || bridging.has(w.clientId))
    // ⚠️ `workLeadId`, not `clientId` — it is the SERVER id once the create has landed, which is
    // the only id the server list could ever match. A record that has not been filed yet resolves
    // to its client id, which no server row can carry, so this is a no-op for it.
    .filter((w) => !onServer.has(workLeadId(w)))
    // ⚠️ NEWEST FIRST, matching what the rep sees once these land. The store keeps records in
    // the order they were created, so two leads knocked one after the other listed OLDEST first
    // offline and flipped round on upload — the same two doors in a different order depending on
    // the signal, which is exactly the kind of thing a rep reads as the app losing track.
    // Sorted on a COPY: the array belongs to the store, and sorting it in place would reorder
    // every other reader of it, the upload drain included.
    .slice()
    .sort((a, b) => createdAtMs(b) - createdAtMs(a))
    .map(offlineWorkToLead)
    .filter((l): l is Record<string, any> => !!l && (l.leadType === leadType));
};

/** `createdAt` as a number, and 0 for anything unparseable — never `NaN`, which breaks a sort. */
const createdAtMs = (work: OfflineLeadWork): number => {
  const at = Date.parse(String(work?.createdAt || ''));
  return Number.isNaN(at) ? 0 : at;
};

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

/**
 * Records the rep still has a reason to see.
 *
 * ⚠️ "Something to upload" — NOT merely "not uploaded". A record is opened for a lead the moment
 * its Deal Center is opened, so that a connection dropping mid-quote has somewhere to write; an
 * empty one of those has nothing outstanding and must not be announced as
 * "1 lead not yet on the server", which would put a permanent banner over a rep working online.
 *
 * A record needing ATTENTION is shown whatever its contents — that is the whole point of it.
 */
export const activeWork = (items: OfflineLeadWork[] | null | undefined): OfflineLeadWork[] =>
  (items || []).filter(
    (w) =>
      w.status !== 'uploaded' &&
      (w.status === 'failed' || w.status === 'needs-review' || nextUploadStep(w) !== null)
  );

/**
 * The id a screen should address this lead by: the server's once known, else the client's.
 *
 * ⚠️ Read THROUGH this rather than `lead._id` anywhere that runs offline, and pair it with
 * `isClientId` before putting the result in a URL.
 */
export const workLeadId = (work: OfflineLeadWork): string =>
  work.serverIds.leadId || work.clientId;
