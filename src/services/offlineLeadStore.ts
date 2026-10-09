import { AppState } from 'react-native';
import RNFS from 'react-native-fs';
import { storage } from '../utils/storage';
import { LeadService } from './api/leads';
import ChatService from './api/ChatService';
import { adoptServerDropIds, readServerDrops } from '../screens/DynamicDealCenter/utils/drop-prices';
import { FundingService } from './api/FundingService';
import { fetchOutcomeDocumentRows } from '../screens/DynamicDealCenter/utils/outcome-documents';
import { buildDocumentPayloads } from '../screens/DynamicDealCenter/utils/document-payloads';
import { isOnline, onReconnect } from './connectivity';
import { getSessionOwner, registerSessionResetHook } from './sessionScope';
import { isOwnedBy } from '../utils/session-scope';
import { uploadQueueManager } from '../utils/uploadQueue';
import { rekeyActivityLogs } from './offlineActivityLog';
import { rekeyDeliveryPreference } from './offlineAgreementDelivery';
import { describeQueuedLead, isSuccessfulCreate, messageOfError } from '../utils/offline-lead-queue';
import { setWorkReleaseQueue } from '../utils/lead-work-session';
import {
  applyResolvedAddress,
  coordsFromLeadPayload,
  needsAddressResolution,
  parseCoordsAddress,
  resolveFormAddress,
  resolveSyncAddress,
} from '../utils/offline-lead-location';
import { reverseGeocode } from '../utils/places';
import { queryClient } from './api/queryClient';
import { rekeyLeadWorkflow } from './offlineLeadStatus';
import { offlinePhotoDeleteQueue } from './offlinePhotoDeleteQueue';
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
  isClientId,
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

const load = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const saved = storage.getString(STORE_KEY);
    store = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(store)) store = [];
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
    }
  });
};

const mine = (): OfflineLeadWork[] => {
  const owner = getSessionOwner();
  return store.filter((w) => isOwnedBy(w.ownerId, owner));
};

registerSessionResetHook(() => {
  store = [];
  loaded = false;
});

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

export const putOfflineWork = (work: OfflineLeadWork): OfflineLeadWork => {
  load();
  const next = reopenIfPending({
    ...work,
    ownerId: work.ownerId || getSessionOwner(),
    updatedAt: new Date().toISOString(),
  });
  const i = store.findIndex((w) => w.clientId === work.clientId);
  store = i === -1 ? [...store, next] : store.map((w, n) => (n === i ? next : w));
  persist();
  console.log(
    '[LeadSync] store %s %s origin=%s status=%s workStarted=%s rows=%s',
    i === -1 ? 'ADD' : 'UPDATE',
    next.clientId,
    next.origin,
    next.status,
    next.workStarted ? 'YES' : 'no',
    store.length
  );
  return next;
};

export const patchOfflineWork = (
  clientId: string,
  change: (work: OfflineLeadWork) => OfflineLeadWork
): OfflineLeadWork | null => {
  load();
  const current = store.find((w) => w.clientId === clientId);
  if (!current) return null;
  return putOfflineWork(change(current));
};

export const enqueueOfflineLead = (payload: Record<string, unknown>): OfflineLeadWork => {
  const work = putOfflineWork(createOfflineWork(payload, describeQueuedLead(payload)));
  console.log(
    '[LeadSync] CREATE queued clientId=%s owner=%s hasLocation=%s label=%s',
    work.clientId,
    work.ownerId || 'NONE',
    !!(payload as any)?.location,
    work.label
  );
  return work;
};

export const beginOfflineWorkOnLead = (
  leadId: string,
  label: string,
  seed: Parameters<typeof adoptExistingWork>[2] = {}
): OfflineLeadWork => {
  load();
  const existing = mine().find((w) => w.serverIds.leadId === leadId && w.status !== 'uploaded');
  return existing || putOfflineWork(adoptExistingWork(leadId, label, seed));
};

export const findOfflineWorkForLead = (lead: any): OfflineLeadWork | undefined => {
  load();
  const id = String(lead?._id || lead?.id || '');
  if (!id) return undefined;
  const rows = mine().filter((w) => w.clientId === id || w.serverIds.leadId === id);
  return rows.find((w) => w.status !== 'uploaded') || rows[0];
};

export const ensureOfflineWorkForLead = (lead: any): OfflineLeadWork | null => {
  load();
  const id = String(lead?._id || lead?.id || '');
  if (!id) return null;

  const rows = mine().filter((w) => w.clientId === id || w.serverIds.leadId === id);
  const existing = rows.find((w) => w.status !== 'uploaded') || rows[rows.length - 1];
  if (existing) return existing;

  if (isClientId(id)) {
    console.warn('[leadStore] no record for client id %s; not adopting', id);
    return null;
  }
  const c = lead?.customerDetails || {};
  return putOfflineWork(
    adoptExistingWork(id, describeQueuedLead({ customer: c, fullAddress: lead?.fullAddress }))
  );
};

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
    return rearmStep(rearmStep(next, 'calculator'), 'calculatorState');
  });

export const saveOfflineJobBuilderDraft = (
  workClientId: string,
  outcome: Record<string, unknown>,
  outcomeCalculatorClientId?: string
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) =>
    rearmStep(
      {
        ...w,
        outcome: stripDocumentKeys(outcome),
        outcomeCalculatorClientId: outcomeCalculatorClientId ?? w.outcomeCalculatorClientId,
      },
      'outcome'
    )
  );

export const saveOfflineFunding = (
  workClientId: string,
  funding: Record<string, unknown>
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) => rearmStep({ ...w, funding }, 'funding'));

/** A check taken in hand offline. The pid is the one the save above carries, so it addresses. */
export const saveOfflineFundingCollected = (
  workClientId: string,
  pid: string
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) =>
    rearmStep(
      { ...w, fundingCollected: Array.from(new Set([...(w.fundingCollected || []), pid])) },
      'fundingCollect'
    )
  );

/** Submit Funding pressed offline. Ordered after `funding`, so the rows land before the submit. */
export const saveOfflineFundingSubmit = (workClientId: string): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) =>
    rearmStep({ ...w, fundingSubmitted: { at: new Date().toISOString() } }, 'fundingSubmit')
  );

export const addOfflineJobDocument = async (
  workClientId: string,
  category: OfflineDocumentCategory,
  doc: { uri: string; contentType: string; extension?: string; name?: string }
): Promise<OfflineJobDocument | null> => {
  const name = doc.name || offlineDocumentName(category, doc.extension || 'pdf');
  const uri = await persistOfflineDocumentFile(doc.uri, name);
  const entry: OfflineJobDocument = {
    clientId: newWorkId('doc'),
    category,
    name,
    uri,
    contentType: doc.contentType,
  };
  const saved = patchOfflineWork(workClientId, (w) =>
    rearmStep({ ...w, documents: [...(w.documents || []), entry] }, 'documents')
  );
  return saved ? entry : null;
};

export const queueOfflineConsent = async (
  workClientId: string,
  kind: ConsentFormKind,
  data: any,
  opts: { knownFiledBefore?: boolean } = {}
): Promise<OfflineConsentForm | null> => {
  const { fields, signature } = splitConsentPayload(data);
  const sig = signature as { uri: string; name?: string; type?: string } | null;

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

  const saved = patchOfflineWork(workClientId, (w) =>
    rearmStep({ ...w, consents: [...(w.consents || []), entry] }, 'consent')
  );
  return saved ? entry : null;
};

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

const discardOfflineDocumentFile = (uri?: string): void => {
  if (!uri) return;
  RNFS.unlink(uri.replace('file://', '')).catch(() => {
  });
};

export const queueOfflineRemoteSignature = (
  workClientId: string,
  payload: Record<string, unknown>
): OfflineLeadWork | null =>
  patchOfflineWork(workClientId, (w) => ({ ...w, remoteSignature: payload }));

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

const workForLead = (lead: any): { id: string; work?: OfflineLeadWork } => {
  load();
  const id = String(lead?._id || lead?.id || '');
  if (!id) return { id: '' };
  const hit = mine().find((w) => w.clientId === id || w.serverIds.leadId === id);
  console.log(
    '[LeadSync] lookup id=%s found=%s mine=%s ids=%s',
    id,
    hit ? hit.clientId : 'NONE',
    mine().length,
    JSON.stringify(mine().map((w) => w.serverIds.leadId || w.clientId))
  );
  return { id, work: hit };
};

const labelForLead = (lead: any): string =>
  describeQueuedLead({ customer: lead?.customerDetails || {}, fullAddress: lead?.fullAddress });

const adoptForLead = (lead: any, id: string): OfflineLeadWork | null => {
  if (isClientId(id)) {
    console.warn(
      '[leadStore] refusing to adopt a client id (%s) — its record should already exist',
      id
    );
    return null;
  }
  return adoptExistingWork(id, labelForLead(lead));
};


export const queueLeadWorkStart = (lead: any, userId: string): boolean => {
  const { id, work } = workForLead(lead);
  if (!id || !userId) {
    console.log('[LeadSync] check-in NOT queued: id=%s userId=%s', id || 'NONE', userId || 'NONE');
    return false;
  }
  console.log('[LeadSync] check-in queued for %s (record %s)', id, work ? work.clientId : 'new');
  const base = work || adoptForLead(lead, id);
  if (!base) return false;
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
 * The rep left the lead with no signal. Queues the `workStartedBy: null` release.
 *
 * Takes a bare leadId (not a lead object) because the caller only has the stored session.
 * Returns false when there is nothing to attach it to - a lead with no offline record was
 * started online, and `endWorkLead` has already been tried directly.
 */
export const queueLeadWorkEnd = (leadId: string): boolean => {
  load();
  const id = String(leadId || '').trim();
  if (!id || isClientId(id)) return false;
  const base = beginOfflineWorkOnLead(id, '');
  if (!base) return false;
  putOfflineWork({
    ...base,
    workEnded: { at: new Date().toISOString() },
    status: base.status === 'uploaded' ? 'draft' : base.status,
  });
  runUpload();
  return true;
};

// `utils/lead-work-session` is pure (jest-loadable) and cannot import this module, so it takes
// the queue as a hook. Registered here, at the module that owns the queue.
setWorkReleaseQueue((leadId) => {
  queueLeadWorkEnd(leadId);
});

export const queueCustomerUpdate = (lead: any, payload: Record<string, unknown>): boolean => {
  const { id, work } = workForLead(lead);
  if (!id) return false;
  const base = work || adoptForLead(lead, id);
  if (!base) return false;

  const customerId = String(
    lead?.customerDetails?._id || lead?.customerDetails?.id || ''
  ).trim();

  const creatingLead = base.origin === 'created-offline' && isStepPending(base, 'lead');
  const leadBody = creatingLead ? ((base.lead || {}) as Record<string, any>) : null;
  const address = payload.address as string | undefined;

  putOfflineWork(
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

export type OfflineDeleteOutcome = 'queued' | 'discarded';

export const queueLeadDelete = (lead: any): OfflineDeleteOutcome | null => {
  const { id, work } = workForLead(lead);
  if (!id) return null;

  if (work && work.origin === 'created-offline' && !work.serverIds.leadId) {
    uploadQueueManager.dropLead(work.clientId);
    removeOfflineWork(work.clientId);
    return 'discarded';
  }

  const base = work || adoptForLead(lead, id);
  if (!base) return 'discarded';
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

export const queueLeadArchive = (lead: any, isArchive: boolean): boolean => {
  const { id, work } = workForLead(lead);
  if (!id) return false;

  const base = work || adoptForLead(lead, id);
  if (!base) return false;
  const snapshot = leadDetailForCache({ ...(lead || {}), isArchive }) as
    | Record<string, unknown>
    | null;
  putOfflineWork(
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

export const retryOfflineWork = (clientId: string): void => {
  patchOfflineWork(clientId, (w) => ({ ...w, status: 'draft', attempts: 0, lastError: undefined }));
  runUpload();
};

const idOf = (row: any): string => String(row?._id || row?.id || '');

const readIs409 = (err: any): boolean => {
  const body = err?.response?.data ?? err;
  return (
    body?.code === 409 ||
    err?.response?.status === 409 ||
    err?.status === 409 ||
    /already has an appointment/i.test(String(body?.message || err?.message || ''))
  );
};

const readIsNotFound = (err: any): boolean => {
  const body = err?.response?.data ?? err;
  return (
    body?.code === 404 ||
    err?.response?.status === 404 ||
    err?.status === 404 ||
    /not\s*found|does not exist|already deleted/i.test(String(body?.message || err?.message || ''))
  );
};

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

const resolveOutcomeCalculatorId = (work: OfflineLeadWork): string | undefined => {
  const clientId = work.outcomeCalculatorClientId || work.calculators[0]?.clientId;
  if (!clientId) return undefined;
  return (
    work.serverIds.calculators[clientId] ||
    work.calculators.find((c) => c.clientId === clientId)?.serverId
  );
};

const listFiledDocumentNames = async (leadId: string, calcId: string): Promise<Set<string>> => {
  try {
    const rows = await fetchOutcomeDocumentRows(leadId, calcId);
    const all = [...(rows?.agreements || []), ...(rows?.orderSheets || [])];
    return new Set(all.map((r: any) => String(r?.name || '')).filter(Boolean));
  } catch {
    return new Set<string>();
  }
};

const buildDocumentOutcomePayload = async (
  work: OfflineLeadWork,
  calcId: string,
  doc: OfflineJobDocument
): Promise<Record<string, unknown>> => {
  const isAgreement = doc.category === 'agreement';
  const built = await buildDocumentPayloads({
    agreements: isAgreement ? [{ name: doc.name, uri: doc.uri, contentType: doc.contentType }] : [],
    orderSheets: isAgreement ? [] : [{ name: doc.name, uri: doc.uri, contentType: doc.contentType }],
    leadId: work.serverIds.leadId,
    isSale: true,
    includeSystemGenerated: true,
  });
  const bodies = isAgreement ? built.agreements : built.orderSheets;
  if (!bodies.length) throw new Error(`could not read the queued document ${doc.name}`);

  return {
    result: 'Sale',
    status: 'Sale',
    ...(work.outcome || {}),
    selectedCalculatorId: calcId,
    [documentRootKey(doc.category)]: bodies.map((b) => ({ ...b, name: doc.name })),
  };
};

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
      isSale: String(payload?.leadData?.result || '').toLowerCase() === 'sale',
      includeSystemGenerated: true,
    });
  } catch (e) {
    console.warn('[offlineLeadStore] could not attach documents to the submit:', e);
    return { agreements: [], orderSheets: [] };
  }
};

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
  discardOfflineDocumentFile(filed?.uri);
};

const isAlreadySubmitted = async (work: OfflineLeadWork): Promise<boolean> => {
  const leadId = work.serverIds.leadId;
  if (!leadId) return false;
  const res = await LeadService.getSalesDealById(leadId);
  const lead = res?.data?.data || res?.data?.lead || res?.data || {};
  return String(lead?.jobBuilder?.status || '').toLowerCase() === 'submitted';
};

const isFundingAlreadySubmitted = async (leadId: string): Promise<boolean> => {
  const res = await FundingService.getFunding(leadId);
  return res?.data?.data?.funding?.status === 'submitted';
};

const isConsentAlreadyFiled = async (leadId: string, kind: ConsentFormKind): Promise<boolean> => {
  const res = await LeadService.getSalesDealById(leadId);
  const lead = res?.data?.data || res?.data?.lead || res?.data || {};
  return hasFiledConsentReport(lead, kind);
};

const resolveQueuedLeadAddress = async (payload: Record<string, any>): Promise<string | null> => {
  const address = payload?.fullAddress;
  const coords = coordsFromLeadPayload(payload);
  if (!needsAddressResolution(address, coords)) return null;

  let reverseGeocoded: string | null = null;
  try {
    if (coords) reverseGeocoded = await reverseGeocode(coords);
  } catch {
  }

  const { address: resolved, source } = resolveSyncAddress({ address, coords, reverseGeocoded });
  return source === 'reverse-geocoded' ? resolved : null;
};

const resolveQueuedFormAddress = async (
  work: OfflineLeadWork,
  payload: Record<string, unknown>
): Promise<string | null> => {
  const leadAddress = (work.lead as Record<string, any> | undefined)?.fullAddress;
  const fromLead = resolveFormAddress({ address: payload.address, leadAddress });
  if (fromLead) return fromLead;

  const coords = parseCoordsAddress(payload.address as string);
  if (!coords) return null;
  let reverseGeocoded: string | null = null;
  try {
    reverseGeocoded = await reverseGeocode(coords);
  } catch {
  }
  return resolveFormAddress({ address: payload.address, reverseGeocoded });
};

type StepResult = {
  leadId?: string;
  appointmentId?: string;
  calculators?: Record<string, string>;
};

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
      const resolvedAddress = await resolveQueuedLeadAddress(body);
      const res = await LeadService.createLead(
        resolvedAddress ? applyResolvedAddress(body, resolvedAddress) : body
      );
      if (!isSuccessfulCreate(res?.data)) {
        throw Object.assign(new Error(res?.data?.message || 'create refused'), { response: res });
      }
      const id = readCreatedId(res?.data);
      if (!id) throw new Error('lead created but the response carried no _id');
      uploadQueueManager.rekeyLead(work.clientId, id);
      offlinePhotoDeleteQueue.rekeyLead(work.clientId, id);
      rekeyLeadWorkflow(work.clientId, id);
      rekeyActivityLogs(work.clientId, id);
      rekeyDeliveryPreference(work.clientId, id);
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
        const existing = readExistingAppointmentId(err);
        if (existing) return { appointmentId: existing };
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
        const createBody: any = { ...(calc.payload || {}) };
        delete createBody.dropPrice;
        const res = await LeadService.createCalculator(apptId, send(createBody));
        const id = readCreatedId(res?.data);
        if (!id) throw new Error('calculator created but the response carried no _id');
        out[calc.clientId] = id;
      }
      return { calculators: out };
    }

    case 'calculatorState': {
      for (const calc of work.calculators) {
        const id = calc.serverId || work.serverIds.calculators[calc.clientId];
        if (!id) throw new Error(`no server id for calculator ${calc.clientId}`);
        const res = await LeadService.updateCalculator(id, send(calc.payload));
        adoptDropIdsIntoWork(work.clientId, calc.clientId, calc.payload?.dropPrice, res);
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
        if (!readIs409(err)) throw err;
      }
      return {};
    }

    case 'funding': {
      if (!leadId) throw new Error('no lead id for the funding');
      const body = send(work.funding) as any;
      await FundingService.savePayments(leadId, {
        contractPrice: Number(body?.contractPrice) || 0,
        payments: Array.isArray(body?.payments) ? body.payments : [],
        payMode: body?.payMode === 'upfront' ? 'upfront' : 'split',
      });
      return {};
    }

    case 'fundingCollect': {
      if (!leadId) throw new Error('no lead id for the collected checks');
      // Only on a RETRY whose first attempt was ambiguous: a second POST on a row already
      // collected is refused, and that refusal would park a sold deal. The happy path costs
      // no extra read.
      const already = guarded
        ? new Set(
            ((await FundingService.getFunding(leadId))?.data?.data?.funding?.payments || [])
              .filter((p) => p.collected)
              .map((p) => p.pid)
          )
        : new Set<string>();
      for (const pid of work.fundingCollected || []) {
        if (already.has(pid)) continue;
        await FundingService.markCheckCollected(leadId, pid);
      }
      return {};
    }

    case 'fundingSubmit': {
      if (!leadId) throw new Error('no lead id for the funding submit');
      // A repeat submit is rejected, and the rejection reads like a real failure. Read the
      // record instead: already-submitted is the state this step wanted anyway.
      if (guarded && (await isFundingAlreadySubmitted(leadId))) return {};
      await FundingService.submitFunding(leadId);
      return {};
    }

    case 'submit': {
      if (!leadId) throw new Error('no lead id for the submit');
      if (guarded && (await isAlreadySubmitted(work))) return {};
      const payload = send(work.submit) as Record<string, any>;
      const docs = await buildQueuedSubmitDocuments(work, payload);
      await LeadService.submitJobBuilder(leadId, { ...payload, ...docs });
      return {};
    }

    case 'chat': {
      // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
      console.log('[CheckInTrace] chat step running for leadId=%s', leadId);
      if (!leadId) throw new Error('no lead id for the chat');
      const chatId = await ChatService.getChatByLeadId(leadId);
      // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
      console.log('[CheckInTrace] chat step resolved id=%s', chatId);
      patchOfflineWork(work.clientId, (w) => ({ ...w, chatCreated: true }));
      return {};
    }

    case 'consent': {
      const consentLeadId = work.serverIds.leadId;
      if (!consentLeadId) throw new Error('the consent form has no lead id to file against');

      for (const form of (work.consents || []).filter((c) => !c.uploadedAt)) {
        let pdfPath = form.pdfPath;
        if (!form.submittedAt || !pdfPath) {
          if (guarded && !form.knownFiledBefore && (await isConsentAlreadyFiled(consentLeadId, form.kind))) {
            patchOfflineConsent(work.clientId, form.clientId, {
              submittedAt: new Date().toISOString(),
              uploadedAt: new Date().toISOString(),
            });
            discardOfflineDocumentFile(form.signatureUri);
            continue;
          }

          const resolvedAddress = await resolveQueuedFormAddress(work, form.payload);
          const formPayload = resolvedAddress
            ? { ...form.payload, address: resolvedAddress }
            : form.payload;
          if (resolvedAddress) {
            patchOfflineConsent(work.clientId, form.clientId, { payload: formPayload });
          }

          pdfPath = await submitConsentForm({
            kind: form.kind,
            leadId: consentLeadId,
            payload: {
              ...formPayload,
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
          pdfPath = await persistOfflineDocumentFile(
            pdfPath,
            `${form.kind}_${form.clientId}.pdf`
          );
          patchOfflineConsent(work.clientId, form.clientId, {
            submittedAt: new Date().toISOString(),
            pdfPath,
          });
        }

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
      await LeadService.workLead(leadId, String(work.workStarted?.userId || ''));
      await refreshLeadLists();
      return {};
    }

    case 'workEnd': {
      // Releasing the rep from the lead. Queued because `endWorkLead` is a bare PUT: offline it
      // threw, the caller caught it, and the rep stayed live on the ops board for good. Runs
      // after 'work' (UPLOAD_STEPS order), so a start and an end queued in one offline stint
      // replay in the order they happened.
      if (!leadId) throw new Error('cannot release work on a lead with no server id');
      await LeadService.endWorkLead(leadId);
      await refreshLeadLists();
      return {};
    }

    case 'customer': {
      const edit = work.customer;
      if (!edit) return {};
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
      await queryClient
        .invalidateQueries({ queryKey: ['lead', leadId] })
        .catch(() => undefined);
      await refreshLeadLists();
      return {};
    }

    case 'archive': {
      if (!leadId) throw new Error('cannot archive a lead with no server id');
      await LeadService.archiveLead(leadId, work.archive?.isArchive === true);
      await refreshLeadLists();
      return {};
    }

    case 'delete': {
      if (!leadId) throw new Error('cannot delete a lead with no server id');
      try {
        await LeadService.deleteLead(leadId);
      } catch (err) {
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

const latest = (work: OfflineLeadWork): OfflineLeadWork => findOfflineWork(work.clientId) || work;

const adoptDropIdsIntoWork = (
  workClientId: string,
  calcClientId: string,
  sentDrops: any,
  response: any
): void => {
  if (!Array.isArray(sentDrops) || !sentDrops.length) return;
  const adopted = adoptServerDropIds(sentDrops, readServerDrops(response));
  if (adopted === sentDrops) return;
  patchOfflineWork(workClientId, (w) => ({
    ...w,
    calculators: w.calculators.map((c) =>
      c.clientId === calcClientId ? { ...c, payload: { ...c.payload, dropPrice: adopted } } : c
    ),
  }));
};

const uploadOne = async (start: OfflineLeadWork): Promise<void> => {
  let work = putOfflineWork({ ...start, status: 'uploading' });
  let guarded = false;

  console.log(
    '[LeadSync] start %s origin=%s workStarted=%s chatCreated=%s done=%s',
    work.clientId,
    work.origin,
    work.workStarted ? work.workStarted.userId : 'NONE',
    work.chatCreated === true,
    JSON.stringify(work.done)
  );

  for (;;) {
    const step = nextUploadStep(work);
    if (!step) {
      // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
      console.log(
        '[LeadSync] done %s leadId=%s steps=%s',
        work.clientId,
        work.serverIds.leadId || 'NONE',
        JSON.stringify(work.done)
      );
      const finished = putOfflineWork({ ...work, status: 'uploaded' });
      if (finished.deleteLead) removeOfflineWork(finished.clientId);
      return;
    }
    if (!isOnline()) {
      putOfflineWork({ ...work, status: 'draft' });
      return;
    }

    try {
      const sent = work;
      // ⚠️ TEMPORARY DIAGNOSTIC — remove before release.
      console.log('[LeadSync] step %s -> %s', work.clientId, step);
      const ids = await runStep(sent, step, guarded);
      const now = latest(work);
      let landed = markStepDone(now, step, ids);
      if (stepPayloadChanged(sent, now, step)) landed = rearmStep(landed, step);
      work = putOfflineWork(
        nextUploadStep(landed) ? { ...landed, status: 'uploading' } : landed
      );
      guarded = false;
    } catch (err: any) {
      console.log(
        '[LeadSync] FAILED %s step=%s status=%s body=%s',
        work.clientId,
        step,
        err?.response?.status,
        JSON.stringify(err?.response?.data || err?.message)
      );
      const decision: StepDecision = decideAfterStepError(err, work, step);
      if (decision === 'done') {
        work = putOfflineWork(markStepDone(latest(work), step));
        continue;
      }
      if (decision === 'retry-guarded' && !guarded) {
        guarded = true;
        work = putOfflineWork({ ...latest(work), status: 'uploading', lastError: messageOfError(err) });
        continue;
      }
      putOfflineWork(applyStepDecision(latest(work), decision, messageOfError(err)));
      return;
    }
  }
};

export const drainOfflineWork = async (): Promise<void> => {
  load();
  console.log(
    '[LeadSync] drain called online=%s alreadyDraining=%s rows=%s drainable=%s',
    isOnline(),
    draining,
    mine().length,
    uploadableWork(mine()).length
  );
  if (draining || !isOnline()) return;
  draining = true;
  try {
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

export const pendingOfflineWorkCount = (): number => {
  load();
  return uploadableWork(mine()).length;
};

export const isOfflineWorkDraining = (): boolean => draining;

export const runUpload = (): void => {
  drainOfflineWork().catch((e) => console.warn('[leadStore] upload failed', e));
};

let syncStarted = false;

const RETRY_SWEEP_MS = 60_000;

export const startOfflineWorkSync = (): void => {
  if (syncStarted) return;
  syncStarted = true;

  onReconnect(() => runUpload());

  AppState.addEventListener('change', (next) => {
    if (next === 'active') runUpload();
  });

  setInterval(() => {
    if (!isOnline()) return;
    load();
    if (!uploadableWork(mine()).length) return;
    runUpload();
  }, RETRY_SWEEP_MS);

  runUpload();
};
