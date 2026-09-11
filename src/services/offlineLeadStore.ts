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

import RNFS from 'react-native-fs';
import { storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { fetchOutcomeDocumentRows } from '../screens/DynamicDealCenter/utils/outcome-documents';
import { buildDocumentPayloads } from '../screens/DynamicDealCenter/utils/document-payloads';
import { isOnline, onReconnect } from './connectivity';
import { describeQueuedLead, isSuccessfulCreate, messageOfError } from '../utils/offline-lead-queue';
import {
  applyResolvedAddress,
  coordsFromLeadPayload,
  needsAddressResolution,
  resolveSyncAddress,
} from '../utils/offline-lead-location';
import { reverseGeocode } from '../utils/places';
import {
  applyStepDecision,
  adoptExistingWork,
  createOfflineWork,
  buildIdMap,
  decideAfterStepError,
  findUnresolvedClientIds,
  markStepDone,
  newWorkId,
  nextUploadStep,
  readCreatedId,
  readExistingAppointmentId,
  resolveClientIds,
  documentRootKey,
  offlineDocumentName,
  uploadableWork,
  type OfflineCalculatorWork,
  type OfflineDocumentCategory,
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

// ─── Public reads ─────────────────────────────────────────────────────────────

export const getOfflineWork = (): OfflineLeadWork[] => {
  load();
  return store;
};

export const findOfflineWork = (clientId: string): OfflineLeadWork | undefined => {
  load();
  return store.find((w) => w.clientId === clientId || w.serverIds.leadId === clientId);
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
  const next = { ...work, updatedAt: new Date().toISOString() };
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
  const existing = store.find((w) => w.serverIds.leadId === leadId && w.status !== 'uploaded');
  return existing || putOfflineWork(adoptExistingWork(leadId, label, seed));
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

  const existing = store.find(
    (w) => (w.clientId === id || w.serverIds.leadId === id) && w.status !== 'uploaded'
  );
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
  patchOfflineWork(workClientId, (w) => ({
    ...w,
    appointment: data.appointment ?? w.appointment,
    appointmentClientId: data.appointmentClientId ?? w.appointmentClientId,
    serverIds: data.appointmentServerId
      ? { ...w.serverIds, appointmentId: data.appointmentServerId }
      : w.serverIds,
    calculators: data.calculators,
  }));

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
  patchOfflineWork(workClientId, (w) => ({
    ...w,
    outcome: stripDocumentKeys(outcome),
    outcomeCalculatorClientId: outcomeCalculatorClientId ?? w.outcomeCalculatorClientId,
  }));

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
  const saved = patchOfflineWork(workClientId, (w) => ({
    ...w,
    documents: [...(w.documents || []), entry],
  }));
  return saved ? entry : null;
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
 */
const resolveQueuedLeadAddress = async (
  payload: Record<string, any>
): Promise<Record<string, any>> => {
  const address = payload?.fullAddress;
  const coords = coordsFromLeadPayload(payload);
  if (!needsAddressResolution(address, coords)) return payload;

  let reverseGeocoded: string | null = null;
  try {
    if (coords) reverseGeocoded = await reverseGeocode(coords);
  } catch {
    /* keep the coordinates */
  }

  const { address: resolved, source } = resolveSyncAddress({ address, coords, reverseGeocoded });
  return source === 'reverse-geocoded' ? applyResolvedAddress(payload, resolved) : payload;
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
      const res = await LeadService.createLead(
        await resolveQueuedLeadAddress(send(work.lead) as Record<string, any>)
      );
      // ⚠️ This endpoint answers some failures with a 200 carrying a message, so a resolved promise
      // is not proof the lead was filed.
      if (!isSuccessfulCreate(res?.data)) {
        throw Object.assign(new Error(res?.data?.message || 'create refused'), { response: res });
      }
      const id = readCreatedId(res?.data);
      if (!id) throw new Error('lead created but the response carried no _id');
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
      putOfflineWork({ ...work, status: 'uploaded' });
      return;
    }
    if (!isOnline()) {
      putOfflineWork({ ...work, status: 'draft' });
      return;
    }

    try {
      const ids = await runStep(work, step, guarded);
      work = putOfflineWork(markStepDone(latest(work), step, ids));
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
    for (;;) {
      const next = uploadableWork(store)[0];
      if (!next || !isOnline()) return;
      await uploadOne(next);
      if (uploadableWork(store)[0]?.clientId === next.clientId) return; // made no progress — stop
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

/** Idempotent. Drains on every reconnect, plus once on a cold start in case we launched online. */
export const startOfflineWorkSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;
  onReconnect(() => runUpload());
  runUpload();
};
