/**
 * The rules behind annotating an order sheet in place (REVUIUX-569). Pure, so they are testable - the screens that use them
 * cannot load under jest.
 */

export type OrderSheetDocLike = {
  documentType?: string;
  serverId?: string | number | null;
  pendingUpload?: boolean;
  annotation?: {
    revision?: number;
    twin?: { state?: string } | null;
  } | null;
} | null | undefined;

/** True for a PDF that has to be turned into a raster before the annotator can open it; false for an image. */
export const shouldRasterize = (contentType?: string | null, name?: string | null): boolean => {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('pdf')) return true;
  if (type.startsWith('image/')) return false;
  // No usable content type (older rows): decide by the file name. Unknown is treated as a PDF, because the extractor then
  // simply refuses anything that is not one - an image mistaken for a PDF would fail loudly, never silently.
  const file = String(name || '').toLowerCase().split('?')[0];
  if (/\.(jpe?g|png|webp|heic)$/.test(file)) return false;
  return true;
};

/**
 * `Order_Sheet.pdf` -> `Order_Sheet_annotated.pdf`; annotating AGAIN must not stack `_annotated_annotated`.
 */
export const annotatedPdfName = (baseName?: string | null): string => {
  const stem = String(baseName || 'Order_Sheet')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/(?:[\s_-]*annotated)+$/i, '')
    .trim();
  return `${stem || 'Order_Sheet'}_annotated.pdf`;
};

/** Pencil: order sheets only (agreements must never get one - REVUIUX-325), and only a row the server already holds. */
export const canAnnotateOrderSheet = (doc: OrderSheetDocLike): boolean =>
  !!doc && doc.documentType === 'orderSheet' && !!doc.serverId && !doc.pendingUpload;

/** "Reset all changes" is offered only once the document has actually been annotated. */
export const showResetAction = (doc: OrderSheetDocLike): boolean =>
  canAnnotateOrderSheet(doc) && Number(doc?.annotation?.revision ?? 0) > 0;

const textOf = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/**
 * A warning the SERVER attached to an annotated order sheet (e.g. about the office copy), shown on the row EXACTLY as sent. The
 * app writes no warning text of its own: no server text, no warning. (`twin.state` alone is a status, not a message.)
 */
export const serverWarningText = (doc: OrderSheetDocLike | any): string => {
  const a = doc?.annotation;
  return textOf(a?.warning) || textOf(a?.twin?.message) || textOf(a?.twin?.warning) || textOf(a?.message);
};

/** The message the server put in an error response (`{ code, message }`), else the plain error message, else `fallback`. */
export const serverErrorText = (error: any, fallback = ''): string => {
  const d = error?.response?.data;
  const fromBody =
    textOf(d?.message) || textOf(d?.error) || textOf(d?.data?.message) || textOf(Array.isArray(d?.errors) ? d.errors[0]?.message ?? d.errors[0] : '');
  return fromBody || textOf(error?.message) || fallback;
};

export const multiPageMessage = (pages?: number | null): string =>
  pages && pages > 1
    ? `This order sheet has ${pages} pages. Annotating multi-page sheets is coming soon.`
    : 'Only scanned (single-image) order sheets can be annotated on the phone. This one is a multi-page or non-scanned document.';

/**
 * True when the BACKEND does not have the order-sheet annotation routes yet (the contract is unreleased): a 404 / 405 / 501
 * with no JSON envelope. A real "document not found" is a 404 WITH `{ code, message }`, and is NOT this.
 */
export const isRouteMissing = (error: any): boolean => {
  const status = error?.response?.status;
  if (status !== 404 && status !== 405 && status !== 501) return false;
  const data = error?.response?.data;
  return !(data && typeof data === 'object' && (data.code !== undefined || data.message !== undefined));
};
