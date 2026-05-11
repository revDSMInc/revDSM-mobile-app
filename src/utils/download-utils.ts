import ReactNativeBlobUtil from 'react-native-blob-util';
import { Platform } from 'react-native';
import { FlashMessage } from '../config/message';

/**
 * Standard utility to download a PDF file to the device's Downloads folder
 * and optionally notify the system media scanner (Android) or open (iOS).
 */
export const downloadPdfToDevice = async (uri: string, title?: string) => {
  if (!uri) return;
  try {
    FlashMessage.info('Download started...', 'Downloading');
    const { dirs } = ReactNativeBlobUtil.fs;
    
    // Clean file name
    const urlHash = uri.split('?')[0].split('/').pop() || `doc_${Date.now()}`;
    const safeName = urlHash.endsWith('.pdf') ? urlHash : `${urlHash}.pdf`;
    const finalFileName = title ? `${title.replace(/\s+/g, '_')}.pdf` : safeName;
    
    const publicPath = `${dirs.DownloadDir}/${finalFileName}`;

    // 1. Handle Local vs Remote files
    if (uri.startsWith('file://') || uri.startsWith('/')) {
      const cleanSourcePath = uri.replace('file://', '');
      await ReactNativeBlobUtil.fs.cp(cleanSourcePath, publicPath);
      
      if (Platform.OS === 'android') {
        ReactNativeBlobUtil.fs.scanFile([{ path: publicPath, mime: 'application/pdf' }]);
      } else {
        ReactNativeBlobUtil.ios.openDocument(publicPath);
      }
    } else {
      // Remote URL - Use DownloadManager for Android
      if (Platform.OS === 'android') {
        await ReactNativeBlobUtil.config({
          addAndroidDownloads: {
            useDownloadManager: true,
            notification: true,
            path: publicPath,
            description: 'Downloading PDF document',
            mime: 'application/pdf',
          },
        }).fetch('GET', uri);
      } else {
        await ReactNativeBlobUtil.config({
          path: publicPath,
          fileCache: true,
        }).fetch('GET', uri);
        ReactNativeBlobUtil.ios.openDocument(publicPath);
      }
    }
    
    FlashMessage.success('Success', 'Document saved to Downloads');
    return publicPath;
  } catch (err) {
    console.error('[DownloadUtil] Public download error:', err);
    FlashMessage.error('Error', 'Failed to save document to device');
    throw err;
  }
};
