import base64 from 'base-64';
import { extractSingleJpegFromPdf, readMediaBox } from '../../src/utils/order-sheet-pdf';
import { convertJpegToPdf } from '../../src/utils/jpeg-to-pdf';

// A tiny but structurally valid-looking JPEG: SOI, a SOF0 frame header (8x6), padding, EOI.
const fakeJpeg = (): string => {
  const bytes = [
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x06, 0x00, 0x08, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03,
    0x11, 0x01, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x11, 0x22, 0x33, 0xff, 0xd9,
  ];
  return base64.encode(String.fromCharCode(...bytes));
};

describe('order-sheet-pdf', () => {
  it('lifts the JPEG back out of a PDF the app made, byte for byte', () => {
    const jpeg = fakeJpeg();
    const pdf = convertJpegToPdf(jpeg, 595, 842);
    const out = extractSingleJpegFromPdf(pdf);
    expect(out).not.toBeNull();
    expect(out!.jpegBase64).toBe(jpeg);
    // The page follows the image's aspect (8x6 fake JPEG), not a fixed A4.
    expect(out!.mediaBox).toEqual({ width: 595, height: 446.25 });
  });

  it('returns null for something that is not a one-image PDF', () => {
    expect(extractSingleJpegFromPdf(base64.encode('%PDF-1.4 no images here'))).toBeNull();
    expect(extractSingleJpegFromPdf('not base64 at all !!!')).toBeNull();
  });

  it('refuses a PDF holding two images (cannot be re-composed safely)', () => {
    const one = base64.decode(convertJpegToPdf(fakeJpeg(), 595, 842));
    expect(extractSingleJpegFromPdf(base64.encode(one + one))).toBeNull();
  });

  it('reads the page size', () => {
    expect(readMediaBox('<< /MediaBox [0 0 612 792] >>')).toEqual({ width: 612, height: 792 });
    expect(readMediaBox('nothing')).toBeNull();
  });
});
