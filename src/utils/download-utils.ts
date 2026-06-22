import ReactNativeBlobUtil from 'react-native-blob-util';
import { Platform, Share } from 'react-native';
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
    
    const baseDir = Platform.OS === 'ios' ? dirs.DocumentDir : dirs.DownloadDir;
    const publicPath = `${baseDir}/${finalFileName}`;

    // 1. Handle Local vs Remote files
    if (uri.startsWith('file://') || uri.startsWith('/')) {
      const cleanSourcePath = uri.replace('file://', '');
      
      if (Platform.OS === 'android') {
        await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          {
            name: finalFileName.replace('.pdf', ''),
            parentFolder: '',
            mimeType: 'application/pdf',
          },
          'Download',
          cleanSourcePath
        );
      } else {
        // Remove existing file to prevent cp error
        const exists = await ReactNativeBlobUtil.fs.exists(publicPath);
        if (exists) {
          await ReactNativeBlobUtil.fs.unlink(publicPath);
        }
        await ReactNativeBlobUtil.fs.cp(cleanSourcePath, publicPath);
        
        await Share.share({
          url: `file://${publicPath}`,
          title: title || 'Save PDF',
        });
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
        
        await Share.share({
          url: `file://${publicPath}`,
          title: title || 'Save PDF',
        });
      }
    }
    
    FlashMessage.success('Success', Platform.OS === 'ios' ? 'Document shared' : 'Document saved to Downloads');
    return publicPath;
  } catch (err) {
    console.error('[DownloadUtil] Public download error:', err);
    FlashMessage.error('Error', 'Failed to save document to device');
    throw err;
  }
};
