import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useWindowDimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentScanner from 'react-native-document-scanner-plugin';
import RNFS from 'react-native-fs';
import { LeadService } from '../../../services/api/leads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isPdfFile } from '../../../utils/document-file';

// A server document's source lives on `secureUrl`/`url`, NOT on `uri`, and a signed
// agreement is a PDF that `Image` cannot decode. Both are why the tile rendered as a
// blank grey card.
//
// ⚠️ `fileSrc` is deliberately NOT shared with `SummaryFinalizeCards`, whose copy
// prefers `secureUrl` over `uri`. Here `uri` must win: a locally-scanned page has
// only that, and `docIdentity` reads it, so re-resolving could change a document's
// identity across the scanner round-trip.
const fileSrc = (f: any) =>
  f?.uri || f?.secureUrl || f?.displayUrl || f?.url || f?.thumbnailUrl || f?.file;

interface DocumentScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (images: any[]) => void;
  onChange?: (images: any[]) => void;
  title: string;
  leadId: string;
  category: 'agreement' | 'orderSheet' | 'downPaymentReceipt';
  initialFiles?: any[];
  /**
   * Whether ALREADY-FILED documents (everything that arrived via `initialFiles`)
   * can be crossed out here. Pages scanned in this session are always removable,
   * so a misscan is never stuck. Defaults to `true` — existing callers keep the
   * old behaviour; the dynamic Job Builder passes `false` for agreements so the
   * signed/generated one can't be destroyed from the scan sheet.
   */
  allowRemoveExisting?: boolean;
}

export const DocumentScannerModal = ({
  visible,
  onClose,
  onSave,
  onChange,
  title,
  leadId,
  category,
  initialFiles = [],
  allowRemoveExisting = true,
}: DocumentScannerModalProps) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const statusBarBg = isDark ? colors.background : '#0E2A1C';
  const { width } = useWindowDimensions();
  const [files, setFiles] = useState<any[]>([]);
  const [removedServerIds, setRemovedServerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const columnWidth = (width - 48) / 2;

  useEffect(() => {
    if (visible) {
      // Carry the WHOLE file object through. The old projection kept only
      // `{ uri, serverId, isNew, name }`, which (a) dropped `url`/`secureUrl`/
      // `contentType` so the tile had nothing to render, and (b) dropped
      // `filePath`, so a document identified by filePath alone no longer matched
      // itself on the way back out and got pruned from the card on Update.
      const initial = (initialFiles || []).map((f) => ({
        ...f,
        serverId: f.serverId || f._id,
        isNew: false,
      }));
      setFiles(initial);
      setRemovedServerIds([]);
    }
  }, [visible, initialFiles]);

  /**
   * Copy a scanned page into the app's OWN cache and return a plain `file://` uri.
   *
   * WARNING On Android the ML Kit scanner hands back a `content://` uri owned by
   * Google Play services - both for a camera capture and for a gallery import -
   * and older Play services builds (which is what an Android 11 device tends to
   * carry) do this where newer ones return a file path. Everything downstream
   * assumed `file://`: `document-payloads.readFileBytes` DROPPED any other uri
   * outright, so a scanned order sheet silently never reached the Complete Job
   * payload. The grant on those uris is also tied to the scanner's activity
   * result, so reading them minutes later - which is when the upload happens - is
   * not something to rely on.
   *
   * Copying here, in the same tick the result arrives, makes every later reader
   * (upload, submit payload, the tile preview) see an ordinary app-private file
   * that behaves identically on every Android and iOS version.
   *
   * A failed copy falls back to the scanner's own uri, so this can never be worse
   * than the behaviour it replaces.
   */
  const localizeScannedPage = async (uri: string, fileName: string): Promise<string> => {
    try {
      const dest = `${RNFS.CachesDirectoryPath}/${fileName}`;
      // RNFS resolves a bare path as a file and a `content://` uri through the
      // ContentResolver; iOS needs the `file://` scheme stripped either way.
      const src = uri.startsWith('file://') ? uri.replace('file://', '') : uri;
      if (await RNFS.exists(dest)) await RNFS.unlink(dest).catch(() => {});
      await RNFS.copyFile(src, dest);
      return `file://${dest}`;
    } catch (e) {
      console.warn('[DocumentScannerModal] could not localize a scanned page', e);
      return uri;
    }
  };

  const startScan = async () => {
    try {
      const result = await DocumentScanner.scanDocument({
        // WARNING Never 0 or negative. ML Kit throws on a page limit below 1, and
        // `getStartScanIntent` then fails before the camera ever opens - so with
        // ten pages already on the document the scanner simply refused to start.
        maxNumDocuments: Math.max(1, 10 - files.length),
        letUserAdjustCrop: true,
      } as any);

      if (result && result.scannedImages && result.scannedImages.length > 0) {
        const timestamp = Date.now();
        setLoading(true);
        const newScans = await Promise.all(
          result.scannedImages.map(async (uri: string, index: number) => {
            const name = `scanned_${category}_${timestamp}_${index}.jpg`;
            return { uri: await localizeScannedPage(uri, name), isNew: true, name };
          }),
        );
        setLoading(false);
        const updatedFiles = [...files, ...newScans];
        setFiles(updatedFiles);
        if (onChange) onChange(updatedFiles);
      }
    } catch (error) {
      setLoading(false);
      console.error('Scanning error:', error);
      if (error instanceof Error && !error.message.includes('cancel')) {
        Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
      }
    }
  };

  const handleRemove = (index: number) => {
    const itemToRemove = files[index];
    if (itemToRemove.serverId) {
      setRemovedServerIds((prev) => [...prev, itemToRemove.serverId!]);
    }
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
    if (onChange) onChange(newFiles);
  };

  const handleSave = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (removedServerIds.length > 0) {
        await Promise.allSettled(removedServerIds.map(id => LeadService.deleteOutcomeDocument(id)));
      }
      onSave(files);
      onClose();
    } catch (error) {
      console.error('Error during document update:', error);
      Alert.alert('Error', 'Failed to update documents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const DeleteButton = ({ onPress }: { onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      style={styles.deleteButton}
    >
      <Icon name="close" size={14} color="white" />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor={statusBarBg} translucent />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {(Platform.OS === 'ios' || Platform.OS === 'android') && (
          <View style={{ height: insets.top, backgroundColor: statusBarBg }} />
        )}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} disabled={loading}>
            <Text style={{ color: colors.primary.main, fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <TouchableOpacity onPress={handleSave} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary.main} />
            ) : (
              <Text style={{ color: colors.primary.main, fontSize: 16, fontWeight: 'bold' }}>Update</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContainer}>
          <View style={styles.infoBox}>
            <Icon name="information" size={20} color="#0369a1" style={{ marginTop: 2 }} />
            <Text style={styles.infoText}>
              {allowRemoveExisting
                ? 'Scan documents via camera. You can remove existing or new pages and tap "Add More" to capture additional pages.'
                : 'Scan documents via camera. Tap "Add More" to capture additional pages. Documents already on file can\'t be removed here.'}
            </Text>
          </View>

          {files.length === 0 ? (
            <TouchableOpacity onPress={startScan} style={styles.emptyState}>
              <Icon name="file-document-outline" size={64} color="#94a3b8" />
              <Text style={styles.emptyStateTitle}>No documents captured</Text>
              <Text style={styles.emptyStateSubtitle}>Tap here to start scanning</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.grid}>
              {files.map((item, idx) => {
                const src = fileSrc(item);
                // A PDF (or a document with no resolvable source) gets the same
                // placeholder the summary card shows, instead of an Image that
                // decodes to nothing.
                const showPdfTile = isPdfFile(item) || !src;
                const canRemove = allowRemoveExisting || item.isNew !== false;
                return (
                  <View key={idx} style={[styles.thumbnailContainer, { width: columnWidth }]}>
                    <View style={styles.thumbnailWrapper}>
                      {showPdfTile ? (
                        <View style={styles.pdfTile}>
                          <Icon name="file-pdf-box" size={40} color="#EF4444" />
                          <Text style={styles.pdfTileName} numberOfLines={2}>
                            {item.name || 'PDF'}
                          </Text>
                        </View>
                      ) : (
                        <Image source={{ uri: src }} style={styles.thumbnail} resizeMode="cover" />
                      )}
                      {canRemove && <DeleteButton onPress={() => handleRemove(idx)} />}
                      <View style={styles.pageBadge}>
                        <Text style={styles.pageBadgeText}>{idx + 1}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}

              {files.length < 10 && (
                <View style={[styles.thumbnailContainer, { width: columnWidth }]}>
                  <TouchableOpacity style={[styles.addTile, { borderColor: colors.border }]} onPress={startScan}>
                    <Icon name="camera-plus-outline" size={32} color={colors.primary.main} />
                    <Text style={{ color: colors.primary.main, marginTop: 8, fontWeight: 'bold', fontSize: 12 }}>Add More</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {files.length > 0 && (
            <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginTop: 16, marginBottom: 40 }}>
              {files.length} of 10 documents captured
            </Text>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Text style={{ color: colors.text, opacity: 0.6, fontSize: 13 }}>
            Review and press Update to sync changes
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: 'bold' },
  content: { flex: 1 },
  scrollContainer: { padding: 16 },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#e0f2fe',
  },
  infoText: {
    marginLeft: 12,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#0369a1',
    fontWeight: '500',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 },
  thumbnailContainer: {
    padding: 8,
  },
  thumbnailWrapper: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
    overflow: 'hidden',
  },
  thumbnail: { width: '100%', height: '100%' },
  pdfTile: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  pdfTileName: {
    fontSize: 10,
    fontWeight: '900',
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
  },
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 100,
    backgroundColor: '#f43f5e',
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 4,
  },
  pageBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBadgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  addTile: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#e2e8f0',
    borderRadius: 20,
    backgroundColor: 'white',
    marginTop: 20,
  },
  emptyStateTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginTop: 16 },
  emptyStateSubtitle: { fontSize: 14, color: '#64748b', marginTop: 8 },
  footer: { padding: 20, alignItems: 'center', borderTopWidth: 1, paddingBottom: 40 },
});
