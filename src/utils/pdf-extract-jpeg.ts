/**
 * The inverse of `jpeg-to-pdf.ts` (REVUIUX-569): every order-sheet PDF this app produces is a one-page document with the
 * original JPEG embedded VERBATIM in a single `/DCTDecode` image XObject, so the picture to annotate can be lifted straight
 * out of the bytes - no PDF rasteriser, no dependency, works offline, byte-exact, and testable under jest.
 *
 * Anything that is not that shape (multi-page, text, portal-built, gallery-picked) returns `null` and never throws, so the
 * caller can refuse it with a clear message instead of annotating page 1 and silently dropping the rest.
 */
import base64 from 'base-64';
import { readJpegSizeFromBase64, stripDataUriPrefix } from './jpeg-to-pdf';
import { extractSingleJpegFromPdf } from './order-sheet-pdf';

export interface EmbeddedJpeg {
  jpegBase64: string;
  width: number;
  height: number;
  /** The page size the PDF was made with, so the annotated copy keeps it. */
  mediaBox: { width: number; height: number } | null;
}

export function extractEmbeddedJpeg(pdfBase64: string): EmbeddedJpeg | null {
  try {
    const out = extractSingleJpegFromPdf(pdfBase64);
    if (!out) return null;
    const size = readJpegSizeFromBase64(out.jpegBase64);
    const width = size?.width || out.width || 0;
    const height = size?.height || out.height || 0;
    if (!width || !height) return null;
    return { jpegBase64: out.jpegBase64, width, height, mediaBox: out.mediaBox };
  } catch {
    return null;
  }
}

/** Pages in a PDF (counts `/Type /Page`, not `/Type /Pages`), or null when it cannot be read - for the "N pages" refusal. */
export function countPdfPages(pdfBase64: string): number | null {
  try {
    const binary = base64.decode(stripDataUriPrefix(pdfBase64).replace(/[^A-Za-z0-9+/=]/g, ''));
    const pages = binary.match(/\/Type\s*\/Page(?![s\w])/g);
    return pages ? pages.length : null;
  } catch {
    return null;
  }
}
