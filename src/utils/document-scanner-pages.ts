export interface ScannerPage {
  uri?: string;
  name?: string;
  isNew?: boolean;
  serverId?: string;
  _id?: string;
  [key: string]: any;
}

export function seedScannerPages(initialFiles?: ScannerPage[] | null): ScannerPage[] {
  return (initialFiles || []).map((f) => ({
    ...f,
    serverId: f?.serverId || f?._id,
    isNew: false,
  }));
}

export function appendScannedPages(
  existing: ScannerPage[] | null | undefined,
  incoming: ScannerPage[] | null | undefined
): ScannerPage[] {
  const current = Array.isArray(existing) ? existing : [];
  const additions = Array.isArray(incoming) ? incoming : [];
  if (!additions.length) return current;

  const seen = new Set(current.map((f) => f?.uri).filter(Boolean));
  const fresh = additions.filter((page) => {
    const uri = page?.uri;
    if (!uri || seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });

  return fresh.length ? [...current, ...fresh] : current;
}

export function removeScannerPage(
  files: ScannerPage[] | null | undefined,
  page: ScannerPage,
  fallbackIndex: number
): ScannerPage[] {
  const current = Array.isArray(files) ? files : [];
  let index = current.indexOf(page);
  if (index === -1 && page?.uri) {
    index = current.findIndex((f) => f?.uri === page.uri);
  }
  if (index === -1) {
    index = fallbackIndex >= 0 && fallbackIndex < current.length ? fallbackIndex : -1;
  }
  if (index === -1) return current;

  const next = [...current];
  next.splice(index, 1);
  return next;
}

let pageSequence = 0;
export function buildScanPageName(category: string, index: number, at = Date.now()): string {
  pageSequence += 1;
  return `scanned_${category}_${at}_${pageSequence}_${index}.jpg`;
}

export function __resetScanPageSequence(value = 0) {
  pageSequence = value;
}

export function remainingPageCapacity(currentCount: number, max = 10): number {
  return Math.max(1, max - (Number(currentCount) || 0));
}

function pageIdentity(page: ScannerPage): string {
  return String(
    page?.serverId ?? page?._id ?? page?.filePath ?? page?.uri ?? page?.name ?? ''
  );
}

export function mergeFiledPages(
  current: ScannerPage[] | null | undefined,
  initialFiles: ScannerPage[] | null | undefined,
  removedServerIds: string[] | null | undefined
): ScannerPage[] {
  const onScreen = Array.isArray(current) ? current : [];
  const filed = seedScannerPages(initialFiles);
  if (!filed.length) return onScreen;

  const removed = new Set((removedServerIds || []).map(String));
  const known = new Set(onScreen.map(pageIdentity).filter(Boolean));

  const additions = filed.filter((page) => {
    const id = pageIdentity(page);
    if (!id || known.has(id)) return false;
    if (page.serverId && removed.has(String(page.serverId))) return false;
    return true;
  });
  if (!additions.length) return onScreen;

  return [
    ...onScreen.filter((p) => !p?.isNew),
    ...additions,
    ...onScreen.filter((p) => p?.isNew),
  ];
}
