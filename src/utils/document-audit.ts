/**
 * What an "Update" in the scan sheet actually changed, and how the resulting
 * activity log names it.
 *
 * The scan sheet is one button for two different events: the rep may ADD pages,
 * REMOVE filed ones, or both, and `DocumentScannerModal.onSave` hands back only
 * the SURVIVORS — the removals have to be recovered by diffing that list against
 * what the card held before it opened.
 *
 * Pure and RN-free on purpose (same reason as `utils/uploaded-document-refs.ts`):
 * the one consumer, `widgets/components/dynamic-job-builder/agreement/
 * SummaryFinalizeCards.tsx`, pulls in React Native and is untestable under jest
 * here — and a removal that is silently mis-attributed to the wrong category, or
 * a diff that reports a document nobody touched, leaves no trace on the device.
 */

import { DocumentRef, toDocumentRefs } from './uploaded-document-refs';

export type DocumentAuditCategory = 'agreement' | 'orderSheet';
export type DocumentAuditKind = 'uploaded' | 'removed' | 'generated';

/**
 * Which control the rep pressed to reach the sheet. The three are separate rows on
 * one card and lead to different places, so a bare "they opened something" row
 * would not tell them apart.
 */
export type DocumentOpenSource = 'generate' | 'add_document' | 'edit_documents';

export interface DocumentAuditDescriptor {
  /** `meta.action` — what the portal timeline routes on. */
  action: string;
  fieldName: string;
  fieldLabel: string;
  /** `action_type` for `logEvent`. */
  eventType: string;
}

/**
 * ⚠️ The table is the WHOLE vocabulary — a category/kind pair that is not in here
 * yields `null` and nothing is logged, rather than a row whose `action` the portal
 * cannot route. `orderSheet` has no `generated` row ON PURPOSE: there is no order
 * sheet generator, and aliasing it onto the upload row would report a document as
 * having been produced by a button that does not exist.
 *
 * `agreement_uploaded` reproduces the log this card already sent verbatim (the
 * `fieldLabel: 'Agreement Uploaded'` is web parity: `document-summary-cards.js`
 * labels the UPLOADED path that way, and only the GENERATED path 'Agreement').
 * `order_sheet_uploaded` matches the legacy job builder's own helper
 * (`utils/activity-log/job-builder-logs.ts#logOrderSheetUploaded`), so the two
 * builders file the same action for the same act.
 */
const DESCRIPTORS: Record<
  DocumentAuditCategory,
  Partial<Record<DocumentAuditKind, DocumentAuditDescriptor>>
> = {
  agreement: {
    uploaded: {
      action: 'agreement_uploaded',
      fieldName: 'agreement',
      fieldLabel: 'Agreement Uploaded',
      eventType: 'add',
    },
    removed: {
      action: 'agreement_removed',
      fieldName: 'agreement',
      fieldLabel: 'Agreement Removed',
      eventType: 'delete',
    },
    // Web parity, and what `DynamicAgreementDialog` already files when the document
    // is actually rendered: the GENERATED path is plain 'Agreement'.
    generated: {
      action: 'agreement_generated',
      fieldName: 'agreement',
      fieldLabel: 'Agreement',
      eventType: 'add',
    },
  },
  orderSheet: {
    uploaded: {
      action: 'order_sheet_uploaded',
      fieldName: 'orderSheet',
      fieldLabel: 'Order Sheet Uploaded',
      eventType: 'add',
    },
    removed: {
      action: 'order_sheet_removed',
      fieldName: 'orderSheet',
      fieldLabel: 'Order Sheet Removed',
      eventType: 'delete',
    },
  },
};

export const documentAuditDescriptor = (
  category: DocumentAuditCategory | string | null | undefined,
  kind: DocumentAuditKind
): DocumentAuditDescriptor | null =>
  DESCRIPTORS[category as DocumentAuditCategory]?.[kind] ?? null;

/**
 * The rows whose identity is NOT in `knownIds`. One primitive, both directions:
 *
 * - REMOVALS — `pickUnknownDocuments(priorList, survivorIds)`. The scan sheet's
 *   Update hands back only the survivors, so what the rep crossed out has to be
 *   recovered by diffing against what the card held before it opened.
 * - ADDITIONS — `pickUnknownDocuments(serverRows, priorIds)`. The upload resolves
 *   to the category's WHOLE server list, so the rows just filed are the ones the
 *   card did not already know.
 *
 * ⚠️ `identityOf` is passed in rather than re-derived here. The caller already
 * reconciles these documents across the scanner round-trip with its own
 * `docIdentity` (serverId ?? _id ?? filePath ?? id ?? url ?? uri ?? name), and a
 * second, subtly different notion of "the same document" would report a removal
 * on a document that is still on the card.
 *
 * A row with no resolvable identity is treated as KNOWN — i.e. neither removed
 * nor added. That is the conservative direction on both sides: the scanner cannot
 * have deleted what it could not identify either, and inventing an event is worse
 * than missing one.
 */
export const pickUnknownDocuments = (
  rows: any[] | null | undefined,
  knownIds: Set<string>,
  identityOf: (doc: any) => string
): any[] => {
  if (!Array.isArray(rows)) return [];
  return rows.filter((doc) => {
    const id = identityOf(doc);
    return !!id && !knownIds.has(id);
  });
};

export interface DocumentAuditMeta {
  draft: true;
  leadId: string;
  fieldName: string;
  fieldLabel: string;
  documentCount: number;
  documentNames: string[];
  documents: DocumentRef[];
  action: string;
}

/**
 * The `meta` for one document event.
 *
 * `documents` carries `{ filePath, bucketName }` so the portal can open what the
 * row is about — the same reason the down-payment-receipt log carries them. It is
 * a LIST because one scan files several pages.
 *
 * ⚠️ `documents` and `refRows` are split for the UPLOAD case, and the split is the
 * point. `documents` must be the pages the rep added THIS session — the returned
 * upload resolves to the category's whole server list, so counting that would
 * report "3 uploaded" for one new page (the same trap the down-payment-receipt log
 * records). But those local pages have no `filePath` yet: it is generated
 * server-side. So the count and the names come from what the rep added, and the
 * S3 refs from the server rows that landed. A removal passes neither — its rows
 * are already server rows and carry both.
 *
 * `toDocumentRefs` drops a row with no `filePath` (an empty path reads as a
 * document that cannot be opened), which is why `documentNames` is kept beside it:
 * a page scanned in this session has a name long before it has a path.
 */
export const buildDocumentAuditMeta = (
  category: DocumentAuditCategory,
  kind: DocumentAuditKind,
  leadId: string,
  documents: any[],
  refRows?: any[]
): DocumentAuditMeta | null => {
  const descriptor = documentAuditDescriptor(category, kind);
  if (!descriptor) return null;
  const rows = Array.isArray(documents) ? documents : [];
  const refs = Array.isArray(refRows) ? refRows : rows;
  return {
    draft: true,
    leadId,
    fieldName: descriptor.fieldName,
    fieldLabel: descriptor.fieldLabel,
    documentCount: rows.length,
    documentNames: rows.map((d) => String(d?.name ?? '')).filter(Boolean),
    documents: toDocumentRefs(refs),
    action: descriptor.action,
  };
};

/** The `meta` for the CLICK that opens a document sheet — nothing is filed yet. */
export interface DocumentOpenMeta {
  draft: true;
  leadId: string;
  fieldName: string;
  fieldLabel: string;
  source: DocumentOpenSource;
  action: string;
}

/**
 * The row for OPENING a document sheet: Generate, Add Document, or the pencil that
 * replaces Add Document once the card holds something.
 *
 * ⚠️ It carries the SAME `meta.action` as the act it leads to, and is told apart by
 * `action_type: 'click'` — exactly how the scheduler's open row relates to the
 * `change` row its confirm files. So the portal reads "they opened the agreement
 * sheet" and "they filed an agreement" as one story rather than two vocabularies,
 * and `source` says which of the three controls started it.
 *
 * Deliberately carries NO `documentCount`/`documents`: at click time nothing has
 * been chosen, and a `documentCount: 0` beside an action named `..._uploaded` reads
 * as an upload that filed nothing.
 */
export const buildDocumentOpenMeta = (
  category: DocumentAuditCategory,
  kind: DocumentAuditKind,
  leadId: string,
  source: DocumentOpenSource
): DocumentOpenMeta | null => {
  const descriptor = documentAuditDescriptor(category, kind);
  if (!descriptor) return null;
  return {
    draft: true,
    leadId,
    fieldName: descriptor.fieldName,
    fieldLabel: descriptor.fieldLabel,
    source,
    action: descriptor.action,
  };
};
