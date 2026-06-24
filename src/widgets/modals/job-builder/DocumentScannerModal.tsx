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
import { LeadService } from '../../../services/api/leads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface DocumentScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (images: any[]) => void;
  onChange?: (images: any[]) => void;
  title: string;
  leadId: string;
  category: 'agreement' | 'orderSheet';
  initialFiles?: any[];
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
}: DocumentScannerModalProps) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const statusBarBg = isDark ? colors.background : '#101828';
  const { width } = useWindowDimensions();
  const [files, setFiles] = useState<any[]>([]);
  const [removedServerIds, setRemovedServerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const columnWidth = (width - 48) / 2;

  useEffect(() => {
    if (visible) {
      const initial = (initialFiles || []).map((f) => ({
        uri: f.uri,
        serverId: f.serverId || f._id,
        isNew: false,
        name: f.name,
      }));
      setFiles(initial);
      setRemovedServerIds([]);
    }
  }, [visible, initialFiles]);

  const startScan = async () => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: 10 - files.length,
        letUserAdjustCrop: true,
      } as any);

      if (result && result.scannedImages && result.scannedImages.length > 0) {
        const timestamp = Date.now();
        const newScans = result.scannedImages.map((uri: string, index: number) => ({
          uri,
          isNew: true,
          name: `scanned_${category}_${timestamp}_${index}.jpg`,
        }));
        const updatedFiles = [...files, ...newScans];
        setFiles(updatedFiles);
        if (onChange) onChange(updatedFiles);
      }
    } catch (error) {
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
              Scan documents via camera. You can remove existing or new pages and tap "Add More" to capture additional pages.
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
              {files.map((item, idx) => (
                <View key={idx} style={[styles.thumbnailContainer, { width: columnWidth }]}>
                  <View style={styles.thumbnailWrapper}>
                    <Image source={{ uri: item.uri }} style={styles.thumbnail} resizeMode="cover" />
                    <DeleteButton onPress={() => handleRemove(idx)} />
                    <View style={styles.pageBadge}>
                      <Text style={styles.pageBadgeText}>{idx + 1}</Text>
                    </View>
                  </View>
                </View>
              ))}

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
