import React from 'react';
import { View, Text, Image, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentScanner from 'react-native-document-scanner-plugin';
import { useTheme } from '../../../theme/ThemeProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import type { CapturedPhoto } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  pages: CapturedPhoto[];
  onAddPage: (page: CapturedPhoto) => void;
  onRemovePage: (pageId: string) => void;
  onBack: () => void;
}

/**
 * Certificate of Completion scan.
 *
 * Uses the same document-scanner plugin as the job-builder flow so edge detection
 * and crop adjustment behave identically to the rest of the app.
 */
export function CoCStep({ visible, pages, onAddPage, onRemovePage, onBack }: Props) {
  const { colors } = useTheme();
  const log = useInstallerActivityLog();

  const startScan = async () => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: Math.max(1, 10 - pages.length),
        letUserAdjustCrop: true,
      } as any);

      if (result?.scannedImages?.length) {
        result.scannedImages.forEach((uri: string, i: number) => {
          onAddPage({
            id: `${Date.now()}-${i}`,
            uri,
            takenAt: new Date().toISOString(),
          });
        });
        log.cocPagesScanned(
          result.scannedImages.length,
          pages.length + result.scannedImages.length
        );
      }
    } catch (error) {
      if (error instanceof Error && !error.message.includes('cancel')) {
        Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
      }
    }
  };

  const hasPages = pages.length > 0;

  const handleRemovePage = (pageId: string) => {
    onRemovePage(pageId);
    log.cocPageRemoved(Math.max(0, pages.length - 1));
  };

  const handleDone = () => {
    log.cocCompleted(pages.length);
    onBack();
  };

  return (
    <InstallerSubScreen
      visible={visible}
      title="Certificate of Completion"
      subtitle="Scan the CoC signed by the homeowner"
      onBack={onBack}
      footer={
        hasPages ? (
          <TouchableOpacity
            onPress={handleDone}
            className="h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-base font-bold">
              Done — {pages.length} Page{pages.length > 1 ? 's' : ''} Scanned
            </Text>
          </TouchableOpacity>
        ) : undefined
      }
    >
      {hasPages ? (
        <View
          className="flex-row items-center rounded-2xl p-3 mb-3 border-2"
          style={{ backgroundColor: colors.primary.main + '10', borderColor: colors.primary.main }}
        >
          <View
            className="w-6 h-6 rounded-full items-center justify-center mr-2.5"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Icon name="check" size={14} color="#fff" />
          </View>
          <Text className="flex-1 text-xs font-bold" style={{ color: colors.primary.main }}>
            {pages.length} page{pages.length > 1 ? 's' : ''} captured
          </Text>
        </View>
      ) : (
        <Text className="text-xs font-semibold mb-3" style={{ color: colors.textSecondary }}>
          Capture every signed page. Fit the document inside the frame — edges are detected
          automatically.
        </Text>
      )}

      {hasPages && (
        <View className="flex-row flex-wrap mb-3" style={{ gap: 10 }}>
          {pages.map((page, i) => (
            <View
              key={page.id}
              className="rounded-xl overflow-hidden border"
              style={{
                width: '31%',
                aspectRatio: 0.77,
                borderColor: colors.border,
                backgroundColor: '#e8e6df',
              }}
            >
              <Image source={{ uri: page.uri }} style={{ flex: 1 }} resizeMode="cover" />
              <View
                className="absolute bottom-0 left-0 right-0 py-0.5 items-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
              >
                <Text className="text-white text-[10px] font-bold">Page {i + 1}</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleRemovePage(page.id)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full items-center justify-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
              >
                <Icon name="close" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        onPress={startScan}
        className="h-12 rounded-xl items-center justify-center flex-row"
        style={{ backgroundColor: colors.primary.main }}
      >
        <Icon name="file-document-outline" size={18} color="#fff" />
        <Text className="text-white ml-2 text-base font-bold">
          {hasPages ? 'Scan Another Page' : 'Scan Signed CoC'}
        </Text>
      </TouchableOpacity>
    </InstallerSubScreen>
  );
}
