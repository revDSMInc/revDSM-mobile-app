import base64 from 'base-64';

export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export function stripDataUriPrefix(b64: string): string {
  return b64.replace(/^data:[^;]*;base64,/, '');
}

export function readJpegSize(binary: string): { width: number; height: number } | null {
  const byte = (i: number) => binary.charCodeAt(i) & 0xff;
  if (binary.length < 4 || byte(0) !== 0xff || byte(1) !== 0xd8) return null;

  let i = 2;
  while (i + 9 < binary.length) {
    if (byte(i) !== 0xff) {
      i += 1;
      continue;
    }
    const marker = byte(i + 1);
    if (marker === 0xff || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;

    const length = (byte(i + 2) << 8) + byte(i + 3);
    if (length < 2) return null;

    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      const height = (byte(i + 5) << 8) + byte(i + 6);
      const width = (byte(i + 7) << 8) + byte(i + 8);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    i += 2 + length;
  }
  return null;
}

export function readJpegSizeFromBase64(b64: string): { width: number; height: number } | null {
  const clean = stripDataUriPrefix(b64).replace(/[^A-Za-z0-9+/=]/g, '');
  const headChars = Math.min(clean.length, 65536) & ~3;
  if (!headChars) return null;
  try {
    return readJpegSize(base64.decode(clean.slice(0, headChars)));
  } catch {
    return null;
  }
}

export function buildPdfParts(
  imgLength: number,
  width = 595,
  height = 842,
  imageSize?: { width: number; height: number } | null
): { head: string; tail: string } {
  const imgW = imageSize?.width || width;
  const imgH = imageSize?.height || height;
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources 4 0 R /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R >>\nendobj\n`;
  const obj4 = '4 0 obj\n<< /ProcSet [/PDF /ImageC] /XObject << /Im1 6 0 R >> >>\nendobj\n';
  const contentStream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im1 Do\nQ\n`;
  const obj5 = `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`;
  const obj6Header = `6 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLength} >>\nstream\n`;
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

  return {
    head: pdfHeader + obj1 + obj2 + obj3 + obj4 + obj5 + obj6Header,
    tail: obj6Footer + xref + trailer,
  };
}

export function convertJpegToPdf(jpegBase64: string, width = 595, height = 842): string {
  const cleanBase64 = stripDataUriPrefix(jpegBase64);
  const binaryImg = base64.decode(cleanBase64);
  const { head, tail } = buildPdfParts(
    binaryImg.length,
    width,
    height,
    readJpegSize(binaryImg)
  );

  return base64.encode(head + binaryImg + tail);
}
