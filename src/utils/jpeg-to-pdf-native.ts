import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  base64ByteLength,
  buildPdfParts,
  convertJpegToPdf,
  readJpegSizeFromBase64,
  stripDataUriPrefix,
} from './jpeg-to-pdf';

/**
 * The same single-page PDF as `convertJpegToPdf`, assembled through the FILESYSTEM
 * instead of in JS memory.
 *
 * Why this exists: the pure-JS builder runs the whole document through the
 * `base-64` package twice — `decode` of the scan, then `encode` of the finished
 * PDF — each a character-by-character loop that materialises multi-megabyte JS
 * strings. On a low-RAM device (the Android 11 phones in the field are exactly
 * that) a large scan can exhaust the JS heap, and the only thing the rep sees is
 * "Upload failed": the throw is swallowed by the upload handler's catch. On a
 * current flagship the same scan converts fine, which is why this only ever
 * reproduced on older hardware.
 *
 * Writing the head, appending the JPEG's own base64 and appending the tail lets
 * the native layer do every decode, so the JS thread never holds the decoded
 * image at all.
 *
 * WARNING The output is byte-identical to `convertJpegToPdf`. Both take their
 * layout from `buildPdfParts`, and the xref offsets need the JPEG's BYTE length,
 * which `base64ByteLength` derives arithmetically rather than by decoding. Do not
 * inline either of those here — two definitions of the document is exactly the
 * drift this split is designed to prevent.
 *
 * WARNING Appending base64 in a separate call is safe: each `appendFile(...,
 * 'base64')` decodes its own chunk to bytes, so there is no cross-chunk padding
 * to align. The head and tail are pure ASCII and go in as utf8.
 *
 * Any failure falls back to the in-memory builder, so this can never do worse
 * than the path it replaces.
 */
export async function convertJpegToPdfAsync(
  jpegBase64: string,
  width = 595,
  height = 842
): Promise<string> {
  const cleanBase64 = stripDataUriPrefix(jpegBase64);
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/jpeg2pdf_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}.pdf`;

  try {
    // Only the HEAD of the base64 is decoded here, for the frame header — the
    // image itself still never reaches the JS thread.
    const { head, tail } = buildPdfParts(
      base64ByteLength(cleanBase64),
      width,
      height,
      readJpegSizeFromBase64(cleanBase64)
    );

    await ReactNativeBlobUtil.fs.writeFile(path, head, 'utf8');
    await ReactNativeBlobUtil.fs.appendFile(path, cleanBase64, 'base64');
    await ReactNativeBlobUtil.fs.appendFile(path, tail, 'utf8');

    const pdfBase64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
    if (typeof pdfBase64 !== 'string' || !pdfBase64) {
      throw new Error('empty PDF read back');
    }
    return pdfBase64;
  } catch (e) {
    console.warn('[jpeg-to-pdf] native assembly failed, falling back to in-memory:', e);
    return convertJpegToPdf(jpegBase64, width, height);
  } finally {
    ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
  }
}
