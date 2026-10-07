import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import {
  DiscrepancyModal,
  type JobPhotoRef,
} from '../../../widgets/modals/installer/DiscrepancyModal';
import { productColor } from '../../../constants/installer';
import { ProductScopeCard } from '../../../widgets/components/installer/ProductScopeCard';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import { FlashMessage } from '../../../config/message';
import type { ScopeStatus, SoldProduct } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  products: SoldProduct[];
  scope: Record<string, ScopeStatus>;
  jobPhotos: JobPhotoRef[];
  onSetStatus: (productId: string, status: ScopeStatus | null) => void;
  onReportDiscrepancy: (productId: string, issue: string, note: string, attachments: string[]) => void;
  onComplete: () => void;
  onBack: () => void;
}

export function VerifyScopeStep({
  visible,
  products,
  scope,
  jobPhotos,
  onSetStatus,
  onReportDiscrepancy,
  onComplete,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const log = useInstallerActivityLog();
  const [sheetFor, setSheetFor] = useState<SoldProduct | null>(null);

  const pending = products.filter((p) => scope[p.id]?.state === 'pending').length;
  const resolved = products.filter((p) => scope[p.id]?.state === 'resolved').length;
  const confirmed = products.filter((p) => scope[p.id]?.state === 'confirmed').length;

  const nothingToVerify = products.length === 0;

  const allSettled =
    nothingToVerify ||
    products.every((p) => scope[p.id] && scope[p.id].state !== 'pending');

  const handleConfirmProduct = (product: SoldProduct) => {
    log.scopeConfirmed(product);
    onSetStatus(product.id, { state: 'confirmed' });
  };

  const handleUndoProduct = (product: SoldProduct) => {
    log.scopeUndone(product);
    onSetStatus(product.id, null);
  };

  const handleOpenDiscrepancy = (product: SoldProduct) => {
    log.discrepancyOpened(product);
    setSheetFor(product);
  };

  const handleResolveProduct = (product: SoldProduct, status: ScopeStatus) => {
    log.scopeResolved(product, status.issue);
    onSetStatus(product.id, { ...status, state: 'resolved' });
  };

  const handleComplete = () => {
    if (!allSettled) return;
    log.scopeCompleted({ productCount: products.length, confirmed, resolved });
    onComplete();
    onBack();
  };

  const showDiscrepancySheet = !!sheetFor;

  return (
    <InstallerSubScreen
      visible={visible}
      title={t('installer.scopeTitle')}
      subtitle={t('installer.scopeSub')}
      onBack={onBack}
      footer={
        showDiscrepancySheet ? undefined : (
        <>
          {pending > 0 && (
            <View
              className="flex-row items-center rounded-xl p-2.5 mb-2 border"
              style={{
                backgroundColor: colors.warning.main + '14',
                borderColor: colors.warning.main,
              }}
            >
              <Icon name="clock-outline" size={14} color={colors.warning.dark} />
              <Text
                className="flex-1 ml-2 text-sm font-bold"
                style={{ color: colors.warning.dark }}
              >
                {pending === 1
                  ? t('installer.scopePendingOne', { count: pending })
                  : t('installer.scopePendingMany', { count: pending })}
              </Text>
            </View>
          )}
          <TouchableOpacity
            disabled={!allSettled}
            onPress={handleComplete}
            className="h-12 rounded-xl items-center justify-center"
            style={{
              backgroundColor: allSettled ? colors.primary.main : colors.textSecondary + '40',
            }}
          >
            <Text
              className="text-base font-bold text-center"
              style={{ color: allSettled ? '#fff' : colors.textSecondary }}
            >
              {nothingToVerify
                ? t('installer.scopeAcknowledge')
                : t('installer.scopeDone')}
            </Text>
          </TouchableOpacity>
        </>
        )
      }
    >
      {nothingToVerify && (
        <View
          className="rounded-2xl p-4 border"
          style={{
            backgroundColor: colors.warning.main + '14',
            borderColor: colors.warning.main,
          }}
        >
          <View className="flex-row items-center mb-2">
            <Icon name="package-variant-closed" size={18} color={colors.warning.dark} />
            <Text
              className="text-base font-bold ml-2"
              style={{ color: colors.warning.dark }}
            >
              {t('installer.scopeNoProducts')}
            </Text>
          </View>
          <Text
            className="text-sm font-semibold leading-5 mb-2"
            style={{ color: colors.text }}
          >
            {t('installer.scopeNoProductsBody')}
          </Text>
          <Text
            className="text-sm font-semibold leading-5"
            style={{ color: colors.textSecondary }}
          >
            {t('installer.scopeNoProductsAction')}
          </Text>
        </View>
      )}

      {products.map((product, idx) => {
        const st = scope[product.id];
        const accent = productColor(idx, product.color, product.name);

        return (
          <ProductScopeCard
            key={product.id}
            product={product}
            accent={accent}
          >
            {/* Verification state */}
            {!st ? (
              <View className="flex-row mt-2" style={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => handleConfirmProduct(product)}
                  className="flex-1 rounded-lg items-center justify-center py-2.5 flex-row"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Icon name="check" size={14} color="#fff" />
                  {/* `shrink`, NOT `flex-1`: a flex-1 label would eat the whole row and centre
                      itself inside the leftover space, leaving the icon pinned to the far left.
                      Shrinking keeps icon+label centred as one unit while still letting the
                      wider Spanish "Confirmar correcto" wrap in this half-width button. */}
                  <Text className="shrink text-white text-sm font-bold ml-1 text-center">
                    {t('installer.scopeConfirmCorrect')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleOpenDiscrepancy(product)}
                  className="flex-1 rounded-lg items-center justify-center py-2.5 flex-row border-2"
                  style={{ borderColor: colors.warning.main, backgroundColor: colors.background }}
                >
                  <Icon name="alert-outline" size={14} color={colors.warning.dark} />
                  <Text
                    className="shrink text-sm font-bold ml-1 text-center"
                    style={{ color: colors.warning.dark }}
                  >
                    {t('installer.scopeDiscrepancy')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : st.state === 'confirmed' ? (
              <View className="flex-row items-center mt-2">
                <View
                  className="w-[18px] h-[18px] rounded-full items-center justify-center mr-2"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Icon name="check" size={11} color="#fff" />
                </View>
                <Text className="text-sm font-bold" style={{ color: colors.primary.main }}>
                  {t('installer.scopeConfirmed')}
                </Text>
                <TouchableOpacity
                  onPress={() => handleUndoProduct(product)}
                  className="ml-auto"
                >
                  <Text
                    className="text-xs font-bold underline"
                    style={{ color: colors.textSecondary }}
                  >
                    {t('installer.scopeUndo')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : st.state === 'pending' ? (
              <View
                className="mt-2 rounded-lg p-2.5 border"
                style={{ backgroundColor: colors.background, borderColor: colors.warning.main }}
              >
                <View className="flex-row items-center">
                  <View
                    className="rounded-md px-1.5 py-0.5 mr-2"
                    style={{ backgroundColor: colors.warning.main }}
                  >
                    <Text className="text-white text-[10px] font-black tracking-widest">
                      {t('installer.scopePending')}
                    </Text>
                  </View>
                  <Text
                    className="flex-1 text-sm font-bold"
                    style={{ color: colors.warning.dark }}
                  >
                    {t('installer.scopeAwaitingIm', { issue: st.issue ?? '' })}
                    {st.attachments?.length
                      ? st.attachments.length === 1
                        ? t('installer.scopePhotoCountOne', { count: st.attachments.length })
                        : t('installer.scopePhotoCountMany', { count: st.attachments.length })
                      : ''}
                  </Text>
                </View>
                {/*
                  Stand-in for the IM resolving from their console. Remove once the
                  discrepancy endpoint pushes a real status back.
                */}
                <TouchableOpacity
                  onPress={() => handleResolveProduct(product, st)}
                  className="mt-1.5"
                >
                  <Text
                    className="text-xs font-bold underline"
                    style={{ color: colors.textSecondary }}
                  >
                    DEMO: simulate IM resolve
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View
                className="flex-row items-center mt-2 rounded-lg p-2.5 border"
                style={{
                  backgroundColor: colors.primary.main + '14',
                  borderColor: colors.primary.main,
                }}
              >
                <View
                  className="w-[18px] h-[18px] rounded-full items-center justify-center mr-2"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Icon name="check" size={11} color="#fff" />
                </View>
                <Text
                  className="flex-1 text-sm font-bold"
                  style={{ color: colors.primary.main }}
                >
                  {t('installer.scopeResolvedBy', { issue: st.issue ?? '' })}
                </Text>
              </View>
            )}
          </ProductScopeCard>
        );
      })}

      {resolved > 0 && (
        <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
          {t('installer.scopeSummary', {
            confirmed: products.length - resolved,
            resolved,
          })}
        </Text>
      )}

      <DiscrepancyModal
        visible={showDiscrepancySheet}
        product={sheetFor}
        jobPhotos={jobPhotos}
        onClose={() => setSheetFor(null)}
        onSend={({ issue, note, attachments }) => {
          if (!sheetFor) return;
          log.discrepancyReported(sheetFor, { issue, note, attachments });
          onReportDiscrepancy(sheetFor.id, issue, note, attachments);
          onSetStatus(sheetFor.id, { state: 'pending', issue, note, attachments });
          setSheetFor(null);
          FlashMessage.success(
            t('installer.scopeDiscrepancySent'),
            t('installer.scopeDiscrepancySentBody')
          );
        }}
      />
    </InstallerSubScreen>
  );
}
