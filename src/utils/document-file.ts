/**
 * Is a job-builder document a PDF?
 *
 * Pure and RN-free so it can be tested: its caller,
 * `widgets/modals/job-builder/DocumentScannerModal.tsx`, imports
 * `react-native-document-scanner-plugin`, which resolves a native TurboModule at
 * import time and cannot be loaded under jest at all.
 *
 * The answer decides whether a tile renders the `file-pdf-box` placeholder or an
 * `<Image>`, and `Image` cannot decode a PDF — a wrong `false` is a blank grey card.
 *
 * ⚠️ NOT the only copy of this rule. `screens/DynamicDealCenter/utils/document-payloads.ts`
 * has its own, on the SUBMIT path (it decides whether to run `convertJpegToPdf`), and
 * it still carries both of the bugs below. Left alone deliberately: that is the
 * contract-document upload path, and it should be changed with its own evidence.
 */

/**
 * Checked in order, and ALL of them are checked — see the warning in `isPdfFile`.
 * `filePath` is the S3 key on a server row; the url fields are what actually get
 * rendered.
 */
const PDF_NAME_KEYS = ['name', 'fileName', 'filePath', 'uri', 'url', 'secureUrl', 'displayUrl'];

export const isPdfFile = (f: any): boolean => {
  const type = f?.contentType || f?.mimeType || f?.fileData?.contentType || '';
  if (String(type).includes('pdf')) return true;

  // ⚠️ EVERY candidate is tested, not just the first truthy one. A Lead Center
  // document row carries a DISPLAY name — `"Down Payment Receipt"`, no extension at
  // all — so an `a || b || c` chain stops on the name and never reaches the url
  // that does end in `.pdf`.
  //
  // ⚠️ The extension is read from the PATH, with the query stripped first. These are
  // pre-signed S3 links, so the raw string ends in `…&X-Amz-Signature=…` and a plain
  // `.endsWith('.pdf')` is false on every single one.
  return PDF_NAME_KEYS.some((key) => {
    const value = f?.[key];
    return typeof value === 'string' && value.split(/[?#]/)[0].toLowerCase().endsWith('.pdf');
  });
};
