import base64 from 'base-64';
import { convertJpegToPdf } from '../../src/utils/jpeg-to-pdf';
import { extractEmbeddedJpeg } from '../../src/utils/pdf-extract-jpeg';
import {
  annotatedPdfName,
  canAnnotateOrderSheet,
  isRouteMissing,
  multiPageMessage,
  shouldRasterize,
  showResetAction,
  serverErrorText,
  serverWarningText,
} from '../../src/utils/order-sheet-annotation';
import { documentAuditDescriptor } from '../../src/utils/document-audit';
import { resetToBaseline } from '../../src/utils/annotation-restore';

// SOI + SOF0 frame header (width 8, height 6) + scan + EOI: enough for readJpegSize and the extractor.
const jpegBase64 = (pad = 0): string => {
  const bytes = [
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x06, 0x00, 0x08, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03,
    0x11, 0x01, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, ...Array(pad).fill(0x11), 0xff, 0xd9,
  ];
  return base64.encode(String.fromCharCode(...bytes));
};

describe('pdf-extract-jpeg', () => {
  it('lifts the embedded JPEG back out of a PDF this app wrote - byte for byte', () => {
    const jpeg = jpegBase64(300);
    const out = extractEmbeddedJpeg(convertJpegToPdf(jpeg));
    expect(out).not.toBeNull();
    expect(out!.jpegBase64).toBe(jpeg);
    expect(out!.width).toBe(8);
    expect(out!.height).toBe(6);
  });

  it('returns null - and never throws - for a non-DCTDecode, multi-page or truncated PDF', () => {
    const good = convertJpegToPdf(jpegBase64(300));
    const raw = base64.decode(good);
    expect(extractEmbeddedJpeg(base64.encode('%PDF-1.4 text only'))).toBeNull();
    expect(extractEmbeddedJpeg(base64.encode(raw + raw))).toBeNull();
    expect(extractEmbeddedJpeg(base64.encode(raw.slice(0, Math.floor(raw.length / 2))))).toBeNull();
    expect(extractEmbeddedJpeg('')).toBeNull();
    expect(extractEmbeddedJpeg('!!not base64!!')).toBeNull();
  });
});

describe('jpeg-to-pdf determinism', () => {
  // Load-bearing: the backend correlates the office copy of an order sheet by hashing these bytes.
  it('gives identical base64 for the same input', () => {
    const jpeg = jpegBase64(500);
    expect(convertJpegToPdf(jpeg)).toBe(convertJpegToPdf(jpeg));
    expect(convertJpegToPdf(jpeg, 612, 792)).toBe(convertJpegToPdf(jpeg, 612, 792));
  });
});

describe('order-sheet-annotation rules', () => {
  it('shouldRasterize routes by content type with a file-name fallback', () => {
    expect(shouldRasterize('application/pdf', 'x.pdf')).toBe(true);
    expect(shouldRasterize('image/jpeg', 'x.pdf')).toBe(false);
    expect(shouldRasterize(undefined, 'scan.JPG')).toBe(false);
    expect(shouldRasterize('', 'sheet.pdf')).toBe(true);
    expect(shouldRasterize(undefined, undefined)).toBe(true);
  });

  it('annotatedPdfName never stacks suffixes across repeated annotations', () => {
    expect(annotatedPdfName('Order_Sheet.pdf')).toBe('Order_Sheet_annotated.pdf');
    expect(annotatedPdfName('Order_Sheet_annotated.pdf')).toBe('Order_Sheet_annotated.pdf');
    expect(annotatedPdfName('Order Sheet annotated annotated.pdf')).toBe('Order Sheet_annotated.pdf');
    expect(annotatedPdfName(undefined)).toBe('Order_Sheet_annotated.pdf');
  });

  it('only a server-held ORDER SHEET gets a pencil - never an agreement, never a queued offline row', () => {
    expect(canAnnotateOrderSheet({ documentType: 'orderSheet', serverId: 'a1' })).toBe(true);
    expect(canAnnotateOrderSheet({ documentType: 'agreement', serverId: 'a1' })).toBe(false);
    expect(canAnnotateOrderSheet({ documentType: 'orderSheet' })).toBe(false);
    expect(canAnnotateOrderSheet({ documentType: 'orderSheet', serverId: 'a1', pendingUpload: true })).toBe(false);
    expect(canAnnotateOrderSheet(null)).toBe(false);
  });

  it('Reset all changes appears only once the document has been annotated', () => {
    const base = { documentType: 'orderSheet', serverId: 'a1' };
    expect(showResetAction({ ...base, annotation: { revision: 0 } })).toBe(false);
    expect(showResetAction({ ...base, annotation: null })).toBe(false);
    expect(showResetAction({ ...base, annotation: { revision: 2 } })).toBe(true);
    expect(showResetAction({ documentType: 'agreement', serverId: 'a1', annotation: { revision: 2 } })).toBe(false);
  });

  it('shows a warning ONLY when the server sent text - the app writes none of its own', () => {
    const d = (annotation: any) => ({ documentType: 'orderSheet', serverId: 'a1', annotation });
    expect(serverWarningText(d({ revision: 1, twin: { state: 'unresolved' } }))).toBe('');
    expect(serverWarningText(d({ revision: 1, twin: { state: 'unresolved', message: ' Office copy differs ' } }))).toBe('Office copy differs');
    expect(serverWarningText(d({ warning: 'Heads up' }))).toBe('Heads up');
    expect(serverWarningText(d(null))).toBe('');
    expect(serverWarningText(null)).toBe('');
  });

  it("shows the server's own error text, falling back to the plain message", () => {
    expect(serverErrorText({ response: { data: { code: 400, message: 'Document was never annotated' } } })).toBe('Document was never annotated');
    expect(serverErrorText({ response: { data: { error: 'Bad file' } } })).toBe('Bad file');
    expect(serverErrorText({ response: { data: { errors: [{ message: 'file is required' }] } } })).toBe('file is required');
    expect(serverErrorText(new Error('Network Error'))).toBe('Network Error');
    expect(serverErrorText({}, 'fallback')).toBe('fallback');
  });

  it('isRouteMissing: a bare 404 means the backend is not deployed; a 404 with a JSON envelope is a real "not found"', () => {
    expect(isRouteMissing({ response: { status: 404, data: '<html>Cannot PATCH</html>' } })).toBe(true);
    expect(isRouteMissing({ response: { status: 404, data: {} } })).toBe(true);
    expect(isRouteMissing({ response: { status: 405 } })).toBe(true);
    expect(isRouteMissing({ response: { status: 404, data: { code: 404, message: 'Document not found' } } })).toBe(false);
    expect(isRouteMissing({ response: { status: 500, data: '' } })).toBe(false);
    expect(isRouteMissing(new Error('network'))).toBe(false);
  });

  it('names the page count when refusing a multi-page sheet', () => {
    expect(multiPageMessage(3)).toContain('3 pages');
  });
});

describe('document-audit order sheet descriptors', () => {
  it('annotated and reset are both `add` (never `delete`, which the portal reads as a removal)', () => {
    expect(documentAuditDescriptor('orderSheet', 'annotated')).toMatchObject({ action: 'order_sheet_annotated', eventType: 'add' });
    expect(documentAuditDescriptor('orderSheet', 'reset')).toMatchObject({ action: 'order_sheet_reset', eventType: 'add' });
    expect(documentAuditDescriptor('orderSheet', 'removed')).toMatchObject({ eventType: 'delete' });
    expect(documentAuditDescriptor('agreement', 'annotated')).toBeNull();
  });
});

describe('resetToBaseline', () => {
  const seeded = {
    strokes: { p1: [{ id: 1 }] },
    texts: { p1: [{ id: 't' }] },
    shapes: { p1: [{ id: 's' }, { id: 's2' }] },
  };
  it('returns what the screen opened with, not an empty canvas', () => {
    expect(resetToBaseline(seeded, 'p1')).toEqual({ strokes: [{ id: 1 }], texts: [{ id: 't' }], shapes: [{ id: 's' }, { id: 's2' }] });
  });
  it('is empty for a photo that opened with nothing, and never throws on missing seeds', () => {
    expect(resetToBaseline(seeded, 'other')).toEqual({ strokes: [], texts: [], shapes: [] });
    expect(resetToBaseline(null, 'p1')).toEqual({ strokes: [], texts: [], shapes: [] });
  });
  it('returns copies, so mutating the result cannot corrupt the baseline', () => {
    resetToBaseline(seeded, 'p1').strokes.push({ id: 99 } as any);
    expect(seeded.strokes.p1).toHaveLength(1);
  });
});
