/**
 * offlineLeadStore.ts — the device half of a lead worked with no signal.
 *
 * The DECISIONS live in `utils/offline-lead-work.ts` (pure, tested). This file is what needs the
 * device: MMKV storage, the step-by-step upload, the guarded reads, and the reconnect hook.
 * Shape follows `offlineLeadQueue.ts`, which does the same job for the lead create alone.
 *
 * ## The upload is a RESUME, not a replay
 *
 * `work.done` names the steps already applied to the server, so a failure part-way through picks
 * up at the next one rather than starting over. A step that recorded a server id is never re-run.
 *
 * ## The happy path makes no reads
 *
 * Work created offline has nothing on the server to look for, so the uploader posts straight
 * through. The `getAppointments` / `getCalculators` reads fire in exactly one situation: retrying a
 * create whose outcome was AMBIGUOUS (a timeout, a 5xx), where the request may or may not have
 * been committed and only the server can say. That is what buys idempotency with no backend change.
 */

import { AppState } from 'react-native';
import RNFS from 'react-native-fs';
import { storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { fetchOutcomeDocumentRows } from '../screens/DynamicDealCenter/utils/outcome-documents';
import { buildDocumentPayloads } from '../screens/DynamicDealCenter/utils/document-payloads';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import { isOwnedBy } from '../utils/session-scope';
import { uploadQueueManager } from '../utils/uploadQueue';
import { describeQueuedLead, isSuccessfulCreate, messageOfError } from '../utils/offline-lead-queue';
import {
  applyResolvedAddress,
  coordsFromLeadPayload,
  needsAddressResolution,
  resolveSyncAddress,
} from '../utils/offline-lead-location';
import { reverseGeocode } from '../utils/places';
import { queryClient } from './api/queryClient';
import { rekeyLeadWorkflow } from './offlineLeadStatus';
import { leadDetailForCache } from '../utils/offline-lead-detail-cache';
import { submitConsentForm, finalizeConsentUpload } from './api/consent-forms';
import {
  consentSignatureName,
  hasFiledConsentReport,
  splitConsentPayload,
  type ConsentFormKind,
} from '../utils/consent-forms';
import {
  applyStepDecision,
  adoptExistingWork,
  createOfflineWork,
  buildIdMap,
  decideAfterStepError,
  findUnresolvedClientIds,
  isStepPending,
  markStepDone,
  newWorkId,
  nextUploadStep,
  readCreatedId,
  rearmStep,
  reopenIfPending,
  stepPayloadChanged,
  readExistingAppointmentId,
  resolveClientIds,
  documentRootKey,
  offlineDocumentName,
  uploadableWork,
  type OfflineCalculatorWork,
  type OfflineDocumentCategory,
  type OfflineConsentForm,
  type OfflineJobDocument,
  type OfflineLeadWork,
  type StepDecision,
  type UploadStep,
} from '../utils/offline-lead-work';

const STORE_KEY = 'offline_lead_work';

let store: OfflineLeadWork[] = [];
let draining = false;
let loaded = false;
const listeners = new Set<() => void>();

// ─── Storage ──────────────────────────────────────────────────────────────────

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const saved = storage.getString(STORE_KEY);
    store = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(store)) store = [];
    // ⚠️ Anything a crash left mid-upload returns to `draft`. A record stuck on `uploading` forever
    // reads to the rep as work that vanished — the same rule `offlineLeadQueue` applies to `sending`.
    store = store
      .filter(Boolean)
      .map((w): OfflineLeadWork => (w.status === 'uploading' ? { ...w, status: 'draft' } : w));
  } catch (e) {
    console.warn('[leadStore] could not read the store', e);
    store = [];
  }
};

const persist = (): void => {
  try {
    storage.set(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[leadStore] could not write the store', e);
  }
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a bad listener must not stop the upload */
    }
  });
};

// ─── Ownership ────────────────────────────────────────────────────────────────

/**
 * The records belonging to the rep signed in right now.
 *
 * ⚠️ Every read goes through this, and so does the DRAIN — that second one is the half with teeth.
 * Hiding another rep's queued lead from the list is a display fix; refusing to UPLOAD it is what
 * stops a lead one rep took at a door being filed under the next rep's token, onto their company's
 * data, where nobody would ever connect it back.
 *
 * A record with no owner (written before ownership existed) belongs to nobody and is excluded by
 * the same rule — inert rather than misattributed. See `utils/session-scope.ts`.
 */
const mine = (): OfflineLeadWork[] => {
  const owner = getSessionOwner();
  return store.filter((w) => isOwnedBy(w.ownerId, owner));
};

// ⚠️ MMKV is only half of it: this module keeps the parsed array in `store`, so a wipe that did not
// reach here would be undone by the next write. `loaded` goes back to false so the next read
// re-reads what is now an empty key.
registerSessionResetHook(() => {
  store = [];
  loaded = false;
});

// ─── Public reads ─────────────────────────────────────────────────────────────

export const getOfflineWork = (): OfflineLeadWork[] => {
  load();
  return mine();
};

export const findOfflineWork = (clientId: string): OfflineLeadWork | undefined => {
  load();
  return mine().find((w) => w.clientId === clientId || w.serverIds.leadId === clientId);
};

export const subscribeOfflineWork = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// ─── Public writes ────────────────────────────────────────────────────────────

/**
 * Create or replace a record. This is the ONE write the screens use — they hand over the current
 * state of the lead they are editing, and it is stored whole.
 *
 * ⚠️ Replacing rather than appending is what makes coalescing a non-problem: 500 keystrokes in the
 * Deal Center are 500 calls to this and still exactly one upload, because what is stored is the
 * current VALUE and not a log of edits.
 */
export const putOfflineWork = (work: OfflineLeadWork): OfflineLeadWork => {
  load();
  // ⚠️ `work.ownerId ||`, never a bare overwrite. This is the only write, so a patch during a
  // different rep's session would otherwise TRANSFER a record to them — the leak, inverted.
  // `reopenIfPending`: an `uploaded` record that has just been given new work must drain again.
  const next = reopenIfPending({
    ...work,
    ownerId: work.ownerId || getSessionOwner(),
    updatedAt: new Date().toISOString(),
  });
  const i = store.findIndex((w) => w.clientId === work.clientId);
  store = i === -1 ? [...store, next] : store.map((w, n) => (n === i ? next : w));
  persist();
  return next;
};

/** Apply a change to one record without the caller having to re-read the store. */
export const patchOfflineWork = (
  clientId: string,
  change: (work: OfflineLeadWork) => OfflineLeadWork
): OfflineLeadWork | null => {
  load();
  const current = store.find((w) => w.clientId === clientId);
  if (!current) return null;
  return putOfflineWork(change(current));
};

/**
 * Park a lead the rep created with no signal. Returns the record, whose `clientId` is the handle
 * everything they do next — the appointment, the calculator, the job — hangs off.
 */
export const enqueueOfflineLead = (payload: Record<string, unknown>): OfflineLeadWork =>
  putOfflineWork(createOfflineWork(payload, describeQueuedLead(payload)));

/**
 * Begin working a lead that is ALREADY on the server with no signal.
 *
 * ⚠️ Returns the record that exists if there is one, rather than starting a second. Two records for
 * one lead would upload two appointments and two calculators onto it.
 */
export const beginOfflineWorkOnLead = (
  leadId: string,
  label: string,
  seed: Parameters<typeof adoptExistingWork>[2] = {}
): OfflineLeadWork => {
  load();
  // ⚠️ `mine()`, not `store`: adopting another rep's half-finished record for the same lead would
  // hand them its queued appointment and calculators, and upload the pair as one.
  const existing = mine().find((w) => w.serverIds.leadId === leadId && w.status !== 'uploaded');
  return existing || putOfflineWork(adoptExistingWork(leadId, label, seed));
};

/**
 * The record for the lead a screen is open on — READ ONLY, never started.
 *
 * ⚠️ Deliberately distinct from `ensureOfflineWorkForLead`, and both halves of the difference
 * matter. It creates nothing, so a screen may ask "is anything stored for this lead?" on mount
 * without filing a record for every lead the rep merely opens. And unlike that function it does
 * NOT skip an `uploaded` record: once the queue has drained, that record is still the only copy of
 * the build this device has, and offline it is the one thing standing between the rep and an empty
 * screen. Whether it is authoritative is a separate question — see `resolveJobBuildSource`.
 */
export const findOfflineWorkForLead = (lead: any): OfflineLeadWork | undefined => {
  load();
  const id = String(lead?._id || lead?.id || '');
  if (!id) return undefined;
  const rows = mine().filter((w) => w.clientId === id || w.serverIds.leadId === id);
  // A lead worked twice can hold a drained record and a live one; the live one is the truth.
  return rows.find((w) => w.status !== 'uploaded') || rows[0];
};

/**
 * The record for the lead a screen is open on — found, or started.
 *
 * ⚠️ Matches on BOTH ids. A lead created offline is addressed by the record's own `clientId`
 * (that is what `offlineWorkToLead` puts in `_id`), while one already on the server is addressed
 * by `serverIds.leadId`. Checking only one of them starts a SECOND record for the same lead, which
 * would upload a second appointment and a second calculator onto it.
 */
export const ensureOfflineWorkForLead = (lead: any): OfflineLeadWork | null => {
  load();
  const id = String(lead?._id || lead?.id || '');
  if (!id) return null;

  // ⚠️ A DRAINED record is reused too (live one first). Starting a second record here — which is
  // what skipping `uploaded` did — drops the server ids the first one learned: the appointment and
  // calculator ids. The Deal Center then files a SECOND appointment and a SECOND calculator, and a
  // lead created at a door is re-adopted under its CLIENT id. Reusing it is safe because
  // `putOfflineWork` reopens it the moment it is given new work (`reopenIfPending`).
  const rows = mine().filter((w) => w.clientId === id || w.serverIds.leadId === id);
  const existing = rows.find((w) => w.status !== 'uploaded') || rows[rows.length - 1];
  if (existing) return existing;

  // Not ours yet: a lead that exists on the server, being worked offline for the first time.
  const c = lead?.customerDetails || {};
  return putOfflineWork(
    adoptExistingWork(id, describeQueuedLead({ customer: c, fullAddress: lead?.fullAddress }))
  );
};

/**
 * Store the Deal Center's current state — the appointment that will need creating and every
 * calculator, each holding exactly the body its `PUT /lfcalculators/{id}` would have sent.
 *
 * ⚠️ It REPLACES the calculator list rather than merging. That is what makes a deleted tab actually
 * disappear, and it is safe because the caller always passes every tab it holds.
 */
export const saveOfflineDealCenter = (
  workClientId: string,
  data: {
    appointment?: Record<string, unknown>;
    appointmentClientId?: string;
    appointmentServerId?: string;
    calculators: OfflineCalculatorWork[];
  }
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) => {
    const next: OfflineLeadWork = {
      ...w,
      appointment: data.appointment ?? w.appointment,
      appointmentClientId: data.appointmentClientId ?? w.appointmentClientId,
      serverIds: data.appointmentServerId
        ? { ...w.serverIds, appointmentId: data.appointmentServerId }
        : w.serverIds,
      calculators: data.calculators,
    };
    // ⚠️ Both steps are re-armed, because the state they were marked done against has just been
    // replaced. A lead worked offline, drained, then worked offline AGAIN would otherwise store the
    // second session and never upload it — `nextUploadStep` skips anything already in `done`, so
    // the record sat there looking saved. Safe to repeat: `calculator` creates only the tabs that
    // still lack a server id, and `calculatorState` is an idempotent full-state PUT.
    return rearmStep(rearmStep(next, 'calculator'), 'calculatorState');
  });

/**
 * The Job Builder's draft autosave, with no signal.
 *
 * Same body the online `PUT lead/v1/{leadId}/outcome/{calcId}` would carry, stored rather than
 * sent. It is a full-state write, so the last one before the network returns is the one that goes —
 * the rep's edits coalesce for free instead of queueing one request per keystroke.
 *
 * ⚠️ Documents are NOT read out of this body. They travel as `work.documents` so each is filed
 * exactly once; leaving them here as well would file every one of them again on every draft write.
 */
export const saveOfflineJobBuilderDraft = (
  workClientId: string,
  outcome: Record<string, unknown>,
  outcomeCalculatorClientId?: string
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) =>
    // Re-armed for the same reason as the Deal Center's two steps above: this is a full-state PUT
    // and the state has just changed, so "the server has this" has stopped being true.
    rearmStep(
      {
        ...w,
        outcome: stripDocumentKeys(outcome),
        outcomeCalculatorClientId: outcomeCalculatorClientId ?? w.outcomeCalculatorClientId,
      },
      'outcome'
    )
  );

/**
 * Queue a document captured at the door — a device-signed agreement, or a scanned order sheet.
 *
 * Returns the stored record so the caller can put the SAME name and body into `jobState`, which is
 * what lets the Summary tab show the document immediately instead of an empty card.
 */
export const addOfflineJobDocument = async (
  workClientId: string,
  category: OfflineDocumentCategory,
  doc: { uri: string; contentType: string; extension?: string; name?: string }
): Promise<OfflineJobDocument | null> => {
  // ⚠️ Always our own name, never the scanner's. The guarded replay matches on it, and two pages
  // scanned at one door both arrive called "document".
  const name = doc.name || offlineDocumentName(category, doc.extension || 'pdf');
  const uri = await persistOfflineDocumentFile(doc.uri, name);
  const entry: OfflineJobDocument = {
    clientId: newWorkId('doc'),
    category,
    name,
    uri,
    contentType: doc.contentType,
  };
  // Re-armed: the step files only documents still lacking `uploadedAt`, so running it again is
  // safe — and without it a document captured after an earlier drain was never filed.
  const saved = patchOfflineWork(workClientId, (w) =>
    rearmStep({ ...w, documents: [...(w.documents || []), entry] }, 'documents')
  );
  return saved ? entry : null;
};

/**
 * Queue a Customer Consent Form or Roof Waiver the customer just signed with no signal.
 *
 * ⚠️ Queueing it is only half of what this does. The consent is the GATE — no quote may be
 * presented until one is signed — and the server's `generatedReports` is what every "is it signed?"
 * check reads. Offline that answer is no, and after an app kill the screen's own "just signed" flag
 * is gone too, so without this record the gate would close again in front of a customer who has
 * already signed. `hasQueuedConsent` reads it back.
 */
export const queueOfflineConsent = async (
  workClientId: string,
  kind: ConsentFormKind,
  data: any,
  opts: { knownFiledBefore?: boolean } = {}
): Promise<OfflineConsentForm | null> => {
  const { fields, signature } = splitConsentPayload(data);
  const sig = signature as { uri: string; name?: string; type?: string } | null;

  // ⚠️ The modal writes every signature as `signature.svg` into the CACHES directory. Fine for a
  // form posted and forgotten; not for one that has to survive an app kill and sit beside other
  // queued signatures in one folder. Its own name, in the documents directory.
  const signatureUri = sig?.uri
    ? await persistOfflineDocumentFile(sig.uri, consentSignatureName(kind))
    : undefined;

  const entry: OfflineConsentForm = {
    clientId: newWorkId('consent'),
    kind,
    payload: fields,
    signatureUri,
    signatureName: sig?.name || 'signature.svg',
    signatureType: sig?.type || 'image/svg+xml',
    knownFiledBefore: !!opts.knownFiledBefore,
  };

  // ⚠️ Re-armed. A consent form that already synced left `consent` in `done`, so a roof waiver
  // signed afterwards was stored, badged, and never filed. Safe: the step posts only forms still
  // lacking `uploadedAt`.
  const saved = patchOfflineWork(workClientId, (w) =>
    rearmStep({ ...w, consents: [...(w.consents || []), entry] }, 'consent')
  );
  return saved ? entry : null;
};

/** Record how far ONE queued form got, the instant it gets there. */
const patchOfflineConsent = (
  workClientId: string,
  consentClientId: string,
  change: Partial<OfflineConsentForm>
): void => {
  patchOfflineWork(workClientId, (w) => ({
    ...w,
    consents: (w.consents || []).map((c) =>
      c.clientId === consentClientId ? { ...c, ...change } : c
    ),
  }));
};

/**
 * Put the document somewhere it will still be when the network returns.
 *
 * ⚠️ A capture arrives either as a `data:` URI held in memory or as a path in the CACHES directory,
 * and neither survives what this queue has to survive: the app can be killed, and iOS empties
 * caches under storage pressure. A queued document that evaporates is a signed contract the rep
 * believes was filed. So it is copied into the documents directory, under its own queue name.
 */
const persistOfflineDocumentFile = async (source: string, name: string): Promise<string> => {
  const dir = `${RNFS.DocumentDirectoryPath}/offline-job-documents`;
  await RNFS.mkdir(dir);
  const dest = `${dir}/${name}`;

  if (/^data:/i.test(source)) {
    await RNFS.writeFile(dest, source.slice(source.indexOf(',') + 1), 'base64');
    return `file://${dest}`;
  }
  const from = source.startsWith('file://') ? source.replace('file://', '') : source;
  await RNFS.copyFile(from, dest);
  return `file://${dest}`;
};

/** Delete a queued document's file once the server has it, or once the rep drops it. */
const discardOfflineDocumentFile = (uri?: string): void => {
  if (!uri) return;
  RNFS.unlink(uri.replace('file://', '')).catch(() => {
    // Already gone, or never written. Nothing to report — the row is what matters.
  });
};

/**
 * The rep took the customer's number so they can sign on their own phone, with no signal.
 *
 * ⚠️ Stored, not appended — one lead has ONE outstanding signing session, and the server refuses a
 * second with a 409. If the rep corrects a mistyped number before the upload runs, the correction
 * must replace the request rather than queue beside it.
 */
export const queueOfflineRemoteSignature = (
  workClientId: string,
  payload: Record<string, unknown>
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) => ({ ...w, remoteSignature: payload }));

/** Drop a queued document the rep removed before it was ever filed. */
export const removeOfflineJobDocument = (workClientId: string, docClientId: string): void => {
  const doomed = findOfflineWork(workClientId)?.documents?.find(
    (d) => d.clientId === docClientId && !d.uploadedAt
  );
  patchOfflineWork(workClientId, (w) => ({
    ...w,
    documents: (w.documents || []).filter((d) => d.clientId !== docClientId || !!d.uploadedAt),
  }));
  discardOfflineDocumentFile(doomed?.uri);
};

/**
 * The rep finished the job with no signal.
 *
 * ⚠️ This is the ONLY thing that arms the `submit` step, and it must stay that way: a lead whose
 * job was built but not completed has to upload its draft and then stop, exactly as a rep who walks
 * away mid-build expects.
 */
export const completeOfflineJobBuilder = (
  workClientId: string,
  submit: Record<string, unknown>,
  outcome?: Record<string, unknown>
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) => ({
    ...w,
    outcome: outcome ? stripDocumentKeys(outcome) : w.outcome,
    submit: stripDocumentKeys(submit),
    status: 'draft',
  }));

/**
 * Remove the document bodies from a stored payload.
 *
 * ⚠️ The reason is the duplicate this repo has already shipped once: the submit re-sent base64 for
 * documents the sign endpoint had already filed, and the backend APPENDED them (CLAUDE.md, "the
 * backend files a SECOND agreement row on submit"). Offline that risk is worse, because a stored
 * payload is re-sent whenever an upload resumes. The documents step owns filing; nothing else does.
 */
// ─── Archiving and deleting a lead with no signal ───────────────────────────

/** The record this lead answers to — whichever id the caller is holding. */
const workForLead = (lead: any): { id: string; work?: OfflineLeadWork } => {
  load();
  const id = String(lead?._id || lead?.id || '');
  if (!id) return { id: '' };
  // ⚠️ `mine()`, not `store` — acting on another rep's record would queue THEIR lead for deletion.
  // Uploaded records are deliberately included: a lead whose offline session already drained can
  // still be archived or deleted, and reusing its record keeps one row per lead.
  return { id, work: mine().find((w) => w.clientId === id || w.serverIds.leadId === id) };
};

const labelForLead = (lead: any): string =>
  describeQueuedLead({ customer: lead?.customerDetails || {}, fullAddress: lead?.fullAddress });

/**
 * The rep started or resumed this appointment with no signal.
 *
 * The card is coloured immediately by `markLeadCheckedInOffline`; this is the half that tells the
 * SERVER, so the office learns the door was worked and the state survives the local mark ageing out.
 */
export const queueLeadWorkStart = (lead: any, userId: string): boolean => {
  const { id, work } = workForLead(lead);
  if (!id || !userId) return false;
  const base = work || adoptExistingWork(id, labelForLead(lead));
  // ⚠️ The FIRST check-in of the session wins — re-arriving at the same door does not need a
  // second PUT, and overwriting would only move the timestamp we are already not sending.
  if (base.workStarted) return true;
  putOfflineWork({
    ...base,
    workStarted: { userId, at: new Date().toISOString() },
    status: base.status === 'uploaded' ? 'draft' : base.status,
    label: base.label || labelForLead(lead),
  });
  runUpload();
  return true;
};

/**
 * The rep corrected the customer's details with no signal.
 *
 * ⚠️ TWO things happen, and neither is redundant. The PATCH is queued so the correction reaches
 * the server whatever state the lead is in; and when the lead's own CREATE has not run yet, the
 * five fields the create body carries are folded into it as well, so the lead is filed with the
 * right name and address the first time rather than being filed wrong and corrected a request
 * later. (The create body has no `coBuyers`, which is exactly why the PATCH is still queued.)
 */
export const queueCustomerUpdate = (lead: any, payload: Record<string, unknown>): boolean => {
  const { id, work } = workForLead(lead);
  if (!id) return false;
  const base = work || adoptExistingWork(id, labelForLead(lead));

  // ⚠️ The CUSTOMER record's id, and only that. `handleCustomerSubmit` falls back to the lead's
  // own `_id` when building the online url; inheriting that fallback here would file this rep's
  // edit against the wrong document. An unknown id is left blank and resolved at upload time,
  // where there is a connection to read the lead with.
  const customerId = String(
    lead?.customerDetails?._id || lead?.customerDetails?.id || ''
  ).trim();

  const creatingLead = base.origin === 'created-offline' && isStepPending(base, 'lead');
  const leadBody = creatingLead ? ((base.lead || {}) as Record<string, any>) : null;
  const address = payload.address as string | undefined;

  putOfflineWork(
    // ⚠️ Re-armed for the same reason `archive` is: a rep who corrects a spelling twice offline
    // must have the LAST version sent. Safe because the PATCH carries the whole record.
    rearmStep(
      {
        ...base,
        customer: { customerId, payload },
        lead: leadBody
          ? {
              ...leadBody,
              fullAddress: address || leadBody.fullAddress,
              customer: {
                ...((leadBody.customer as Record<string, any>) || {}),
                firstName: payload.firstName,
                lastName: payload.lastName,
                phone: payload.phone,
                email: payload.email,
                address: address || (leadBody.customer as any)?.address,
              },
            }
          : base.lead,
        status: 'draft',
        attempts: 0,
        lastError: undefined,
        label: base.label || labelForLead(lead),
      },
      'customer'
    )
  );
  runUpload();
  return true;
};

/** Queued, or discarded outright because the server had never heard of the lead. */
export type OfflineDeleteOutcome = 'queued' | 'discarded';

/**
 * Delete a lead with no signal.
 *
 * ⚠️ A lead the rep created at the door and then deleted before it uploaded is DISCARDED, not
 * queued. There is nothing on the server to remove, so the only honest action is to forget it —
 * and queueing the pair would file the lead on the portal for however long the create and the
 * delete take to land, which is a real row the office can see and act on in between.
 */
export const queueLeadDelete = (lead: any): OfflineDeleteOutcome | null => {
  const { id, work } = workForLead(lead);
  if (!id) return null;

  if (work && work.origin === 'created-offline' && !work.serverIds.leadId) {
    uploadQueueManager.dropLead(work.clientId);
    removeOfflineWork(work.clientId);
    return 'discarded';
  }

  const base = work || adoptExistingWork(id, labelForLead(lead));
  // Both ids, because photos queued before the create landed are still addressed by the client one.
  uploadQueueManager.dropLead(base.clientId);
  uploadQueueManager.dropLead(base.serverIds.leadId || id);
  putOfflineWork({
    ...base,
    deleteLead: true,
    status: 'draft',
    attempts: 0,
    lastError: undefined,
    label: base.label || labelForLead(lead),
  });
  runUpload();
  return 'queued';
};

/**
 * Archive — or un-archive — a lead with no signal.
 *
 * The snapshot is what lets the Archived tab draw the row before the PATCH lands; see
 * `offlineArchivedLeads`. It is pruned first, because a lead record can carry base64 documents and
 * this store is MMKV, which rewrites itself whole on every write.
 */
export const queueLeadArchive = (lead: any, isArchive: boolean): boolean => {
  const { id, work } = workForLead(lead);
  if (!id) return false;

  const base = work || adoptExistingWork(id, labelForLead(lead));
  const snapshot = leadDetailForCache({ ...(lead || {}), isArchive }) as
    | Record<string, unknown>
    | null;
  putOfflineWork(
    // ⚠️ Re-armed: a rep who archives, un-archives and archives again offline must have the LAST
    // of those sent. Without this the second change sits in the record looking saved and never goes.
    rearmStep(
      {
        ...base,
        archive: { isArchive, lead: snapshot || undefined },
        status: 'draft',
        attempts: 0,
        lastError: undefined,
        label: base.label || labelForLead(lead),
      },
      'archive'
    )
  );
  runUpload();
  return true;
};

const DOCUMENT_BODY_KEYS = ['agreements', 'orderSheets', 'paperWork', 'downPaymentReceipt'];

const stripDocumentKeys = (payload: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(payload || {}).filter(([k]) => !DOCUMENT_BODY_KEYS.includes(k))
  );

export const removeOfflineWork = (clientId: string): void => {
  load();
  store = store.filter((w) => w.clientId !== clientId);
  persist();
};

/** The rep has looked and wants it sent — clears the parked status and the attempt count. */
export const retryOfflineWork = (clientId: string): void => {
  patchOfflineWork(clientId, (w) => ({ ...w, status: 'draft', attempts: 0, lastError: undefined }));
  runUpload();
};

// ─── The guarded reads ────────────────────────────────────────────────────────
//
// Each answers one question: "did my earlier attempt actually land?" They run ONLY on a
// `retry-guarded` decision, never on the happy path.

const idOf = (row: any): string => String(row?._id || row?.id || '');

/** A 409 in any of the shapes this API and the axios interceptor produce. */
const readIs409 = (err: any): boolean => {
  const body = err?.response?.data ?? err;
  return (
    body?.code === 409 ||
    err?.response?.status === 409 ||
    err?.status === 409 ||
    /already has an appointment/i.test(String(body?.message || err?.message || ''))
  );
};

/** A 404 / "not found" in any of the shapes this API and the axios interceptor produce. */
const readIsNotFound = (err: any): boolean => {
  const body = err?.response?.data ?? err;
  return (
    body?.code === 404 ||
    err?.response?.status === 404 ||
    err?.status === 404 ||
    /not\s*found|does not exist|already deleted/i.test(String(body?.message || err?.message || ''))
  );
};

/**
 * Did a `POST /appointments` for this lead already land?
 *
 * ⚠️ Matched exactly the way `resolveAppointmentId` in the Deal Center matches, and the reason is
 * easy to get wrong: an appointment's `leadId` is the HUMAN lead id ("504") while the mongo id
 * lives on `selfGenLeadId`. Comparing the server lead `_id` against `leadId` — which is what this
 * did first — matches nothing on a self-gen lead, so the guard silently reports "not created" and
 * files a second appointment.
 */
const findExistingAppointment = async (
  work: OfflineLeadWork,
  appointment: Record<string, any>
): Promise<string | null> => {
  const humanLeadId = appointment?.leadId;
  const selfGenLeadId = appointment?.selfGenLeadId || work.serverIds.leadId;
  if (!humanLeadId && !selfGenLeadId) return null;

  const leadDate = appointment?.leadDate;
  const res = await LeadService.getAppointments(leadDate ? { lead_date: leadDate } : undefined);
  const rows: any[] = res?.data?.data || res?.data || [];
  const match = (Array.isArray(rows) ? rows : []).find(
    (r) =>
      (r?.leadId && r.leadId !== 'N/A' && String(r.leadId) === String(humanLeadId)) ||
      (r?.selfGenLeadId && r.selfGenLeadId !== 'N/A' && String(r.selfGenLeadId) === String(selfGenLeadId))
  );
  return match ? idOf(match) || null : null;
};

/**
 * Calculators already on this appointment that we have not claimed.
 *
 * ⚠️ Adopting the UNCLAIMED ones is what makes this safe for both origins. Work created offline
 * gets a brand-new appointment, so anything on it was written by our own earlier attempt; an
 * existing lead's pre-existing calculators are already in `serverIds.calculators` from hydration,
 * so they are claimed and cannot be adopted twice.
 */
const findUnclaimedCalculators = async (work: OfflineLeadWork): Promise<string[]> => {
  const apptId = work.serverIds.appointmentId;
  if (!apptId) return [];
  const res = await LeadService.getCalculators(apptId);
  const rows: any[] = res?.data?.data || res?.data || [];
  const claimed = new Set(Object.values(work.serverIds.calculators));
  return (Array.isArray(rows) ? rows : [])
    .map(idOf)
    .filter((id) => id && !claimed.has(id));
};

/**
 * WHICH calculator the outcome and its documents hang off.
 *
 * ⚠️ Shared by both steps deliberately. That id is in the URL, and a documents PUT addressed to a
 * different calculator than the draft files the agreement where nothing looks for it.
 */
const resolveOutcomeCalculatorId = (work: OfflineLeadWork): string | undefined => {
  const clientId = work.outcomeCalculatorClientId || work.calculators[0]?.clientId;
  if (!clientId) return undefined;
  return (
    work.serverIds.calculators[clientId] ||
    work.calculators.find((c) => c.clientId === clientId)?.serverId
  );
};

/**
 * The names of the documents this calculator already holds — the guarded replay's evidence.
 *
 * A read failure returns an EMPTY set, not a throw: an empty set means "file it", which risks a
 * duplicate. That is the right way round only because it is paired with `offlineDocumentName` —
 * see `stepReplaySafety`. Never widen this to match on anything but the stored name.
 */
const listFiledDocumentNames = async (leadId: string, calcId: string): Promise<Set<string>> => {
  try {
    const rows = await fetchOutcomeDocumentRows(leadId, calcId);
    const all = [...(rows?.agreements || []), ...(rows?.orderSheets || [])];
    return new Set(all.map((r: any) => String(r?.name || '')).filter(Boolean));
  } catch {
    return new Set<string>();
  }
};

/**
 * The body that files ONE document, shaped exactly like the online `handleUploadDocs` PUT.
 *
 */
const buildDocumentOutcomePayload = async (
  work: OfflineLeadWork,
  calcId: string,
  doc: OfflineJobDocument
): Promise<Record<string, unknown>> => {
  // Read the bytes HERE, at send — see `OfflineJobDocument.uri` for why they are not in the record.
  // The same builder the online submit uses, so a JPEG the device rendered becomes a PDF by the
  // identical path rather than a second conversion written for offline.
  const isAgreement = doc.category === 'agreement';
  const built = await buildDocumentPayloads({
    agreements: isAgreement ? [{ name: doc.name, uri: doc.uri, contentType: doc.contentType }] : [],
    orderSheets: isAgreement ? [] : [{ name: doc.name, uri: doc.uri, contentType: doc.contentType }],
    leadId: work.serverIds.leadId,
    // ⚠️ `true` unconditionally. `isSale: false` re-files agreements AS order sheets, which is the
    // right rule at submit and the wrong one here: this call is only ever filing the one document
    // the rep captured, under the card they captured it on.
    isSale: true,
    includeSystemGenerated: true,
  });
  const bodies = isAgreement ? built.agreements : built.orderSheets;
  if (!bodies.length) throw new Error(`could not read the queued document ${doc.name}`);

  return {
    // ⚠️ The stored draft rides along, because this endpoint writes the WHOLE outcome: a body
    // holding only the document would blank the build the rep just made. The Sale default covers
    // the one case where there is no draft yet — a document captured before the first 2 s autosave
    // tick — and matches what the online `handleUploadDocs` hardcodes for the same reason.
    result: 'Sale',
    status: 'Sale',
    ...(work.outcome || {}),
    selectedCalculatorId: calcId,
    [documentRootKey(doc.category)]: bodies.map((b) => ({ ...b, name: doc.name })),
  };
};

/**
 * The submit's own copy of the documents, read off disk at send.
 *
 * ⚠️ This is NOT a duplicate of the documents step. That step writes LeadOutcomeDocument rows (what
 * Contract Details renders); this writes JobBuilderDocument rows (what the submitted job record
 * carries), and the ONLINE submit sends both too. Dropping it here would leave an offline job
 * looking different from an online one on the portal.
 *
 * A document that cannot be read is skipped rather than failing the submit: the job itself is the
 * thing that must land, and the outcome rows already hold the contract.
 */
const buildQueuedSubmitDocuments = async (
  work: OfflineLeadWork,
  payload: Record<string, any>
): Promise<{ agreements: unknown[]; orderSheets: unknown[] }> => {
  const pending = work.documents || [];
  if (!pending.length) return { agreements: [], orderSheets: [] };
  try {
    return await buildDocumentPayloads({
      agreements: pending
        .filter((d) => d.category === 'agreement')
        .map((d) => ({ name: d.name, uri: d.uri, contentType: d.contentType })),
      orderSheets: pending
        .filter((d) => d.category === 'orderSheet')
        .map((d) => ({ name: d.name, uri: d.uri, contentType: d.contentType })),
      leadId: work.serverIds.leadId,
      // A non-Sale files agreements AS order sheets — web's rule, and it belongs here because this
      // IS the submit. Read from the payload the screen built rather than re-derived.
      isSale: String(payload?.leadData?.result || '').toLowerCase() === 'sale',
      includeSystemGenerated: true,
    });
  } catch (e) {
    console.warn('[offlineLeadStore] could not attach documents to the submit:', e);
    return { agreements: [], orderSheets: [] };
  }
};

/** Record that ONE document is now on the server, immediately and durably. */
const markDocumentUploaded = (workClientId: string, docClientId: string): void => {
  const current = findOfflineWork(workClientId);
  if (!current) return;
  const filed = current.documents?.find((d) => d.clientId === docClientId);
  putOfflineWork({
    ...current,
    documents: (current.documents || []).map((d) =>
      d.clientId === docClientId ? { ...d, uploadedAt: new Date().toISOString() } : d
    ),
  });
  // ⚠️ Only AFTER the row is written. Losing the file before the record says it is filed would
  // leave a document the uploader still means to send and can no longer read.
  discardOfflineDocumentFile(filed?.uri);
};

/** Did the job-builder submit already land? */
const isAlreadySubmitted = async (work: OfflineLeadWork): Promise<boolean> => {
  const leadId = work.serverIds.leadId;
  if (!leadId) return false;
  const res = await LeadService.getSalesDealById(leadId);
  const lead = res?.data?.data || res?.data?.lead || res?.data || {};
  return String(lead?.jobBuilder?.status || '').toLowerCase() === 'submitted';
};

/**
 * Is a form of this kind already filed on the lead?
 *
 * ⚠️ The guarded replay's whole evidence base, and the reason no `Idempotency-Key` is needed to
 * queue a legal form. A filed consent shows up as a `generatedReport` on the lead, so a retry whose
 * first attempt timed out can LOOK before it writes rather than filing a second record of one
 * signature. Only ever consulted on an ambiguous retry — the happy path never reads.
 */
const isConsentAlreadyFiled = async (leadId: string, kind: ConsentFormKind): Promise<boolean> => {
  const res = await LeadService.getSalesDealById(leadId);
  const lead = res?.data?.data || res?.data?.lead || res?.data || {};
  return hasFiledConsentReport(lead, kind);
};

/**
 * Turn the coordinates captured at the door into a street address, now that there is a connection.
 *
 * This is the second half of "capture the fix now, resolve the address later": with no signal there
 * is no reverse-geocoder to reach (iOS `CLGeocoder` and Android `Geocoder` both call a web service),
 * so the lead is filed holding `31.46668, 74.29039` and the address is settled here instead.
 *
 * ⚠️ A REP-TYPED ADDRESS IS NEVER REPLACED. `resolveSyncAddress` owns that rule: a fix is accurate
 * to +/-5-20 m and a reverse-geocode snaps it to the nearest address it knows, which on an ordinary
 * street is regularly the NEIGHBOUR. What the rep read off the mailbox beats anything inferable
 * from a scatter of metres.
 *
 * ⚠️ A failed geocode is NOT a failed upload. The lead files with its coordinates exactly as before
 * — which is at least true and actionable — rather than being held back over a cosmetic field.
 *
 * Returns the resolved street address, or `null` when there is nothing to change — so the caller
 * can apply it to BOTH the outgoing body and the record kept on the device, which have to agree.
 */
const resolveQueuedLeadAddress = async (payload: Record<string, any>): Promise<string | null> => {
  const address = payload?.fullAddress;
  const coords = coordsFromLeadPayload(payload);
  if (!needsAddressResolution(address, coords)) return null;

  let reverseGeocoded: string | null = null;
  try {
    if (coords) reverseGeocoded = await reverseGeocode(coords);
  } catch {
    /* keep the coordinates */
  }

  const { address: resolved, source } = resolveSyncAddress({ address, coords, reverseGeocoded });
  return source === 'reverse-geocoded' ? resolved : null;
};

// ─── The steps ────────────────────────────────────────────────────────────────

type StepResult = {
  leadId?: string;
  appointmentId?: string;
  calculators?: Record<string, string>;
};

/**
 * Run one step against the server and return whatever server ids it produced.
 *
 * `guarded` is set when we are retrying a create whose outcome was unknown: the step looks for what
 * the earlier attempt may have created and adopts it instead of writing a second copy.
 */
/**
 * Pull the server's lead lists in, and WAIT for them.
 *
 * ⚠️ Awaited on purpose, and it is what closes the handover window rather than tidiness.
 * The Leads screen hides a row while its archive or delete is still pending; the moment the step
 * is marked done that suppression lifts, and if the list in hand is the one fetched before the
 * change, the lead the rep archived reappears under Today for a beat. `invalidateQueries` resolves
 * once the active refetches have settled, so by the time the step returns the list already agrees.
 */
const refreshLeadLists = async (): Promise<void> => {
  try {
    await queryClient.invalidateQueries({ queryKey: ['leads'] });
  } catch (e) {
    console.warn('[leadStore] lead list refresh failed', e);
  }
};

const runStep = async (
  work: OfflineLeadWork,
  step: UploadStep,
  guarded: boolean
): Promise<StepResult> => {
  const map = buildIdMap(work);
  const leadId = work.serverIds.leadId;

  // ⚠️ The last gate before any send. A client id that survived the rewrite means an earlier step
  // recorded no server id, and sending would file a real row referencing a record that does not
  // exist — silent, and only visible later as a deal whose calculator is missing.
  const send = <T,>(payload: T): T => {
    const resolved = resolveClientIds(payload, map);
    const unresolved = findUnresolvedClientIds(resolved);
    if (unresolved.length) {
      throw new Error(`unresolved client id(s) in the ${step} payload: ${unresolved.join(', ')}`);
    }
    return resolved;
  };

  switch (step) {
    case 'lead': {
      const body = send(work.lead) as Record<string, any>;
      // Coordinates -> a street address, now that there IS a connection. Resolved before the
      // create rather than corrected after it, so the lead is never filed holding a placeholder.
      const resolvedAddress = await resolveQueuedLeadAddress(body);
      const res = await LeadService.createLead(
        resolvedAddress ? applyResolvedAddress(body, resolvedAddress) : body
      );
      // ⚠️ This endpoint answers some failures with a 200 carrying a message, so a resolved promise
      // is not proof the lead was filed.
      if (!isSuccessfulCreate(res?.data)) {
        throw Object.assign(new Error(res?.data?.message || 'create refused'), { response: res });
      }
      const id = readCreatedId(res?.data);
      if (!id) throw new Error('lead created but the response carried no _id');
      // ⚠️ Hand the new id to the PHOTO queue before anything else runs. Photos are the one
      // part of an offline session this store does not own — they are large binaries that must
      // not live in MMKV, so they sit in `uploadQueueManager`, addressed by the client id this
      // device minted. Until they are re-addressed they cannot be sent, and every later step of
      // this upload is a chance for the connection to drop again before they are.
      uploadQueueManager.rekeyLead(work.clientId, id);
      // ⚠️ And the CHECK-IN mark, for the same reason and in the same breath. It is keyed by the
      // id the card was drawn with — the client one — so without this the server row arrives under
      // a real `_id` the map has no entry for and the card regresses to **Start Appointment** on a
      // door the rep already worked.
      rekeyLeadWorkflow(work.clientId, id);
      // ⚠️ Keep the DEVICE's copy of the lead in step with what was just filed. Resolving only the
      // outgoing body leaves the server holding the street address while every screen that reads
      // the offline record still shows the raw coordinates — the Lead Center header, and any
      // agreement generated from here on, since `offlineWorkToLead` projects this payload. The
      // record would only correct itself whenever some later refetch happened to replace it.
      // `uploadOne` re-reads through `latest()` after each step, so this cannot be clobbered.
      if (resolvedAddress) {
        patchOfflineWork(work.clientId, (w) => ({
          ...w,
          lead: w.lead
            ? applyResolvedAddress(w.lead as Record<string, any>, resolvedAddress)
            : w.lead,
        }));
      }
      return { leadId: id };
    }

    case 'appointment': {
      // ⚠️ The stored payload's `leadId` is the HUMAN id and its `selfGenLeadId` is the lead's
      // mongo id (a client id until `send` rewrites it) — the shape `resolveAppointmentId` posts.
      // Overwriting `leadId` with the server `_id` here, which is what this did first, makes the
      // backend match nothing and file a duplicate appointment.
      const appointment = send(work.appointment as Record<string, any>);

      if (guarded) {
        const existing = await findExistingAppointment(work, appointment);
        if (existing) return { appointmentId: existing };
      }

      try {
        const res = await LeadService.createAppointment(appointment);
        const id = readCreatedId(res?.data);
        if (!id) throw new Error('appointment created but the response carried no _id');
        return { appointmentId: id };
      } catch (err) {
        // ⚠️ A 409 is the server ANSWERING with the appointment this lead already has, not
        // refusing. Web parity with `resolveAppointmentId`, which calls honouring it "the key fix".
        const existing = readExistingAppointmentId(err);
        if (existing) return { appointmentId: existing };
        // A 409 that carried no id: fall back to the list read before giving up, since we now know
        // for certain that an appointment exists.
        if (readIs409(err)) {
          const found = await findExistingAppointment(work, appointment).catch(() => null);
          if (found) return { appointmentId: found };
        }
        throw err;
      }
    }

    case 'calculator': {
      const apptId = work.serverIds.appointmentId;
      if (!apptId) throw new Error('no appointment id to hang the calculator off');
      const pending = work.calculators.filter(
        (c) => !c.serverId && !work.serverIds.calculators[c.clientId]
      );
      const adopted = guarded ? await findUnclaimedCalculators(work) : [];
      const out: Record<string, string> = {};

      for (let i = 0; i < pending.length; i += 1) {
        const calc = pending[i];
        if (adopted[i]) {
          out[calc.clientId] = adopted[i];
          continue;
        }
        const res = await LeadService.createCalculator(apptId, send(calc.payload));
        const id = readCreatedId(res?.data);
        if (!id) throw new Error('calculator created but the response carried no _id');
        out[calc.clientId] = id;
      }
      return { calculators: out };
    }

    case 'calculatorState': {
      // A full-state PUT per calculator — idempotent, so a partial failure simply re-runs.
      for (const calc of work.calculators) {
        const id = calc.serverId || work.serverIds.calculators[calc.clientId];
        if (!id) throw new Error(`no server id for calculator ${calc.clientId}`);
        await LeadService.updateCalculator(id, send(calc.payload));
      }
      return {};
    }

    case 'outcome': {
      if (!leadId) throw new Error('no lead id for the outcome');
      const calcId = resolveOutcomeCalculatorId(work);
      if (!calcId) throw new Error('no calculator id for the outcome');
      await LeadService.updateLeadOutcomeByCalculator(leadId, calcId, send(work.outcome));
      return {};
    }

    case 'documents': {
      if (!leadId) throw new Error('no lead id for the documents');
      const calcId = resolveOutcomeCalculatorId(work);
      if (!calcId) throw new Error('no calculator id for the documents');

      // ⚠️ ONE PUT PER DOCUMENT, and each is marked the instant it lands.
      //
      // This endpoint APPENDS the bodies it is given, so a batch that fails halfway would re-file
      // everything before the failure on the next run. Filing them one at a time makes the record
      // on disk an accurate account of what the server holds at every moment in between.
      const filed = guarded ? await listFiledDocumentNames(leadId, calcId) : new Set<string>();

      for (const doc of work.documents || []) {
        if (doc.uploadedAt) continue;
        if (!filed.has(doc.name)) {
          await LeadService.updateLeadOutcomeByCalculator(
            leadId,
            calcId,
            send(await buildDocumentOutcomePayload(work, calcId, doc))
          );
        }
        markDocumentUploaded(work.clientId, doc.clientId);
      }
      return {};
    }

    case 'remoteSignature': {
      if (!leadId) throw new Error('no lead id for the remote signature');
      try {
        await LeadService.sendAgreementRemote(leadId, send(work.remoteSignature));
      } catch (err) {
        // ⚠️ A 409 is the server saying an agreement is ALREADY out for this lead, which is the
        // outcome we wanted. Reading it as a failure would park the lead and, on a retry the rep
        // forced, send the customer a second signing link for the same contract.
        if (!readIs409(err)) throw err;
      }
      return {};
    }

    case 'submit': {
      if (!leadId) throw new Error('no lead id for the submit');
      if (guarded && (await isAlreadySubmitted(work))) return {};
      // The documents ride along at the TOP LEVEL, exactly as the online submit sends them — this
      // is the JobBuilderDocument collection, a different one from the rows the documents step
      // files. They are read off disk HERE and not before: the stored payload holds no base64, so
      // the record stays small enough to rewrite on every draft save.
      const payload = send(work.submit) as Record<string, any>;
      const docs = await buildQueuedSubmitDocuments(work, payload);
      await LeadService.submitJobBuilder(leadId, { ...payload, ...docs });
      return {};
    }

    case 'consent': {
      const consentLeadId = work.serverIds.leadId;
      if (!consentLeadId) throw new Error('the consent form has no lead id to file against');

      for (const form of (work.consents || []).filter((c) => !c.uploadedAt)) {
        // ── the POST ────────────────────────────────────────────────────────────
        // ⚠️ Split from the finalize below, and each half recorded as it lands. They are two
        // requests: the first files the form and renders the PDF, the second registers that PDF as
        // the `generatedReport` the gate reads. If a connection dies between them and a retry
        // started over, the customer's ONE signature would be filed as TWO consent records.
        let pdfPath = form.pdfPath;
        if (!form.submittedAt || !pdfPath) {
          if (guarded && !form.knownFiledBefore && (await isConsentAlreadyFiled(consentLeadId, form.kind))) {
            // The earlier attempt did land. Adopting it is the whole point of the guard.
            patchOfflineConsent(work.clientId, form.clientId, {
              submittedAt: new Date().toISOString(),
              uploadedAt: new Date().toISOString(),
            });
            discardOfflineDocumentFile(form.signatureUri);
            continue;
          }

          pdfPath = await submitConsentForm({
            kind: form.kind,
            leadId: consentLeadId,
            payload: {
              // ⚠️ `payload.leadId` is the HUMAN Lead ID the rep sees on the form (`41PCDLG`, or
              // `N/A` on a self-gen lead) — NOT the mongo `_id`. Overwriting it with the server id
              // would print a database key in the Lead ID box of a document the customer signed.
              // The association that matters is made by the finalize below, which files the PDF
              // against the real lead id.
              ...form.payload,
              ...(form.signatureUri
                ? {
                    file: {
                      uri: form.signatureUri,
                      name: form.signatureName,
                      type: form.signatureType,
                    },
                  }
                : {}),
            },
          });
          // ⚠️ Kept, not left in CacheDir: iOS empties caches under pressure, and if the finalize
          // below fails the retry needs this exact document rather than a second submission.
          pdfPath = await persistOfflineDocumentFile(
            pdfPath,
            `${form.kind}_${form.clientId}.pdf`
          );
          patchOfflineConsent(work.clientId, form.clientId, {
            submittedAt: new Date().toISOString(),
            pdfPath,
          });
        }

        // ── the finalize ────────────────────────────────────────────────────────
        await finalizeConsentUpload({ leadId: consentLeadId, pdfPath, kind: form.kind });
        patchOfflineConsent(work.clientId, form.clientId, {
          uploadedAt: new Date().toISOString(),
        });
        discardOfflineDocumentFile(form.signatureUri);
        discardOfflineDocumentFile(pdfPath);
      }
      return {};
    }

    case 'work': {
      if (!leadId) throw new Error('cannot record work on a lead with no server id');
      // ⚠️ The rep who was AT the door, taken from the record — never the session's current user.
      // A handset is shared, and filing the visit under whoever happens to be signed in when the
      // signal returns credits the wrong person for the knock.
      await LeadService.workLead(leadId, String(work.workStarted?.userId || ''));
      await refreshLeadLists();
      return {};
    }

    case 'customer': {
      const edit = work.customer;
      if (!edit) return {};
      // ⚠️ Resolved here rather than refused at queue time, because a lead created at the door has
      // no customer record until its create lands — so the id simply does not exist while the rep
      // is standing there. One read, only on the path that needs it.
      let customerId = edit.customerId;
      if (!customerId) {
        if (!leadId) throw new Error('cannot update a customer on a lead with no server id');
        const res = await LeadService.getSalesDealById(leadId);
        const body = res?.data?.data || res?.data || {};
        const fresh = body?.lead?.customerDetails || body?.customerDetails || {};
        customerId = String(fresh?._id || fresh?.id || '').trim();
      }
      if (!customerId) throw new Error('customer record not found for this lead');
      await LeadService.updateCustomer(customerId, edit.payload);
      // ⚠️ The lead DETAIL too, not just the lists. `offlineCustomerOverlay` stops the moment this
      // step lands, so without a refetch the Lead Center falls back to the record it was holding —
      // which is the optimistic copy, and would never be reconciled with what the server stored.
      await queryClient
        .invalidateQueries({ queryKey: ['lead', leadId] })
        .catch(() => undefined);
      await refreshLeadLists();
      return {};
    }

    case 'archive': {
      if (!leadId) throw new Error('cannot archive a lead with no server id');
      // ⚠️ The stored STATE, never a toggle off the current value — that is what makes the retry
      // free, and it is also correct: the rep decided "archived", not "the other one".
      await LeadService.archiveLead(leadId, work.archive?.isArchive === true);
      await refreshLeadLists();
      return {};
    }

    case 'delete': {
      if (!leadId) throw new Error('cannot delete a lead with no server id');
      try {
        await LeadService.deleteLead(leadId);
      } catch (err) {
        // ⚠️ Already gone IS the state we wanted. Reporting it as a failure would park a door the
        // rep removed in the "needs your check" list and invite them to remove it a second time.
        if (!readIsNotFound(err)) throw err;
      }
      uploadQueueManager.dropLead(leadId);
      await refreshLeadLists();
      return {};
    }

    default:
      throw new Error(`unknown upload step: ${step}`);
  }
};

// ─── The upload loop ──────────────────────────────────────────────────────────

/** Walk one record's remaining steps until it finishes, stalls, or the connection goes. */
/**
 * Re-read the record before writing to it.
 *
 * ⚠️ This is not defensive tidiness — without it the documents step is unsafe. `runStep` marks
 * each document filed AS IT LANDS, straight to the store; the loop below is holding a copy taken
 * before any of that. Writing that copy back would erase the marks, and a step that failed on its
 * SECOND document would then re-file the first — the duplicate signed agreement this whole design
 * exists to avoid. Any step that writes to the record mid-run depends on this.
 */
const latest = (work: OfflineLeadWork): OfflineLeadWork => findOfflineWork(work.clientId) || work;

const uploadOne = async (start: OfflineLeadWork): Promise<void> => {
  let work = putOfflineWork({ ...start, status: 'uploading' });
  let guarded = false;

  for (;;) {
    const step = nextUploadStep(work);
    if (!step) {
      const finished = putOfflineWork({ ...work, status: 'uploaded' });
      // The door is gone from the server, so the record describes nothing. Keeping it would leave
      // a tombstone suppressing an id that can never come back, one per lead the rep ever deleted.
      if (finished.deleteLead) removeOfflineWork(finished.clientId);
      return;
    }
    if (!isOnline()) {
      putOfflineWork({ ...work, status: 'draft' });
      return;
    }

    try {
      const sent = work;
      const ids = await runStep(sent, step, guarded);
      const now = latest(work);
      let landed = markStepDone(now, step, ids);
      // An edit made while this request was in flight was NOT sent — keep the ids, run it again.
      if (stepPayloadChanged(sent, now, step)) landed = rearmStep(landed, step);
      work = putOfflineWork(
        nextUploadStep(landed) ? { ...landed, status: 'uploading' } : landed
      );
      guarded = false;
    } catch (err) {
      const decision: StepDecision = decideAfterStepError(err, work, step);
      if (decision === 'done') {
        work = putOfflineWork(markStepDone(latest(work), step));
        continue;
      }
      if (decision === 'retry-guarded' && !guarded) {
        // Look before writing again, on this same pass — the connection is up right now.
        guarded = true;
        work = putOfflineWork({ ...latest(work), status: 'uploading', lastError: messageOfError(err) });
        continue;
      }
      putOfflineWork(applyStepDecision(latest(work), decision, messageOfError(err)));
      return;
    }
  }
};

/**
 * Upload every record with work outstanding.
 *
 * ⚠️ SEQUENTIAL, oldest first. Leads file in the order the rep knocked the doors — which is the
 * order the portal timeline reads as theirs — and only one create is ever in flight, so a flaky
 * connection cannot produce two ambiguous outcomes at once.
 */
export const drainOfflineWork = async (): Promise<void> => {
  load();
  if (draining || !isOnline()) return;
  draining = true;
  try {
    /**
     * Records that could not get any further on THIS pass.
     *
     * ⚠️ They are SKIPPED, never treated as a full stop — and that distinction is the whole of
     * this fix. The guard here used to `return`, so one record failing in a way that leaves it
     * `draft` (a timeout, a 5xx, a blip mid-request — anything the table calls `retry`) abandoned
     * every record queued behind it. QA hit exactly that: five leads, four of them untouched and
     * still reading "waiting", on a phone with full signal.
     *
     * The original intent was only to stop the loop SPINNING on a record making no progress, and
     * skipping achieves that: the set grows monotonically against a finite queue, so this always
     * terminates.
     */
    const stalled = new Set<string>();
    for (;;) {
      const next = uploadableWork(mine()).find((w) => !stalled.has(w.clientId));
      if (!next || !isOnline()) return;
      await uploadOne(next);
      if (uploadableWork(mine()).some((w) => w.clientId === next.clientId)) {
        stalled.add(next.clientId);
      }
    }
  } finally {
    draining = false;
  }
};

/** Fire-and-forget wrapper, so no caller has to hold an unhandled rejection. */
export const runUpload = (): void => {
  drainOfflineWork().catch((e) => console.warn('[leadStore] upload failed', e));
};

let syncStarted = false;

/**
 * How often to look again while the app is open, online, and holding work.
 *
 * ⚠️ Not a poll of the network — `connectivity` already knows that. It is a retry for the pass
 * that failed, and without one there is none: the reconnect hook fires on the offline→online EDGE,
 * so a record that failed its first attempt while online sat there until the app was relaunched or
 * the rep happened to lose signal again. On screen that is a lead marked "waiting" on a phone with
 * five bars, and nothing the rep can do about it.
 */
const RETRY_SWEEP_MS = 60_000;

/**
 * Idempotent. Drains on every reconnect, on every return to the foreground, once on a cold start
 * in case we launched online, and on a slow sweep while anything is still outstanding.
 */
export const startOfflineWorkSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;

  onReconnect(() => runUpload());

  // Coming back to the app is the moment the rep expects to see progress, and it is also when a
  // connection that recovered while backgrounded first becomes usable.
  AppState.addEventListener('change', (next) => {
    if (next === 'active') runUpload();
  });

  setInterval(() => {
    // Cheap to skip: `load()` is memoised and both guards are in-memory reads, so a session with
    // nothing queued does no work at all.
    if (!isOnline()) return;
    load();
    if (!uploadableWork(mine()).length) return;
    runUpload();
  }, RETRY_SWEEP_MS);

  runUpload();
};
