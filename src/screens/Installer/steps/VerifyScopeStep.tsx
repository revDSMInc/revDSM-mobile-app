import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import {
  DiscrepancyModal,
  type JobPhotoRef,
} from '../../../widgets/modals/installer/DiscrepancyModal';
import { productColor } from '../../../constants/installer';
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

/**
 * Verify the sold scope against what's on site.
 *
 * The installer confirms or flags each product — they never edit the spec directly.
 * A flagged product sits `pending` until the Install Manager resolves it, and a
 * pending item blocks the step from closing, because the scope isn't settled yet.
 */
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
  const log = useInstallerActivityLog();
  const [sheetFor, setSheetFor] = useState<SoldProduct | null>(null);

  const pending = products.filter((p) => scope[p.id]?.state === 'pending').length;
  const resolved = products.filter((p) => scope[p.id]?.state === 'resolved').length;
  const confirmed = products.filter((p) => scope[p.id]?.state === 'confirmed').length;

  /**
   * The job arrived with no sold products — its check-in response carried no
   * `productDetails.products`, which means the rep's job build never reached this job.
   *
   * There is nothing to confirm, so the step closes on acknowledgement alone. Blocking
   * it instead would be a dead end: `measure` gates Post-Install, CoC and Return, so
   * the whole install would be uncompletable over missing paperwork the installer has
   * no way to supply from site.
   */
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

  return (
    <InstallerSubScreen
      visible={visible}
      title="Verify Job Scope"
      subtitle="Sold products, footages & colors — confirm or flag"
      onBack={onBack}
      footer={
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
                className="flex-1 ml-2 text-xs font-bold"
                style={{ color: colors.warning.dark }}
              >
                {pending} discrepanc{pending > 1 ? 'ies' : 'y'} awaiting IM — scope review
                can&apos;t close until resolved
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
              className="text-base font-bold"
              style={{ color: allSettled ? '#fff' : colors.textSecondary }}
            >
              {nothingToVerify ? 'Acknowledge — No Scope on File' : 'Done — Scope Reviewed'}
            </Text>
          </TouchableOpacity>
        </>
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
              className="text-[15px] font-bold ml-2"
              style={{ color: colors.warning.dark }}
            >
              No sold products on this job
            </Text>
          </View>
          <Text
            className="text-xs font-semibold leading-5 mb-2"
            style={{ color: colors.text }}
          >
            Nothing was attached for you to verify — the job packet has no measurements,
            colors or product list on it.
          </Text>
          <Text
            className="text-xs font-semibold leading-5"
            style={{ color: colors.textSecondary }}
          >
            Message your Install Manager before starting work. If you go ahead, there is
            no sold scope on record to check the finished job against. Acknowledge below
            to continue the install.
          </Text>
        </View>
      )}

      {products.map((product, idx) => {
        const st = scope[product.id];
        const accent = productColor(idx, product.color);

        return (
          <View
            key={product.id}
            className="rounded-2xl p-3 mb-2.5 border"
            style={{ backgroundColor: accent + '10', borderColor: accent }}
          >
            <Text className="text-[15px] font-bold mb-1.5" style={{ color: colors.text }}>
              {product.name}
            </Text>
            {product.lines.map((line, lineIdx) => (
              <View key={`${product.id}-${lineIdx}`} className="flex-row items-start mb-1">
                <View
                  className="rounded-full mt-1.5 mr-2"
                  style={{ width: 6, height: 6, backgroundColor: accent }}
                />
                <Text
                  className="flex-1 text-xs font-semibold leading-5"
                  style={{ color: colors.text }}
                >
                  {line}
                </Text>
              </View>
            ))}

            {/* Verification state */}
            {!st ? (
              <View className="flex-row mt-2" style={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => handleConfirmProduct(product)}
                  className="flex-1 rounded-lg items-center justify-center py-2.5 flex-row"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Icon name="check" size={13} color="#fff" />
                  <Text className="text-white text-xs font-bold ml-1">Confirm Correct</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleOpenDiscrepancy(product)}
                  className="flex-1 rounded-lg items-center justify-center py-2.5 flex-row border-2"
                  style={{ borderColor: colors.warning.main, backgroundColor: colors.background }}
                >
                  <Icon name="alert-outline" size={13} color={colors.warning.dark} />
                  <Text className="text-xs font-bold ml-1" style={{ color: colors.warning.dark }}>
                    Discrepancy
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
                <Text className="text-xs font-bold" style={{ color: colors.primary.main }}>
                  Confirmed correct
                </Text>
                <TouchableOpacity
                  onPress={() => handleUndoProduct(product)}
                  className="ml-auto"
                >
                  <Text
                    className="text-[11px] font-bold underline"
                    style={{ color: colors.textSecondary }}
                  >
                    undo
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
                    <Text className="text-white text-[9px] font-black tracking-widest">
                      PENDING
                    </Text>
                  </View>
                  <Text
                    className="flex-1 text-[11px] font-bold"
                    style={{ color: colors.warning.dark }}
                  >
                    {st.issue} — awaiting IM resolution
                    {st.attachments?.length
                      ? ` • ${st.attachments.length} photo${st.attachments.length > 1 ? 's' : ''}`
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
                    className="text-[10px] font-bold underline"
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
                  className="flex-1 text-[11px] font-bold"
                  style={{ color: colors.primary.main }}
                >
                  Resolved by IM — {st.issue}
                </Text>
              </View>
            )}
          </View>
        );
      })}

      {resolved > 0 && (
        <Text className="text-[11px] font-semibold" style={{ color: colors.textSecondary }}>
          {products.length - resolved} confirmed · {resolved} resolved by IM
        </Text>
      )}

      <DiscrepancyModal
        visible={!!sheetFor}
        product={sheetFor}
        jobPhotos={jobPhotos}
        onClose={() => setSheetFor(null)}
        onSend={({ issue, note, attachments }) => {
          if (!sheetFor) return;
          log.discrepancyReported(sheetFor, { issue, note, attachments });
          onReportDiscrepancy(sheetFor.id, issue, note, attachments);
          onSetStatus(sheetFor.id, { state: 'pending', issue, note, attachments });
          setSheetFor(null);
          FlashMessage.success('Discrepancy sent', 'The IM and rep have been notified.');
        }}
      />
    </InstallerSubScreen>
  );
}
