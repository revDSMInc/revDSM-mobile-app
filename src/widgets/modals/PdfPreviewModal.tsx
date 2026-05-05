import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  SafeAreaView,
  Platform,
} from 'react-native';
import Pdf from 'react-native-pdf';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useTheme } from '../../theme/ThemeProvider';
import { FlashMessage } from '../../config/message';

interface PdfPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  uri: string;
  title?: string;
}

export const PdfPreviewModal = ({ visible, onClose, uri, title }: PdfPreviewModalProps) => {
  const { colors, isDark } = useTheme();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !uri) {
      setLocalUri(null);
      setError(null);
      return;
    }

    // If already a local file path, use it directly
    if (uri.startsWith('file://') || uri.startsWith('/')) {
      const formatted = uri.startsWith('file://') ? uri : `file://${uri}`;
      setLocalUri(formatted);
      return;
    }

    // Remote URL — pre-download to DocumentDir to avoid ENOENT cache errors
    const downloadPdf = async () => {
      try {
        setDownloading(true);
        setError(null);

        const { dirs } = ReactNativeBlobUtil.fs;
        const dir = `${dirs.DocumentDir}/revdsm_pdfs`;

        const dirExists = await ReactNativeBlobUtil.fs.exists(dir);
        if (!dirExists) {
          await ReactNativeBlobUtil.fs.mkdir(dir);
        }

        const urlHash = uri.split('?')[0].split('/').pop() || `doc_${Date.now()}`;
        const safeName = urlHash.endsWith('.pdf') ? urlHash : `${urlHash}.pdf`;
        const filePath = `${dir}/${safeName}`;

        const fileExists = await ReactNativeBlobUtil.fs.exists(filePath);
        if (fileExists) {
          // Android requires file:/// (3 slashes) for absolute paths
          const formattedPath = Platform.OS === 'android' ? `file://${filePath}` : filePath;
          setLocalUri(formattedPath);
          setDownloading(false);
          return;
        }

        const res = await ReactNativeBlobUtil.config({
          path: filePath,
          fileCache: true,
          appendExt: 'pdf',
        }).fetch('GET', uri);

        const downloadedPath = res.path();
        const finalPath = Platform.OS === 'android' ? `file://${downloadedPath}` : downloadedPath;
        setLocalUri(finalPath);
      } catch (err: any) {
        console.error('[PdfPreviewModal] Download error:', err);
        setError('Failed to load document. Please try again.');
      } finally {
        setDownloading(false);
      }
    };

    downloadPdf();
  }, [uri, visible]);

  const handleDownloadToDevice = async () => {
    if (!uri) return;
    try {
      FlashMessage.info('Download started...', 'Downloading');
      const { dirs } = ReactNativeBlobUtil.fs;
      const fileName = uri.split('?')[0].split('/').pop() || `revdsm_${Date.now()}.pdf`;
      const publicPath = `${dirs.DownloadDir}/${fileName}`;

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
      FlashMessage.success('Success', 'Document saved to Downloads');
    } catch (err) {
      console.error('[PdfPreviewModal] Public download error:', err);
      FlashMessage.error('Error', 'Failed to save document to device');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? colors.surface : '#f8fafc' }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Icon name="close" size={24} color={isDark ? '#fff' : '#1e293b'} />
          </TouchableOpacity>
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { color: isDark ? '#fff' : '#1e293b' }]} numberOfLines={1}>
              {title || 'Document Preview'}
            </Text>
          </View>
          <TouchableOpacity onPress={handleDownloadToDevice} style={styles.downloadBtn}>
            <Icon name="download" size={24} color={isDark ? '#fff' : colors.primary.main} />
          </TouchableOpacity>
        </View>

        {/* PDF Viewer */}
        <View style={styles.container}>
          {downloading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator color={colors.primary.main} size="large" />
              <Text style={[styles.statusText, { color: isDark ? '#aaa' : '#64748b' }]}>
                Loading document...
              </Text>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Icon name="file-alert-outline" size={48} color={colors.error?.main || '#EF4444'} />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                onPress={() => {
                  setError(null);
                  setLocalUri(null);
                }}
                style={[styles.retryBtn, { backgroundColor: colors.primary.main }]}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : localUri ? (
            <Pdf
              source={{ uri: localUri, cache: false }}
              trustAllCerts={false}
              style={[styles.pdf, { backgroundColor: isDark ? colors.surface : '#f8fafc' }]}
              onLoadComplete={(numberOfPages) => {
                console.log(`[PdfPreviewModal] Loaded ${numberOfPages} pages`);
              }}
              onPageChanged={(page) => {
                console.log(`[PdfPreviewModal] Page: ${page}`);
              }}
              onError={(err) => {
                console.error('[PdfPreviewModal] PDF render error:', err);
                setError('Unable to render this document.');
              }}
              renderActivityIndicator={() => (
                <ActivityIndicator color={colors.primary.main} size="large" />
              )}
            />
          ) : (
            <View style={styles.centerContainer}>
              <Icon name="file-outline" size={48} color={isDark ? '#555' : '#cbd5e1'} />
              <Text style={[styles.statusText, { color: isDark ? '#aaa' : '#64748b' }]}>
                No document provided
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  downloadBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  container: {
    flex: 1,
  },
  pdf: {
    flex: 1,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
  statusText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
});
