import ReactNativeBlobUtil from 'react-native-blob-util';
import { Platform, Share } from 'react-native';
import { FlashMessage } from '../config/message';

export const downloadPdfToDevice = async (uri: string, title?: string, showToast = true) => {
  if (!uri) return;
  try {
    if (showToast) {
      FlashMessage.info('Download started...', 'Downloading');
    }
    const { dirs } = ReactNativeBlobUtil.fs;
    
    const urlHash = uri.split('?')[0].split('/').pop() || `doc_${Date.now()}`;
    const safeName = urlHash.endsWith('.pdf') ? urlHash : `${urlHash}.pdf`;
    
    let cleanTitle = title ? title.trim().replace(/[^a-zA-Z0-9\s_-]/g, '') : '';
    cleanTitle = cleanTitle.replace(/\s+/g, ' ');
    const finalFileName = cleanTitle ? `${cleanTitle}.pdf` : safeName;
    
    const baseDir = Platform.OS === 'ios' ? dirs.DocumentDir : dirs.DownloadDir;
    const publicPath = `${baseDir}/${finalFileName}`;

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
    
    if (showToast) {
      FlashMessage.success('Success', Platform.OS === 'ios' ? 'Document shared' : 'Document saved to Downloads');
    }
    return publicPath;
  } catch (err) {
    console.error('[DownloadUtil] Public download error:', err);
    if (showToast) {
      FlashMessage.error('Error', 'Failed to save document to device');
    }
    throw err;
  }
};
