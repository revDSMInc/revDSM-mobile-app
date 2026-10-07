export interface DocumentRef {
  filePath: string;
  bucketName: string;
}

const DOCUMENT_BAGS = ['jobBuilderDocuments', 'leadOutcomeDocuments', 'documents'];

const rootsOf = (source: any): any[] => [
  source,
  source?.data,
  source?.data?.data,
  source?.lead,
  source?.data?.lead,
  source?.data?.data?.lead,
  source?.outcome,
  source?.data?.outcome,
  source?.data?.data?.outcome,
];

export const readDocumentGroup = (source: any, group: string): any[] => {
  if (!source || typeof source !== 'object') return [];
  for (const root of rootsOf(source)) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
    if (Array.isArray(root[group])) return root[group];
    for (const bagKey of DOCUMENT_BAGS) {
      const bag = root[bagKey];
      if (bag && typeof bag === 'object' && Array.isArray(bag[group])) return bag[group];
    }
  }
  return [];
};

export const documentRowId = (row: any): string => String(row?._id ?? row?.id ?? '');

export const collectDocumentIds = (rows: any[]): Set<string> => {
  const ids = new Set<string>();
  (rows || []).forEach((row) => {
    const id = documentRowId(row);
    if (id) ids.add(id);
  });
  return ids;
};

export const pickNewDocuments = (knownIds: Set<string>, rows: any[]): any[] =>
  (rows || []).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const id = documentRowId(row);
    return !id || !knownIds.has(id);
  });

export const toDocumentRefs = (rows: any[]): DocumentRef[] =>
  (rows || [])
    .filter((row) => row && typeof row === 'object' && row.filePath)
    .map((row) => ({
      filePath: String(row.filePath),
      bucketName: String(row.bucketName || ''),
    }));
