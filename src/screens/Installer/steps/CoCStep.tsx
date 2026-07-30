import React from 'react';
import { View, Text, Image, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentScanner from 'react-native-document-scanner-plugin';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { ConfirmActionModal } from '../../../widgets/modals/installer/ConfirmActionModal';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import { usePhotoDeleteConfirm } from '../../../hooks/usePhotoDeleteConfirm';
import type { CapturedPhoto } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  pages: CapturedPhoto[];
  onAddPage: (page: CapturedPhoto) => void;
  /**
   * Resolves once the page is gone from the server as well as from state — the confirm
   * dialog holds its spinner on this promise.
   */
  onRemovePage: (pageId: string) => void | Promise<void>;
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
  const { t } = useTranslation();
  const log = useInstallerActivityLog();

  const startScan = async () => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: Math.max(1, 10 - pages.length),
        letUserAdjustCrop: true,
      } as any);

      if (result?.scannedImages?.length) {
        result.scannedImages.forEach((uri: string, i: number) => {
          const page = {
            id: `${Date.now()}-${i}`,
            uri,
            // Stamped per page, not per scan: `timestampTaken` is what orders the
            // pages once they come back from the server, so two pages from the same
            // pass must not share a timestamp.
            takenAt: new Date(Date.now() + i).toISOString(),
          };
          // The parent adds it to state and uploads it; the upload hook logs the page
          // once S3 has answered with the s3url and byte size the portal needs.
          onAddPage(page);
        });
      }
    } catch (error) {
      if (error instanceof Error && !error.message.includes('cancel')) {
        Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
      }
    }
  };

  const hasPages = pages.length > 0;

  const del = usePhotoDeleteConfirm<{ page: CapturedPhoto; index: number }>(
    async ({ page, index }) => {
      await onRemovePage(page.id);
      log.photoRemoved({
        step: 'coc',
        category: 'Certificate of Completion',
        subcategory: `Page ${index + 1}`,
        timestamp: page.takenAt,
      });
    }
  );

  const handleDone = () => {
    log.cocCompleted(pages.length);
    onBack();
  };

  return (
    <InstallerSubScreen
      visible={visible}
      title={t('installer.cocTitle')}
      subtitle={t('installer.cocSub')}
      onBack={onBack}
      footer={
        hasPages ? (
          <TouchableOpacity
            onPress={handleDone}
            className="h-12 rounded-xl items-center justify-center"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-base font-bold text-center">
              {pages.length === 1
                ? t('installer.cocDoneOne', { count: pages.length })
                : t('installer.cocDoneMany', { count: pages.length })}
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
            {pages.length === 1
              ? t('installer.cocCapturedOne', { count: pages.length })
              : t('installer.cocCapturedMany', { count: pages.length })}
          </Text>
        </View>
      ) : (
        <Text className="text-xs font-semibold mb-3" style={{ color: colors.textSecondary }}>
          {t('installer.cocIntro')}
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
                <Text className="text-white text-[10px] font-bold">
                  {t('installer.cocPage', { number: i + 1 })}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => del.request({ page, index: i })}
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
        <Text className="text-white ml-2 text-base font-bold text-center">
          {hasPages ? t('installer.cocScanAnother') : t('installer.cocScanFirst')}
        </Text>
      </TouchableOpacity>

      <ConfirmActionModal
        visible={del.visible}
        icon="file-remove-outline"
        tone="danger"
        title={t('installer.cocDeleteTitle')}
        description={t('installer.cocDeleteBody', {
          number: (del.target?.index ?? 0) + 1,
        })}
        confirmLabel={t('installer.delete')}
        cancelLabel={t('installer.keep')}
        submitting={del.deleting}
        onCancel={del.cancel}
        onConfirm={del.confirm}
      />
    </InstallerSubScreen>
  );
}
