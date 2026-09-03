import React, { useState, useEffect, useRef } from 'react';
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
import ReactNativeBlobUtil from 'react-native-blob-util';
import { LeadService } from '../../../services/api/leads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isPdfFile } from '../../../utils/document-file';
import {
  appendScannedPages,
  buildScanPageName,
  mergeFiledPages,
  remainingPageCapacity,
  removeScannerPage,
  seedScannerPages,
} from '../../../utils/document-scanner-pages';

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

  // WARNING Seeded when the sheet OPENS, and never again while it stays open.
  //
  // This used to run on `[visible, initialFiles]`, and `initialFiles` is a derived
  // array (`mergeDocSources(...)` in SummaryFinalizeCards) whose identity changes
  // whenever the parent re-renders - which the parent does on its own, e.g. when the
  // documents query settles after the app returns from the scanner Activity. Every
  // one of those re-renders reset the list to what was on the RECORD, wiping the
  // pages scanned in this session: capture a page, import a second from the gallery,
  // and the first one is gone. Nothing outside this sheet may replace its list while
  // the rep is working in it.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setFiles(seedScannerPages(initialFiles));
      setRemovedServerIds([]);
    }
    wasVisibleRef.current = visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The other half of seeding once: the filed documents come from a query, so they
  // can land AFTER the sheet opened. They are MERGED in - never substituted for the
  // list on screen - so a late read adds what it found without touching anything the
  // rep scanned or crossed out. Without this, saving would send a list missing those
  // documents and the card, which prunes by identity, would drop them from the record.
  useEffect(() => {
    if (!visible) return;
    setFiles((prev) => mergeFiledPages(prev, initialFiles, removedServerIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialFiles]);

  /** Did the copy actually land, and is the file non-empty? */
  const landed = async (dest: string): Promise<boolean> => {
    try {
      if (!(await RNFS.exists(dest))) return false;
      const stat = await RNFS.stat(dest);
      return Number(stat?.size) > 0;
    } catch {
      return false;
    }
  };

  /**
   * Copy a scanned page into the app's OWN cache and return a plain `file://` uri.
   *
   * WARNING On Android the ML Kit scanner hands back a `content://` uri owned by
   * Google Play services - both for a camera capture and for a gallery import -
   * and older Play services builds (which is what an Android 11 device tends to
   * carry) do this where newer ones return a file path. Two separate things break
   * when the page is left on that uri: everything downstream assumed `file://`
   * (`document-payloads.readFileBytes` dropped any other uri outright, so a scanned
   * order sheet never reached the Complete Job payload), AND the scanner reuses its
   * cache path, so the NEXT scan session overwrites or clears the file the earlier
   * page points at - which is what made a captured page vanish when a second was
   * imported from the gallery.
   *
   * Copying here, in the same tick the result arrives, makes every later reader
   * (upload, submit payload, the tile preview) see an ordinary app-private file
   * that behaves identically on every Android and iOS version - and one that no
   * other scan can touch, because `buildScanPageName` never repeats a name.
   *
   * Two strategies, each VERIFIED to have produced a real file, then the original
   * uri as a last resort so a page is never simply lost.
   */
  const localizeScannedPage = async (uri: string, fileName: string): Promise<string> => {
    const dest = `${RNFS.CachesDirectoryPath}/${fileName}`;
    // RNFS resolves a bare path as a file and a `content://` uri through the
    // ContentResolver; iOS needs the `file://` scheme stripped either way.
    const src = uri.startsWith('file://') ? uri.replace('file://', '') : uri;

    try {
      if (await RNFS.exists(dest)) await RNFS.unlink(dest).catch(() => {});
    } catch {
      // A stale destination that cannot be removed is not worth failing over; the
      // copy below either overwrites it or falls through to the second strategy.
    }

    // 1. Native stream copy - the cheap path, and the only one iOS needs.
    try {
      await RNFS.copyFile(src, dest);
      if (await landed(dest)) return `file://${dest}`;
    } catch (e) {
      console.warn('[DocumentScannerModal] copyFile failed for a scanned page', e);
    }

    // 2. Read the bytes and write them out. WARNING This exists because the copy
    //    above is NOT dependable for every uri the scanner can return: on Android
    //    a page can arrive as a `content://` uri owned by Play services, and
    //    whether RNFS can stream from one varies by device and OS version.
    //    `react-native-blob-util` resolves content uris through the ContentResolver
    //    explicitly, so it covers the cases the copy does not.
    try {
      const base64 = await ReactNativeBlobUtil.fs.readFile(uri, 'base64');
      if (base64) {
        await ReactNativeBlobUtil.fs.writeFile(dest, base64 as string, 'base64');
        if (await landed(dest)) return `file://${dest}`;
      }
    } catch (e) {
      console.warn('[DocumentScannerModal] could not localize a scanned page', e);
    }

    // WARNING Last resort. Keeping the scanner's own uri is what the lost-page bug
    // was made of: the scanner reuses its cache path, so the NEXT session can
    // overwrite or clear the file this uri points at and the earlier tile changes
    // or empties. Better a page that may go stale than no page at all - but if this
    // line is reached, that IS the bug, and the warnings above name which step failed.
    console.warn('[DocumentScannerModal] keeping the scanner uri - page may not survive another scan');
    return uri;
  };

  const startScan = async () => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: remainingPageCapacity(files.length),
        letUserAdjustCrop: true,
      } as any);

      if (result && result.scannedImages && result.scannedImages.length > 0) {
        setLoading(true);
        const newScans = await Promise.all(
          result.scannedImages.map(async (uri: string, index: number) => {
            const name = buildScanPageName(category, index);
            return { uri: await localizeScannedPage(uri, name), isNew: true, name };
          }),
        );
        setLoading(false);

        // WARNING Applied to the CURRENT list, not to `files`. The scanner Activity
        // can sit open for minutes with the app backgrounded, so `files` here is a
        // snapshot from before it opened - writing that back is how the page from the
        // previous session disappeared when the next one returned.
        let merged: any[] = [];
        setFiles((prev) => {
          merged = appendScannedPages(prev, newScans);
          return merged;
        });
        if (onChange) onChange(merged);
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
    if (!itemToRemove) return;
    if (itemToRemove.serverId) {
      setRemovedServerIds((prev) => [...prev, itemToRemove.serverId!]);
    }
    // Removed by the page ITSELF: an index is only valid against the list the rep
    // was looking at, and a scan landing in between would shift it onto another tile.
    let remaining: any[] = [];
    setFiles((prev) => {
      remaining = removeScannerPage(prev, itemToRemove, index);
      return remaining;
    });
    if (onChange) onChange(remaining);
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
