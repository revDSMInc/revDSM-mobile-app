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
 * Read the LEAD-scoped outcome's document rows (web `getJobBuilder`). The
 * CALCULATOR-scoped outcome (`/outcome/{calcId}`) does not reliably echo
 * `leadOutcomeDocuments` — a submitted/just-written deal comes back with none —
 * so this is the dependable source for "which documents does this lead have".
 */
export async function fetchLeadOutcomeDocumentRows(
  leadId?: string
): Promise<OutcomeDocRows | null> {
  if (!leadId) return null;
  try {
    const res = await LeadService.getLeadOutcome(leadId);
    const outcome = unwrapOutcome(res?.data);
    const docs = outcome?.leadOutcomeDocuments;
    if (!docs) return null;
    return {
      agreements: docs.agreements || [],
      orderSheets: docs.orderSheets || [],
    };
  } catch (e) {
    console.warn('[outcome-documents] lead-scoped document read failed:', e);
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
 * Documents currently on the server for this lead, resolved for display. Prefers
 * the rows the calculator-scoped outcome echoed (when it has any) and falls back
 * to the lead-scoped read.
 */
export async function loadResolvedOutcomeDocuments(
  leadId?: string,
  echoedRows?: OutcomeDocRows | null
): Promise<OutcomeDocRows> {
  const rows = isEmptyRows(echoedRows)
    ? await fetchLeadOutcomeDocumentRows(leadId)
    : echoedRows;
  return resolveOutcomeDocRows(rows);
}
