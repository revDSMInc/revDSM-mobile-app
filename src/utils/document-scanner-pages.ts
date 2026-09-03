/**
 * Page bookkeeping for `DocumentScannerModal`.
 *
 * Pure and RN-free on purpose (same reason `utils/document-file.ts` is): the modal
 * imports `react-native-document-scanner-plugin`, which resolves a native
 * TurboModule at IMPORT time, so the component cannot be loaded under jest at all.
 * The rules that decide whether a scanned page survives therefore live here, where
 * they can be tested - and losing a page is exactly the kind of thing that leaves
 * no trace when it goes wrong.
 */

/** A page as the modal holds it: either already filed, or scanned in this session. */
export interface ScannerPage {
  uri?: string;
  name?: string;
  isNew?: boolean;
  serverId?: string;
  _id?: string;
  [key: string]: any;
}

/**
 * The documents already on the record, shaped for the modal.
 *
 * WARNING The whole object is carried through. An earlier version projected each
 * entry down to `{ uri, serverId, isNew, name }`, which dropped `url`/`secureUrl`/
 * `contentType` (so a filed PDF had nothing to render) and dropped `filePath` (so a
 * document identified by filePath alone stopped matching itself on the way back out
 * and was pruned from the card on Update).
 */
export function seedScannerPages(initialFiles?: ScannerPage[] | null): ScannerPage[] {
  return (initialFiles || []).map((f) => ({
    ...f,
    serverId: f?.serverId || f?._id,
    isNew: false,
  }));
}

/**
 * Add this session's freshly scanned pages to the ones already on screen.
 *
 * WARNING Appending is the whole point, and it is not as obvious as it looks. The
 * caller reads its page list, hands control to the scanner Activity - which can sit
 * open for minutes while the app is backgrounded - and only then writes the list
 * back. Anything that touched the list in the meantime is lost unless the append is
 * applied to the CURRENT list rather than to the snapshot taken before the scanner
 * opened. Callers must therefore pass `prev` from a functional state update, not a
 * captured variable.
 *
 * A page whose uri is already present is dropped rather than added twice: a scanner
 * result that arrives twice (a re-entered handler, a resumed Activity) must not
 * duplicate the page.
 */
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

/**
 * Remove one page, identified by the page ITSELF rather than by its position.
 *
 * WARNING An index is only valid against the list the rep was looking at. By the
 * time the removal is applied the list may have grown (a scan landing), and an index
 * would then delete the wrong page. Matching the object identity first - and only
 * falling back to the index when the page is genuinely gone - keeps the ✕ pointed at
 * the tile the rep tapped.
 */
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

/**
 * A cache file name that is unique across scanner sessions.
 *
 * WARNING `Date.now()` alone is not enough. The scanner writes its pages to a fixed
 * path of its own and reuses it on the next session, so two scans that share a
 * destination name would have the second overwrite the first - the rep captures a
 * page, imports a second from the gallery, and the first tile changes or empties.
 * The counter guarantees separation even for two scans inside the same millisecond.
 */
let pageSequence = 0;
export function buildScanPageName(category: string, index: number, at = Date.now()): string {
  pageSequence += 1;
  return `scanned_${category}_${at}_${pageSequence}_${index}.jpg`;
}

/** Test seam — resets the module-level counter so names are predictable. */
export function __resetScanPageSequence(value = 0) {
  pageSequence = value;
}

/**
 * How many more pages the scanner may take.
 *
 * WARNING Never 0 or negative: ML Kit throws on a page limit below 1 and
 * `getStartScanIntent` then fails before the camera opens, so a document already
 * holding the maximum made the scanner refuse to start rather than say why.
 */
export function remainingPageCapacity(currentCount: number, max = 10): number {
  return Math.max(1, max - (Number(currentCount) || 0));
}

/** Stable handle for a page — matches the identity the summary card prunes by. */
function pageIdentity(page: ScannerPage): string {
  return String(
    page?.serverId ?? page?._id ?? page?.filePath ?? page?.uri ?? page?.name ?? ''
  );
}

/**
 * Fold documents that arrived AFTER the sheet opened into the list on screen.
 *
 * WARNING This is the other half of "seed on open only". The sheet is seeded once so
 * that a parent re-render cannot wipe the pages scanned in this session - but the
 * filed documents come from a query, and if that query settles while the sheet is
 * open those documents would otherwise never appear. Saving then sends a list
 * without them, and the card prunes by identity, so a filed order sheet would be
 * dropped from the record.
 *
 * So: MERGE, never replace. Pages already on screen are untouched (that is the
 * guarantee), and anything the rep crossed out in this session stays out.
 */
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

  // Filed documents stay ahead of this session's scans, the order the sheet opens in.
  return [
    ...onScreen.filter((p) => !p?.isNew),
    ...additions,
    ...onScreen.filter((p) => p?.isNew),
  ];
}
