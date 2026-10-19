/**
 * Agreements and order sheets signed offline, shown in Lead Center before they reach the server.
 *
 * `addOfflineJobDocument` already copies every offline document to
 * `DocumentDirectory/offline-job-documents/` and records it on the work item, so the bytes are on
 * disk from the moment the rep signs. Lead Center simply never looked at them: it read
 * `lead.jobBuilderDocuments`, which only the server can fill, so a lead sold offline showed
 * "0 Files" until the queue drained. These rules merge the queued copies into that view.
 *
 * ⚠️ The local file is DELETED the instant its upload lands (`markDocumentUploaded` calls
 * `discardOfflineDocumentFile`), so a row with `uploadedAt` points at a path that no longer
 * exists. Those are dropped here — the server copy arrives in `jobBuilderDocuments` to replace
 * them, and showing a dead `file://` would give the rep a document that opens to nothing.
 */

export type OfflineDocCategory = 'agreement' | 'orderSheet' | 'downPaymentReceipt';

export interface QueuedDocumentLike {
  clientId: string;
  category: string;
  name: string;
  uri: string;
  contentType?: string;
  uploadedAt?: string;
}

export interface ResolvedDocumentGroups {
  agreements: any[];
  orderSheets: any[];
  downPaymentReceipts: any[];
}

const EMPTY: ResolvedDocumentGroups = { agreements: [], orderSheets: [], downPaymentReceipts: [] };

const GROUP_OF: Record<string, keyof ResolvedDocumentGroups> = {
  agreement: 'agreements',
  orderSheet: 'orderSheets',
  downPaymentReceipt: 'downPaymentReceipts',
};

const LABEL_OF: Record<string, string> = {
  agreement: 'Agreement',
  orderSheet: 'Order Sheet',
  downPaymentReceipt: 'Down Payment Receipt',
};

/**
 * The documents still waiting to upload. A row that has already uploaded is excluded, because
 * its file is gone.
 */
export const pendingQueuedDocuments = (
  documents: QueuedDocumentLike[] | undefined | null
): QueuedDocumentLike[] =>
  (documents || []).filter(
    (d) => !!d && !d.uploadedAt && !!d.uri && !!GROUP_OF[d.category]
  );

/** A queued document in the shape `DocumentItem` renders — same keys the server rows map to. */
export const toDisplayDocument = (doc: QueuedDocumentLike): any => ({
  uri: doc.uri,
  name: LABEL_OF[doc.category] || 'Document',
  // No `serverId`: it has no server row yet, and callers use that to tell the two apart.
  serverId: undefined,
  localId: doc.clientId,
  size: undefined,
  documentType: doc.category,
  pendingUpload: true,
});

/**
 * Merge the queued documents into the groups Lead Center already renders.
 *
 * ⚠️ Queued rows go AFTER the server rows in each group. The server copies are the settled truth;
 * the pending ones are the tail the rep just added.
 *
 * ⚠️ A document is listed once. A queued row whose upload landed between the read and this merge
 * would otherwise appear twice — once from the server, once from the queue — so when the server
 * group already holds as many rows as the queue expected to add, the queued tail is dropped.
 */
export const mergeQueuedDocuments = (
  resolved: Partial<ResolvedDocumentGroups> | null | undefined,
  documents: QueuedDocumentLike[] | undefined | null
): ResolvedDocumentGroups => {
  const base: ResolvedDocumentGroups = {
    agreements: resolved?.agreements || [],
    orderSheets: resolved?.orderSheets || [],
    downPaymentReceipts: resolved?.downPaymentReceipts || [],
  };

  const pending = pendingQueuedDocuments(documents);
  if (!pending.length) return base;

  const out: ResolvedDocumentGroups = { ...base };

  (Object.keys(GROUP_OF) as OfflineDocCategory[]).forEach((category) => {
    const group = GROUP_OF[category];
    const queued = pending.filter((d) => d.category === category);
    if (!queued.length) return;

    // The server already shows at least as many as we queued: it has caught up, so adding the
    // local copies would double every row.
    const serverRows = base[group].filter((d: any) => !d?.pendingUpload);
    if (serverRows.length >= queued.length) return;

    const shown = queued.slice(serverRows.length);
    out[group] = [...base[group], ...shown.map(toDisplayDocument)];
  });

  return out;
};

/** True when anything in the groups is still waiting to upload — drives the "pending" hint. */
export const hasPendingDocuments = (groups: Partial<ResolvedDocumentGroups> | null | undefined): boolean =>
  (['agreements', 'orderSheets', 'downPaymentReceipts'] as const).some((g) =>
    (groups?.[g] || []).some((d: any) => d?.pendingUpload)
  );

export const emptyDocumentGroups = (): ResolvedDocumentGroups => ({ ...EMPTY });
