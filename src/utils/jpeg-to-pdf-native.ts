import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  base64ByteLength,
  buildPdfParts,
  convertJpegToPdf,
  readJpegSizeFromBase64,
  stripDataUriPrefix,
} from './jpeg-to-pdf';

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
