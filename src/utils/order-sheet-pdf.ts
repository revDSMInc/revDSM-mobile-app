/**
 * Reading back the picture inside an order-sheet PDF (REVUIUX-569: annotate an already-uploaded order sheet).
 *
 * Order sheets filed from the phone are one page holding ONE JPEG (`utils/jpeg-to-pdf*.ts` embeds the scan as a
 * `/DCTDecode` image XObject), so the picture the rep needs to draw on can be lifted straight out of the PDF bytes -
 * no PDF rasteriser is involved. A PDF that is not that shape (a multi-page or text PDF from the web) returns `null`
 * and the caller says so, rather than flattening something it cannot reproduce.
 */
import base64 from 'base-64';
import { stripDataUriPrefix } from './jpeg-to-pdf';

export interface ExtractedOrderSheet {
  /** Raw base64 of the JPEG (no data: prefix). */
  jpegBase64: string;
  width: number | null;
  height: number | null;
  /** The page size the PDF was made with, so the annotated copy keeps it. */
  mediaBox: { width: number; height: number } | null;
}

const bytesToBase64 = (binary: string): string => base64.encode(binary);

export function readMediaBox(binary: string): { width: number; height: number } | null {
  const m = /\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/.exec(binary);
  if (!m) return null;
  const width = parseFloat(m[1]);
  const height = parseFloat(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The JPEG of a one-image PDF, or null when the PDF holds none, or more than one (not safely re-composable). */
export function extractSingleJpegFromPdf(pdfBase64: string): ExtractedOrderSheet | null {
  let binary: string;
  try {
    binary = base64.decode(stripDataUriPrefix(pdfBase64).replace(/[^A-Za-z0-9+/=]/g, ''));
  } catch {
    return null;
  }

  // Page count guard: a multi-page PDF is not a single scan.
  const pages = binary.match(/\/Type\s*\/Page(?![s\w])/g);
  if (pages && pages.length > 1) return null;

  // Every DCT image stream on the (single) page. A PDF the SERVER re-saved may carry more than one (e.g. a preview next to
  // the picture), so take the largest instead of refusing: refusing made a sheet annotated once impossible to open again.
  let best: { jpeg: string; marker: number } | null = null;
  let from = 0;
  for (;;) {
    const marker = binary.indexOf('/DCTDecode', from);
    if (marker < 0) break;
    from = marker + 1;
    const streamAt = binary.indexOf('stream', marker);
    if (streamAt < 0) continue;
    let start = streamAt + 'stream'.length;
    if (binary.charAt(start) === '\r') start += 1;
    if (binary.charAt(start) === '\n') start += 1;
    // A JPEG ends with FFD9; searching from the END of the stream body avoids stopping at a stray "endstream" inside it.
    const end = binary.indexOf('endstream', start);
    if (end < 0) continue;
    const body = binary.slice(start, end);
    const last = body.lastIndexOf('\xff\xd9');
    if (body.charCodeAt(0) !== 0xff || body.charCodeAt(1) !== 0xd8 || last < 0) continue;
    const jpeg = body.slice(0, last + 2);
    if (!best || jpeg.length > best.jpeg.length) best = { jpeg, marker };
  }
  if (!best) return null;
  const { jpeg, marker } = best;

  const dims = /\/Width\s+(\d+)[\s\S]{0,120}?\/Height\s+(\d+)|\/Height\s+(\d+)[\s\S]{0,120}?\/Width\s+(\d+)/.exec(
    binary.slice(Math.max(0, marker - 400), marker + 200),
  );
  let width: number | null = null;
  let height: number | null = null;
  if (dims) {
    width = parseInt(dims[1] || dims[4], 10) || null;
    height = parseInt(dims[2] || dims[3], 10) || null;
  }

  return { jpegBase64: bytesToBase64(jpeg), width, height, mediaBox: readMediaBox(binary) };
}
