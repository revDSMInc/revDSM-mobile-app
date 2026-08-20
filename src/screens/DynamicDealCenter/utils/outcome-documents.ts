import { LeadService } from '../../../services/api/leads';
import { readAgreementSent, AgreementSent } from '../../../utils/agreement-delivery';

/**
 * Outcome document helpers — the ONE place that turns the backend's S3 document
 * rows into the local file shape the summary cards render and the draft persists.
 *
 * Web references:
 *  - `api/leads.js#getJobBuilder` → `GET /lead/v1/{leadId}/outcome`, whose body
 *    carries `leadOutcomeDocuments: { agreements, orderSheets }`. This LEAD-scoped
 *    read is what `document-scanner/DocumentUploadDialog.js#syncFromServer` uses
 *    after an upload to re-sync from the server.
 *  - `utils/job-builder-document-utils.js#mapS3DocArrayToLocalGroup` — maps those
 *    rows to `[{ files: [...] }]` groups with signed URLs, which is the shape the
 *    dynamic job builder keeps at `jobState.agreements` / `jobState.orderSheets`.
 */

export interface OutcomeDocRows {
  agreements: any[];
  orderSheets: any[];
}

export interface LocalDocFile {
  id: string;
  serverId: string | null;
  name: string;
  /** Signed URL (expires) — both `url` and `uri` are set so either reader works. */
  url: string;
  uri: string;
  contentType: string;
  filePath: string | null;
  bucketName: string | null;
  documentType: 'agreement' | 'orderSheet';
  isNew: false;
}

const isEmptyRows = (rows?: OutcomeDocRows | null) =>
  !rows || (!(rows.agreements || []).length && !(rows.orderSheets || []).length);

/** Unwrap the outcome body exactly like web's `extractCalculatorOutcome`. */
const unwrapOutcome = (body: any) =>
  body?.data?.outcome ?? body?.outcome ?? body?.data ?? body;

/**
 * Read the outcome's document rows for THIS CALCULATOR
 * (`GET /lead/v1/{leadId}/outcome/{calculatorId}`).
 *
 * The dynamic flow is calculator-scoped end to end — the backend was changed for it,
 * so this is the endpoint to read. The LEAD-scoped `GET /lead/v1/{leadId}/outcome`
 * (web's `getJobBuilder`, which `DocumentUploadDialog.syncFromServer` uses) is
 * DELIBERATELY NOT called here; see the disabled fallback at the bottom of this file.
 */
export async function fetchOutcomeDocumentRows(
  leadId?: string,
  calculatorId?: string
): Promise<OutcomeDocRows | null> {
  return (await fetchOutcomeDocumentRowsWithDelivery(leadId, calculatorId)).rows;
}

/**
 * The same single read, ALSO returning the `agreementSent` delivery block.
 *
 * The signed agreement's SMS / email result rides on this very response — as a SIBLING
 * of `outcome`, which is why `unwrapOutcome` (it returns `body.data.outcome`) cannot
 * see it and every caller until now dropped it on the floor. Exposing it here means the
 * post-sign refresh reports delivery for FREE: no extra request, and no second endpoint
 * that could disagree with the documents it is reported alongside.
 *
 * ⚠️ `agreementSent` describes the LAST send on this outcome and PERSISTS on the record,
 * so it is only meaningful immediately after a signature. Do not wire it to a mount-time
 * or background read — that would re-announce a week-old delivery failure on every open.
 * `fetchOutcomeDocumentRows` above deliberately drops it for exactly that reason.
 */
export async function fetchOutcomeDocumentRowsWithDelivery(
  leadId?: string,
  calculatorId?: string
): Promise<{ rows: OutcomeDocRows | null; agreementSent: AgreementSent | null }> {
  if (!leadId || !calculatorId) return { rows: null, agreementSent: null };
  try {
    const res = await LeadService.getLeadOutcomeByCalculator(leadId, calculatorId);
    const agreementSent = readAgreementSent(res?.data);
    const outcome = unwrapOutcome(res?.data);
    const docs = outcome?.leadOutcomeDocuments;
    if (!docs) return { rows: null, agreementSent };
    return {
      rows: {
        agreements: docs.agreements || [],
        orderSheets: docs.orderSheets || [],
      },
      agreementSent,
    };
  } catch (e) {
    console.warn('[outcome-documents] calculator-scoped document read failed:', e);
    return { rows: null, agreementSent: null };
  }
}

/**
 * Drop the duplicate agreement row the backend files on SUBMIT.
 *
 * A submitted job comes back with the same PDF twice: the real one
 * (`Agreement_OFN-A_….pdf`) and a second copy at a generated `…-0-document.pdf`
 * path with an **empty `name`** — identical `fileData.size` and identical
 * `base64Data`, but a distinct `_id` AND `filePath`, so no identity-based dedupe
 * downstream can merge them.
 *
 * ⚠️ Must run on the RAW server rows. Every display mapper defaults the name
 * (`d.name || 'Agreement'`), so by the time a row reaches the summary card the
 * empty name — the only thing distinguishing the duplicate — is gone.
 *
 * ⚠️ This is a DISPLAY-LEVEL WORKAROUND, requested as such. The duplicate row still
 * exists on the server; the real fix is to stop writing it at submit.
 *
 * Falls back to the full list when NO agreement is named, so a deal whose agreements
 * are all unnamed still renders them instead of an empty card.
 */
export function dropUnnamedAgreements<T extends Record<string, any>>(rows: T[]): T[] {
  const list = rows || [];
  const named = list.filter((d) => String(d?.name || '').trim());
  return named.length ? named : list;
}

/**
 * `dropUnnamedAgreements` for a MIXED row list, keyed off each row's group.
 *
 * ⚠️ Order sheets are deliberately untouched: the same endpoint legitimately files
 * them with an empty name — the very payload that exposed this bug has
 * `orderSheets[0].name === ""` — so filtering them would hide the only order sheet
 * on the deal.
 */
export function dropUnnamedAgreementRows<T extends Record<string, any>>(rows: T[]): T[] {
  const list = rows || [];
  const isAgreement = (d: any) => (d?.documentType || d?._group) === 'agreement';
  const kept = new Set(dropUnnamedAgreements(list.filter(isAgreement)));
  return list.filter((d) => !isAgreement(d) || kept.has(d));
}

/**
 * Wait for the `agreementSent` delivery block to appear on the outcome.
 *
 * The sign endpoint files the PDF and sends the customer their copy, and those two do
 * NOT necessarily land together — the send can be finishing while the app is already
 * reading the documents back (in one captured trace the outcome's `updatedAt` is 3.5 s
 * after the agreement row's `createdAt`). A single read taken ~300 ms after signing can
 * therefore find the documents and no delivery block, which presents as the notice
 * silently never appearing.
 *
 * Bounded and lazy: the caller passes whatever the read it ALREADY made returned, and
 * this only spends requests when that came back empty. It stops at the first hit, so
 * the normal case costs nothing.
 *
 * ⚠️ Deliberately gives up rather than polling on — a delivery notice is worth two
 * cheap reads, never an open-ended loop on a screen the rep is still using.
 */
export async function pollAgreementDelivery(
  leadId?: string,
  calculatorId?: string,
  attempts: number = 2,
  delayMs: number = 1500
): Promise<AgreementSent | null> {
  if (!leadId || !calculatorId) return null;
  for (let i = 0; i < attempts; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      const res = await LeadService.getLeadOutcomeByCalculator(leadId, calculatorId);
      const sent = readAgreementSent(res?.data);
      if (sent) return sent;
    } catch (e) {
      console.warn('[outcome-documents] agreement delivery re-read failed:', e);
      return null;
    }
  }
  return null;
}

/**
 * Resolve S3 document rows to local file entries with signed URLs
 * (web `hydrateJobBuilderDocumentGroups` → `mapS3DocArrayToLocalGroup`).
 */
export async function resolveOutcomeDocRows(
  rows?: OutcomeDocRows | null
): Promise<OutcomeDocRows> {
  const empty: OutcomeDocRows = { agreements: [], orderSheets: [] };
  if (isEmptyRows(rows)) return empty;

  const all = [
    ...((rows!.agreements || []) as any[]).map((d) => ({ ...d, _group: 'agreement' })),
    ...((rows!.orderSheets || []) as any[]).map((d) => ({ ...d, _group: 'orderSheet' })),
  ];
  const paths = all
    .map((d) => ({ filePath: d.filePath, bucketName: d.bucketName }))
    .filter((p) => p.filePath && p.bucketName);

  let urls: any[] = [];
  if (paths.length) {
    try {
      const urlRes = await LeadService.getSecureUrls(paths);
      urls = (urlRes.data?.data || urlRes.data || []) as any[];
    } catch (e) {
      console.warn('[outcome-documents] secure URL resolution failed:', e);
    }
  }

  const mapped: LocalDocFile[] = dropUnnamedAgreementRows(all).map((d, i) => {
    const u = urls.find((x) => x.filePath === d.filePath);
    const type = (d.documentType || d._group) as 'agreement' | 'orderSheet';
    const url = u?.secureUrl || u?.url || d.filePath || '';
    return {
      id: String(d._id || `s3-${i}`),
      serverId: d._id || null,
      name: d.name || (type === 'agreement' ? 'Agreement' : 'Order Sheet'),
      url,
      uri: url,
      contentType: d.fileData?.contentType || d.contentType || '',
      filePath: d.filePath || null,
      bucketName: d.bucketName || null,
      documentType: type,
      isNew: false,
    };
  });

  return {
    agreements: mapped.filter((m) => m.documentType === 'agreement'),
    orderSheets: mapped.filter((m) => m.documentType === 'orderSheet'),
  };
}

/**
 * Documents currently stored for this calculator, resolved for display. Uses the
 * rows the outcome GET already echoed when it has any, else re-reads the same
 * calculator-scoped endpoint.
 */
export async function loadResolvedOutcomeDocuments(
  leadId?: string,
  calculatorId?: string
): Promise<OutcomeDocRows> {
  // Always READ, never reuse the rows the draft's outcome GET happened to echo. That
  // echo is captured once per open, so after a document upload it is already stale —
  // refetching this query then "resolved" the pre-upload list and the new document
  // disappeared again. It is the same endpoint either way; only freshness differs.
  return resolveOutcomeDocRows(await fetchOutcomeDocumentRows(leadId, calculatorId));
}

/**
 * The LEAD-scoped outcome document read (`GET /lead/v1/{leadId}/outcome`).
 *
 * This is what web calls (`api/leads.js#getJobBuilder`) and it returns every document
 * on the lead regardless of calculator. It is REQUIRED for agreements: they are filed
 * LEAD-scoped by the sign / remote-sign endpoints, and the calculator-scoped outcome
 * (`fetchOutcomeDocumentRows`) does NOT echo them (see the comment in
 * `SummaryFinalizeCards.handleAgreementGenerated` and the `agreement-docs-lead-scoped-
 * not-calc` note). Used to surface a REMOTELY-signed agreement in the summary the
 * moment it is filed — the calc-scoped read would come back empty.
 */
export async function fetchLeadOutcomeDocumentRows(
  leadId?: string
): Promise<OutcomeDocRows | null> {
  if (!leadId) return null;
  try {
    // ⚠️ Reads `GET lead/v1/{leadId}/outcome/documents/download`, NOT the bare
    // `…/outcome` this used to call — that route is deprecated and 404s. The download
    // endpoint is the OTHER lead-scoped one, is still supported (web calls it), and
    // returns the same `{ agreements, orderSheets }` shape `leadOutcomeDocuments` did,
    // so the lead-scoped guarantee this function exists for is preserved: a remotely
    // signed agreement is filed lead-scoped and the calc-scoped read cannot see it.
    const res = await LeadService.downloadOutcomeDocuments(leadId);
    const body: any = res?.data;
    const docs = body?.data ?? body;
    if (!docs) return null;
    return { agreements: docs.agreements || [], orderSheets: docs.orderSheets || [] };
  } catch (e) {
    console.warn('[outcome-documents] lead-scoped document read failed:', e);
    return null;
  }
}
