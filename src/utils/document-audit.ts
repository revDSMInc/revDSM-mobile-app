import { DocumentRef, toDocumentRefs } from './uploaded-document-refs';

export type DocumentAuditCategory = 'agreement' | 'orderSheet';
export type DocumentAuditKind = 'uploaded' | 'removed' | 'generated' | 'annotated' | 'reset';

export type DocumentOpenSource = 'generate' | 'add_document' | 'edit_documents';

export interface DocumentAuditDescriptor {
  action: string;
  fieldName: string;
  fieldLabel: string;
  eventType: string;
}

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
    // REVUIUX-569. ⚠️ BOTH are `add` - never `delete`: the portal's label map reads `delete` as `order_sheet_removed`, so a
    // reset logged as a delete would render as the sheet having been removed.
    annotated: {
      action: 'order_sheet_annotated',
      fieldName: 'orderSheet',
      fieldLabel: 'Order Sheet Annotated',
      eventType: 'add',
    },
    reset: {
      action: 'order_sheet_reset',
      fieldName: 'orderSheet',
      fieldLabel: 'Order Sheet Reset',
      eventType: 'add',
    },
  },
};

export const documentAuditDescriptor = (
  category: DocumentAuditCategory | string | null | undefined,
  kind: DocumentAuditKind
): DocumentAuditDescriptor | null =>
  DESCRIPTORS[category as DocumentAuditCategory]?.[kind] ?? null;

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

export interface DocumentOpenMeta {
  draft: true;
  leadId: string;
  fieldName: string;
  fieldLabel: string;
  source: DocumentOpenSource;
  action: string;
}

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
