/**
 * A local record that a consent form / roof waiver has ALREADY been filed for a lead.
 *
 * ⚠️ THE BUG THIS EXISTS TO PREVENT. A rep filed the consent form online, went offline, came
 * back to the lead - and the app offered the blank form again, letting them collect a SECOND
 * signature for the same consent. A duplicate signed customer record is not a cosmetic glitch.
 *
 * Why it happened: "already filed" was read from `lead.generatedReports`, which is SERVER data.
 * Offline the lead comes from cache, and a cached copy taken before the submission has no such
 * report - so the only proof of the submission lived on the server the app could not reach. The
 * offline queue was no help either: a form submitted ONLINE never enters that queue, so it left
 * no local trace at all.
 *
 * ⚠️ The remedy is the same rule as the Investment Center lock (see `lead-center.md`): the
 * moment something becomes true on THIS device, write it down here. Do not rely on being able
 * to ask the server about it later.
 *
 * Pure so it can be tested - the callers import RN and blob-util (CLAUDE.md §6).
 */
import type { ConsentFormKind } from './consent-forms';

export interface FiledConsentEntry {
  leadId: string;
  kind: ConsentFormKind;
  filedAt: string;
}

export const CONSENT_FILED_CACHE = 'consent-filed';

const keyOf = (leadId: string, kind: ConsentFormKind): string => `${leadId}::${kind}`;

export const addFiledConsent = (
  log: FiledConsentEntry[] | null | undefined,
  leadId: string,
  kind: ConsentFormKind,
  now: number = Date.now()
): FiledConsentEntry[] => {
  const id = String(leadId || '');
  if (!id) return log || [];
  const next = (log || []).filter((e) => keyOf(e.leadId, e.kind) !== keyOf(id, kind));
  next.push({ leadId: id, kind, filedAt: new Date(now).toISOString() });
  return next;
};

export const hasFiledLocally = (
  log: FiledConsentEntry[] | null | undefined,
  leadId: string,
  kind: ConsentFormKind
): boolean => {
  const id = String(leadId || '');
  return !!id && (log || []).some((e) => e.leadId === id && e.kind === kind);
};

/**
 * Forget the local record - for a genuine RESET, where the rep deliberately clears the form so
 * it can be filled again.
 *
 * ⚠️ Only an explicit reset may call this. A failed read must never clear the log; that is the
 * mistake this whole module exists to undo.
 */
export const removeFiledConsent = (
  log: FiledConsentEntry[] | null | undefined,
  leadId: string,
  kind: ConsentFormKind
): FiledConsentEntry[] => {
  const id = String(leadId || '');
  if (!id) return log || [];
  return (log || []).filter((e) => keyOf(e.leadId, e.kind) !== keyOf(id, kind));
};

/**
 * Has this consent been filed, by ANY route?
 *
 * The three sources are deliberately OR-ed and ordered cheapest-first. Each one alone has a
 * blind spot:
 *  - `serverFiled`  - absent whenever the lead came from a cache older than the submission.
 *  - `queued`       - only ever true for a form submitted OFFLINE.
 *  - `filedLocally` - the gap both of the above leave: submitted online, read back offline.
 *
 * ⚠️ Never narrow this to one source. Each was, at some point, the only one that knew.
 */
export const consentAlreadyFiled = ({
  serverFiled = false,
  queued = false,
  filedLocally = false,
  signedThisSession = false,
  leadSold = false,
}: {
  serverFiled?: boolean;
  queued?: boolean;
  filedLocally?: boolean;
  /** In-memory flag from the screen that just took the signature; dies on unmount. */
  signedThisSession?: boolean;
  /** A sold lead is past the consent stage by definition. */
  leadSold?: boolean;
}): boolean => serverFiled || queued || filedLocally || signedThisSession || leadSold;

/** Entries for leads that no longer exist, so the log cannot grow without bound. */
export const pruneFiledConsents = (
  log: FiledConsentEntry[] | null | undefined,
  keepLeadIds: ReadonlySet<string>
): FiledConsentEntry[] => (log || []).filter((e) => keepLeadIds.has(e.leadId));

/**
 * What a tap on a consent / waiver row should do.
 *
 * ⚠️ A FILED form NEVER re-opens the blank form. The customer has already signed; offering
 * the form again is how a second signature gets collected for the same consent. The rep sees the
 * filed PDF, or - when that cannot be fetched without a connection - a message saying so.
 *
 * ⚠️ Detection was never the problem in any of the three reports of this bug. Each time the
 * row rendered "Already Generated" from the correct value while the tap path ignored it.
 */
export type ConsentPressAction = 'open-form' | 'view-pdf' | 'explain-offline';

export const consentPressAction = ({
  filed,
  canFetchPdf,
}: {
  filed: boolean;
  /** Is the filed PDF reachable - i.e. we hold a report row AND have a connection? */
  canFetchPdf: boolean;
}): ConsentPressAction => {
  if (!filed) return 'open-form';
  return canFetchPdf ? 'view-pdf' : 'explain-offline';
};
