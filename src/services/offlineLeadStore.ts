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

import { storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { isOnline, onReconnect } from './connectivity';
import { describeQueuedLead, isSuccessfulCreate, messageOfError } from '../utils/offline-lead-queue';
import {
  applyStepDecision,
  adoptExistingWork,
  createOfflineWork,
  buildIdMap,
  decideAfterStepError,
  findUnresolvedClientIds,
  markStepDone,
  nextUploadStep,
  readCreatedId,
  readExistingAppointmentId,
  resolveClientIds,
  uploadableWork,
  type OfflineCalculatorWork,
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

/** Did the job-builder submit already land? */
const isAlreadySubmitted = async (work: OfflineLeadWork): Promise<boolean> => {
  const leadId = work.serverIds.leadId;
  if (!leadId) return false;
  const res = await LeadService.getSalesDealById(leadId);
  const lead = res?.data?.data || res?.data?.lead || res?.data || {};
  return String(lead?.jobBuilder?.status || '').toLowerCase() === 'submitted';
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
      const res = await LeadService.createLead(send(work.lead));
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
      const calcClientId = work.outcomeCalculatorClientId || work.calculators[0]?.clientId;
      const calcId = calcClientId
        ? work.serverIds.calculators[calcClientId] ||
          work.calculators.find((c) => c.clientId === calcClientId)?.serverId
        : undefined;
      if (!calcId) throw new Error('no calculator id for the outcome');
      await LeadService.updateLeadOutcomeByCalculator(leadId, calcId, send(work.outcome));
      return {};
    }

    case 'agreement': {
      if (!leadId) throw new Error('no lead id for the agreement');
      await uploadAgreement(leadId, send(work.agreement) as Record<string, unknown>);
      return {};
    }

    case 'submit': {
      if (!leadId) throw new Error('no lead id for the submit');
      if (guarded && (await isAlreadySubmitted(work))) return {};
      await LeadService.submitJobBuilder(leadId, send(work.submit));
      return {};
    }

    default:
      throw new Error(`unknown upload step: ${step}`);
  }
};

/**
 * Send an agreement that was signed at the door.
 *
 * ⚠️ Placeholder until the offline agreement decision lands. The online flow POSTs multipart to
 * `pdf-reports/v1/agreement/{leadId}/sign` and the SERVER renders the PDF; whether the device does
 * that rendering instead changes only what goes in this FormData, not the step around it.
 */
const uploadAgreement = async (leadId: string, agreement: Record<string, unknown>): Promise<void> => {
  const form = new FormData();
  Object.entries(agreement).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    form.append(k, typeof v === 'string' ? v : (JSON.stringify(v) as any));
  });
  await LeadService.signAgreement(leadId, form);
};

// ─── The upload loop ──────────────────────────────────────────────────────────

/** Walk one record's remaining steps until it finishes, stalls, or the connection goes. */
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
      work = putOfflineWork(markStepDone(work, step, ids));
      guarded = false;
    } catch (err) {
      const decision: StepDecision = decideAfterStepError(err, work, step);
      if (decision === 'done') {
        work = putOfflineWork(markStepDone(work, step));
        continue;
      }
      if (decision === 'retry-guarded' && !guarded) {
        // Look before writing again, on this same pass — the connection is up right now.
        guarded = true;
        work = putOfflineWork({ ...work, status: 'uploading', lastError: messageOfError(err) });
        continue;
      }
      putOfflineWork(applyStepDecision(work, decision, messageOfError(err)));
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
