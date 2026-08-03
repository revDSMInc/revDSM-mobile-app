import base64 from 'base-64';

/**
 * Wrap a JPEG's base64 into a minimal single-page PDF and return the PDF's base64
 * (no data: prefix). The backend's outcome endpoint requires agreement / order-sheet
 * documents as base64 PDF strings, so scanned/generated images must be converted
 * first. Extracted verbatim from the normal JB (SummarySection / JobBuilder /
 * JobDocsSection) so behavior is identical.
 *
 * @param jpegBase64 raw or data-URI JPEG base64
 * @returns base64 of a 1-page PDF (no data: prefix)
 */
export function convertJpegToPdf(jpegBase64: string, width = 595, height = 842): string {
  const cleanBase64 = jpegBase64.replace(/^data:image\/[a-z]+;base64,/, '');
  const binaryImg = base64.decode(cleanBase64);
  const imgLength = binaryImg.length;

  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources 4 0 R /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R >>\nendobj\n`;
  const obj4 = '4 0 obj\n<< /ProcSet [/PDF /ImageC] /XObject << /Im1 6 0 R >> >>\nendobj\n';
  const contentStream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ\n`;
  const obj5 = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`;
  const obj6Header = `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLength} >>\nstream\n`;
  const obj6Footer = '\nendstream\nendobj\n';

  const pdfHeader = '%PDF-1.3\n';
  const offset1 = pdfHeader.length;
  const offset2 = offset1 + obj1.length;
  const offset3 = offset2 + obj2.length;
  const offset4 = offset3 + obj3.length;
  const offset5 = offset4 + obj4.length;
  const offset6 = offset5 + obj5.length;

  const obj6FullLength = obj6Header.length + imgLength + obj6Footer.length;
  const offsetStartXref = offset6 + obj6FullLength;

  const padOffset = (offset: number) => String(offset).padStart(10, '0');

  const xref = `xref\n0 7\n0000000000 65535 f \n${padOffset(offset1)} 00000 n \n${padOffset(offset2)} 00000 n \n${padOffset(offset3)} 00000 n \n${padOffset(offset4)} 00000 n \n${padOffset(offset5)} 00000 n \n${padOffset(offset6)} 00000 n \n`;
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${offsetStartXref}\n%%EOF\n`;

  const pdfBinaryString =
    pdfHeader +
    obj1 +
    obj2 +
    obj3 +
    obj4 +
    obj5 +
    obj6Header +
    binaryImg +
    obj6Footer +
    xref +
    trailer;

  return base64.encode(pdfBinaryString);
}
