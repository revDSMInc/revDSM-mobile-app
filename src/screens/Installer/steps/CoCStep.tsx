import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path } from 'react-native-svg';
import DocumentScanner from 'react-native-document-scanner-plugin';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { ConfirmActionModal } from '../../../widgets/modals/installer/ConfirmActionModal';
import { CoCFormModal, type CoCFormData } from '../../../widgets/modals/installer/CoCFormModal';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import { usePhotoDeleteConfirm } from '../../../hooks/usePhotoDeleteConfirm';
import type { CapturedPhoto, CocSignOff, InstallerJob } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  job: InstallerJob;
  pages: CapturedPhoto[];
  onAddPage: (page: CapturedPhoto) => void;
  /**
   * Resolves once the page is gone from the server as well as from state — the confirm
   * dialog holds its spinner on this promise.
   */
  onRemovePage: (pageId: string) => void | Promise<void>;
  /**
   * One rasterised signature from the on-device certificate, ready for
   * `installer/v1/{jobId}/images`. Called once per signature; the parent uploads and
   * logs it, the same split the scanned pages use.
   */
  onSignature: (photo: CapturedPhoto, who: 'installer' | 'customer') => void;
  /**
   * The submitted certificate. The parent stores it on the job progress and PATCHes
   * `stepData.coc`, once the two signature uploads have landed — this component never
   * touches the network.
   */
  onSignOff: (data: CoCFormData) => void;
  /** A certificate signed earlier in the visit, restored from the job progress. */
  signOff?: CocSignOff | null;
  onBack: () => void;
}

/**
 * Certificate of Completion.
 *
 * ⚠️ **The step OPENS ON THE FORM.** There is no landing screen with a "Sign Certificate
 * of Completion" button in front of it — `CoCFormModal` (the paper certificate, in the
 * sales consent form's chrome) IS this step. The scan path lives where sales puts it,
 * on the form's own **Paper Fallback** pill.
 *
 * `InstallerSubScreen` is only the RESULT view, shown once something has been captured:
 * the signed certificate and/or the scanned pages, with Done. With nothing captured,
 * leaving the form leaves the step — there is nothing behind it to return to.
 *
 * ⚠️ **What IS filed:** each signature goes to `installer/v1/{jobId}/images` as it is
 * saved, and the submitted certificate goes to `stepData.coc` (attestations, signer
 * relationship, and the two signature refs) through the parent. No PDF is generated —
 * the paper document itself still only exists on the SCAN path.
 */
export function CoCStep({
  visible,
  job,
  pages,
  onAddPage,
  onRemovePage,
  onSignature,
  onSignOff,
  signOff,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const log = useInstallerActivityLog();

  const [showForm, setShowForm] = useState(false);
  const [signed, setSigned] = useState<CoCFormData | null>(null);

  /**
   * Bumped on every open, and used as the form's `key`, so each open REMOUNTS it.
   *
   * ⚠️ Without this the form keeps its state for the life of this screen: the modal is
   * mounted the whole time and only its `visible` toggles, so an abandoned draft came
   * back on the next open — half-ticked boxes and a stray signature that was never
   * filed. A remount reseeds it from `signOff`, which is the certificate ON THE
   * SERVER, so what is shown is what was actually recorded.
   */
  const [formSession, setFormSession] = useState(0);
  const openForm = useCallback(() => {
    setFormSession((n) => n + 1);
    setShowForm(true);
  }, []);

  /**
   * What the result card draws.
   *
   * This visit's submit wins; otherwise the record restored from progress, which is
   * what keeps the certificate on screen after the step is reopened. Both carry the
   * strokes, so the signatures redraw either way.
   */
  const shown = signed
    ? {
        date: signed.date,
        installerSignaturePaths: signed.installerSignaturePaths,
        customerSignaturePaths: signed.customerSignaturePaths,
        signatureSize: signed.signatureSize,
      }
    : signOff
    ? {
        date: signOff.date ?? '',
        installerSignaturePaths: signOff.installerSignaturePaths ?? [],
        customerSignaturePaths: signOff.customerSignaturePaths ?? [],
        signatureSize: signOff.signatureSize ?? { width: 1, height: 1 },
      }
    : null;

  const hasPages = pages.length > 0;
  const hasResult = !!shown || hasPages;

  /**
   * Open the form the moment the step opens with nothing captured.
   *
   * Keyed off the visible TRANSITION, not off `hasResult` on every render: re-running it
   * whenever the result changes would throw the form back up the instant an installer
   * deleted their last scanned page from the result view.
   */
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current && !hasResult) openForm();
    if (!visible) setShowForm(false);
    wasVisible.current = visible;
  }, [visible, hasResult, openForm]);

  const customerName =
    [job.customerDetails?.firstName, job.customerDetails?.lastName].filter(Boolean).join(' ') ||
    job.customerName ||
    t('installer.customer');

  /** One signed line from the certificate, replayed from the pad's own paths. */
  const renderSignature = (label: string, paths: string[]) => (
    <View className="flex-1">
      <Text
        className="text-[10px] font-black tracking-wide mb-1"
        style={{ color: colors.textSecondary }}
      >
        {label.toUpperCase()}
      </Text>
      <View
        className="rounded-xl overflow-hidden"
        style={{ height: 72, backgroundColor: colors.background }}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${shown?.signatureSize.width ?? 1} ${shown?.signatureSize.height ?? 1}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke={colors.text}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>
    </View>
  );

  /** Returns how many pages the pass produced, so the caller can react to a cancel. */
  const startScan = useCallback(async (): Promise<number> => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: Math.max(1, 10 - pages.length),
        letUserAdjustCrop: true,
      } as any);

      const scanned: string[] = result?.scannedImages ?? [];
      scanned.forEach((uri: string, i: number) => {
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
      return scanned.length;
    } catch (error) {
      if (error instanceof Error && !error.message.includes('cancel')) {
        Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
      }
      return 0;
    }
  }, [onAddPage, pages.length]);

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

  /**
   * One saved signature, straight to the parent for upload.
   *
   * Fired on SAVE rather than on submit, so the image is filed the moment it exists
   * — the submit is gated behind the attestations and may never be reached.
   */
  const handleSignatureCaptured = useCallback(
    (uri: string, who: 'installer' | 'customer') =>
      onSignature({ id: `coc-signature-${who}-${Date.now()}`, uri, takenAt: new Date().toISOString() }, who),
    [onSignature]
  );

  const handleDone = () => {
    log.cocCompleted(pages.length);
    onBack();
  };

  /**
   * The form's "Paper Fallback" pill — close the form and open the scanner.
   *
   * A cancelled scan with nothing captured would otherwise leave the installer on an
   * empty result screen, so the form comes back.
   */
  const handlePaperFallback = async () => {
    setShowForm(false);
    const scanned = await startScan();
    if (scanned === 0 && !hasResult) openForm();
  };

  /** The form's ✕ / Exit. With nothing captured, leaving the form leaves the step. */
  const handleCloseForm = () => {
    setShowForm(false);
    if (!hasResult) onBack();
  };

  return (
    <>
      {/* The result view — only ever on screen once there is a certificate to show. */}
      <InstallerSubScreen
        // Gated on `hasResult` as well, so it can never paint an EMPTY result screen —
        // including for the one frame between the step opening and the effect above
        // raising the form.
        visible={visible && !showForm && hasResult}
        title={t('installer.cocTitle')}
        subtitle={t('installer.cocSub')}
        onBack={onBack}
        footer={
          hasResult ? (
            <TouchableOpacity
              onPress={handleDone}
              className="h-12 rounded-xl items-center justify-center"
              style={{ backgroundColor: colors.primary.main }}
            >
              <Text className="text-white text-base font-bold text-center">
                {hasPages
                  ? pages.length === 1
                    ? t('installer.cocDoneOne', { count: pages.length })
                    : t('installer.cocDoneMany', { count: pages.length })
                  : t('installer.cocDoneSigned')}
              </Text>
            </TouchableOpacity>
          ) : undefined
        }
      >
        {/* ⚠️ No "N pages captured" banner, by request. The page tiles below already
            show what was scanned and the footer says how many — a third count read as
            noise, especially beside the signed-certificate card. */}
        {/* Device-signed certificate — the signatures are replayed from the pad's own
            paths, so what was drawn is what the crew sees back. */}
        {!!shown && (
          <View
            className="rounded-2xl p-3 mb-3 border-2"
            style={{
              backgroundColor: colors.primary.main + '10',
              borderColor: colors.primary.main,
            }}
          >
            <View className="flex-row items-center mb-2">
              <View
                className="w-6 h-6 rounded-full items-center justify-center mr-2.5"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="check" size={14} color="#fff" />
              </View>
              <Text className="flex-1 text-sm font-bold" style={{ color: colors.primary.main }}>
                {t('installer.cocSignedBy', { name: customerName, date: shown.date })}
              </Text>
            </View>

            {/* Both lines of the paper certificate, side by side and labelled — the
                installer signs one and the homeowner the other, and an unlabelled pair
                gives the crew no way to check they went in the right order. */}
            <View className="flex-row mb-2" style={{ gap: 8 }}>
              {renderSignature(
                t('installer.cocSignatureOfInstaller'),
                shown.installerSignaturePaths
              )}
              {renderSignature(
                t('installer.cocSignatureOfCustomer'),
                shown.customerSignaturePaths
              )}
            </View>

            {/* Says plainly that nothing has been filed — the office has no copy of this
                until the submit is wired up. */}
            <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
              {t('installer.cocSignedLocalNote')}
            </Text>
          </View>
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

        {/* Back into the certificate — a correction to what is shown above it, not a
            landing choice.

            ⚠️ The scanner has NO button here, by request. Its only entry point is the
            form's own Paper Fallback pill, which is where sales puts it; this screen is
            the result, and a second way in from it read as a choice the installer had
            already made. `startScan` is still reached from there, so nothing is lost. */}
        <TouchableOpacity
          onPress={openForm}
          className="h-12 rounded-xl items-center justify-center flex-row"
          style={{ backgroundColor: colors.primary.main }}
        >
          <Icon name="fountain-pen-tip" size={18} color="#fff" />
          <Text className="text-white ml-2 text-base font-bold text-center">
            {shown ? t('installer.cocSignAgain') : t('installer.cocSignOnDevice')}
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

      {/* The step itself. Rendered as a SIBLING of the sub-screen, not inside it: the
          sub-screen is a Modal, so its children stop rendering the moment it hides. */}
      <CoCFormModal
        key={formSession}
        visible={visible && showForm}
        job={job}
        // What was actually FILED, so reopening shows the certificate on the server
        // rather than whatever this device happens to remember. The `key` above still
        // discards anything typed and abandoned in a previous open.
        initial={signOff}
        onClose={handleCloseForm}
        onPaperFallback={handlePaperFallback}
        onSignatureCaptured={handleSignatureCaptured}
        onSubmit={(data) => {
          setSigned(data);
          setShowForm(false);
          // The parent stores it and PATCHes `stepData.coc` once the signature
          // uploads have landed — it owns both the progress and the request.
          onSignOff(data);

          log.cocSigned({
            jobNumber: data.jobNumber,
            date: data.date,
            relationship: data.relationship,
            relationshipOther: data.relationshipOther || undefined,
            signatureCount: [data.installerSignaturePaths, data.customerSignaturePaths].filter(
              (paths) => paths.length > 0
            ).length,
          });
        }}
      />
    </>
  );
}
