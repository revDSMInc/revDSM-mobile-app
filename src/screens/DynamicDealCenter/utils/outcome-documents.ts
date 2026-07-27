import { LeadService } from '../../../services/api/leads';

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
  if (!leadId || !calculatorId) return null;
  try {
    const res = await LeadService.getLeadOutcomeByCalculator(leadId, calculatorId);
    const outcome = unwrapOutcome(res?.data);
    const docs = outcome?.leadOutcomeDocuments;
    if (!docs) return null;
    return {
      agreements: docs.agreements || [],
      orderSheets: docs.orderSheets || [],
    };
  } catch (e) {
    console.warn('[outcome-documents] calculator-scoped document read failed:', e);
    return null;
  }
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

  const mapped: LocalDocFile[] = all.map((d, i) => {
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

// DISABLED — the LEAD-scoped outcome read (`GET /lead/v1/{leadId}/outcome`).
//
// This is what web calls (`api/leads.js#getJobBuilder`, used by
// `DocumentUploadDialog.syncFromServer`), and it returns every document on the lead
// regardless of calculator. The dynamic flow has its own calculator-scoped backend
// contract, so mobile must read `/outcome/{calculatorId}` instead — kept here only to
// document the alternative. Do not re-enable without confirming the backend intends
// the dynamic flow to read lead-scoped documents.
//
// export async function fetchLeadOutcomeDocumentRows(
//   leadId?: string
// ): Promise<OutcomeDocRows | null> {
//   if (!leadId) return null;
//   try {
//     const res = await LeadService.getLeadOutcome(leadId);
//     const outcome = unwrapOutcome(res?.data);
//     const docs = outcome?.leadOutcomeDocuments;
//     if (!docs) return null;
//     return { agreements: docs.agreements || [], orderSheets: docs.orderSheets || [] };
//   } catch (e) {
//     console.warn('[outcome-documents] lead-scoped document read failed:', e);
//     return null;
//   }
// }
