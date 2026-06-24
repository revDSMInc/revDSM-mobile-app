import React, { useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  Alert,
  Share,
  Image,
  ScrollView,
  StatusBar,
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
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const statusBarBg = isDark ? colors.background : '#101828';
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isImage, setIsImage] = useState(false);

  const isImageUri = (uriPath: string) => {
    const cleanPath = uriPath.split('?')[0];
    return cleanPath.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/) !== null;
  };

  useEffect(() => {
    if (!visible || !uri) {
      setLocalUri(null);
      setError(null);
      setIsImage(false);
      return;
    }

    const isImg = isImageUri(uri);
    setIsImage(isImg);

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
        const ext = isImg ? (urlHash.split('.').pop() || 'jpg') : 'pdf';
        const safeName = urlHash.toLowerCase().endsWith(`.${ext}`) ? urlHash : `${urlHash}.${ext}`;
        const filePath = `${dir}/${safeName}`;

        const checkIsPDF = async (path: string): Promise<boolean> => {
          try {
            const headPath = `${path}_head`;
            await ReactNativeBlobUtil.fs.slice(path, headPath, 0, 100);
            const headBase64 = await ReactNativeBlobUtil.fs.readFile(headPath, 'base64');
            await ReactNativeBlobUtil.fs.unlink(headPath);
            const stat = await ReactNativeBlobUtil.fs.stat(path);
            console.log(`[PdfPreviewModal] checkIsPDF: size=${stat.size}, isPDF=${headBase64.startsWith('JVBERi')}, path=${path}`);
            return headBase64.startsWith('JVBERi') && stat.size > 8192;
          } catch (err) {
            console.error('[PdfPreviewModal] Failed to read PDF header:', err);
            return false;
          }
        };

        const fileExists = await ReactNativeBlobUtil.fs.exists(filePath);
        if (fileExists) {
          let isValid = true;
          if (!isImg) {
            isValid = await checkIsPDF(filePath);
          }
          if (isValid) {
            // Android requires file:/// (3 slashes) for absolute paths
            const formattedPath = Platform.OS === 'android' ? `file://${filePath}` : filePath;
            console.log('[PdfPreviewModal] Cache hit, file valid:', formattedPath);
            setLocalUri(formattedPath);
            setDownloading(false);
            return;
          } else {
            console.log('[PdfPreviewModal] Found invalid/corrupted existing file, unlinking:', filePath);
            try {
              await ReactNativeBlobUtil.fs.unlink(filePath);
            } catch (e) {
              console.warn('[PdfPreviewModal] Failed to unlink invalid file:', e);
            }
          }
        }

        console.log('[PdfPreviewModal] Downloading file from:', uri);
        const res = await ReactNativeBlobUtil.config({
          path: filePath,
          fileCache: true,
          appendExt: ext,
        }).fetch('GET', uri, {
          'Accept-Encoding': 'identity',
        });

        const downloadedPath = res.path();

        if (!isImg) {
          const isPDF = await checkIsPDF(downloadedPath);
          if (!isPDF) {
            console.error('[PdfPreviewModal] Validation failed. Not a PDF.');
            await ReactNativeBlobUtil.fs.unlink(downloadedPath);
            setError('The document appears to be corrupted or invalid.');
            setDownloading(false);
            return;
          }
        }

        const finalPath = Platform.OS === 'android' ? `file://${downloadedPath}` : downloadedPath;
        console.log('[PdfPreviewModal] File loaded successfully:', finalPath);
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
    const sourceUri = (Platform.OS === 'android' && uri.startsWith('http')) ? uri : (localUri || uri);
    if (!sourceUri || saving) return;
    try {
      setSaving(true);
      FlashMessage.info('Download started...', 'Downloading');
      const { dirs } = ReactNativeBlobUtil.fs;
      const ext = isImage ? (uri.split('?')[0].split('.').pop() || 'jpg') : 'pdf';
      let cleanTitle = title ? title.trim().replace(/[^a-zA-Z0-9\s_-]/g, '') : '';
      cleanTitle = cleanTitle.replace(/\s+/g, ' ');
      const fileName = cleanTitle 
        ? `${cleanTitle}.${ext}` 
        : (uri.split('?')[0].split('/').pop() || `revdsm_${Date.now()}.${ext}`);
      const baseDir = Platform.OS === 'ios' ? dirs.DocumentDir : dirs.DownloadDir;
      const publicPath = `${baseDir}/${fileName}`;
      const mimeType = isImage ? `image/${ext === 'png' ? 'png' : 'jpeg'}` : 'application/pdf';

      // 1. Handle Local vs Remote files
      if (sourceUri.startsWith('file://') || sourceUri.startsWith('/')) {
        const cleanSourcePath = sourceUri.replace('file://', '');

        // Remove existing file to prevent cp error
        const exists = await ReactNativeBlobUtil.fs.exists(publicPath);
        if (exists) {
          await ReactNativeBlobUtil.fs.unlink(publicPath);
        }

        await ReactNativeBlobUtil.fs.cp(cleanSourcePath, publicPath);

        if (Platform.OS === 'android') {
          // Add to DownloadManager and scan so it appears in 'Downloads' app
          ReactNativeBlobUtil.fs.scanFile([{ path: publicPath, mime: mimeType }]);
          FlashMessage.success('Document downloaded successfully!', 'Downloaded');
        } else {
          await Share.share({
            url: `file://${publicPath}`,
            title: title || (isImage ? 'Save Image' : 'Save PDF'),
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
              description: isImage ? 'Downloading image document' : 'Downloading PDF document',
              mime: mimeType,
            },
          }).fetch('GET', sourceUri);
          FlashMessage.success('Document downloaded successfully!', 'Downloaded');
        } else {
          await ReactNativeBlobUtil.config({
            path: publicPath,
            fileCache: true,
          }).fetch('GET', sourceUri);

          await Share.share({
            url: `file://${publicPath}`,
            title: title || (isImage ? 'Save Image' : 'Save PDF'),
          });
        }
      }
    } catch (err) {
      console.error('[PdfPreviewModal] Public download error:', err);
      Alert.alert('Error', 'Failed to save document to device.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor={statusBarBg} translucent />
      <View style={{ flex: 1, backgroundColor: isDark ? colors.surface : '#f8fafc', paddingBottom: insets.bottom }}>
        {(Platform.OS === 'ios' || Platform.OS === 'android') && (
          <View style={{ height: insets.top, backgroundColor: statusBarBg }} />
        )}
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
          <TouchableOpacity
            onPress={handleDownloadToDevice}
            style={styles.downloadBtn}
            disabled={saving || downloading}
          >
            {saving ? (
              <ActivityIndicator size="small" color={isDark ? '#fff' : colors.primary.main} />
            ) : (
              <Icon name="download" size={24} color={isDark ? '#fff' : colors.primary.main} />
            )}
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
            isImage ? (
              <ScrollView
                maximumZoomScale={3}
                minimumZoomScale={1}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.imageContainer}
              >
                <Image
                  source={{ uri: localUri }}
                  style={styles.image}
                  resizeMode="contain"
                />
              </ScrollView>
            ) : (
              <Pdf
                key={localUri}
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
            )
          ) : (
            <View style={styles.centerContainer}>
              <Icon name="file-outline" size={48} color={isDark ? '#555' : '#cbd5e1'} />
              <Text style={[styles.statusText, { color: isDark ? '#aaa' : '#64748b' }]}>
                No document provided
              </Text>
            </View>
          )}
        </View>
      </View>
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
  imageContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height - 120, // offset header
  },
});
