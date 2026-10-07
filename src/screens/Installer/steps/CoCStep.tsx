import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Path } from 'react-native-svg';
import DocumentScanner from 'react-native-document-scanner-plugin';
import Pdf from 'react-native-pdf';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerSubScreen } from '../../../widgets/components/installer/InstallerSubScreen';
import { CoCFormModal, type CoCFormData } from '../../../widgets/modals/installer/CoCFormModal';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import { PdfPreviewModal } from '../../../widgets/modals/PdfPreviewModal';
import { resolvePacketUrl } from '../../../utils/installer-packet';
import type {
  CapturedPhoto,
  CocScanFields,
  CocSignOff,
  InstallerJob,
  JobPacket,
} from '../../../config/types/installer';

interface Props {
  visible: boolean;
  job: InstallerJob;
  pages: CapturedPhoto[];
  onAddPage: (page: CapturedPhoto) => Promise<CocScanFields | null>;
  onSignature: (photo: CapturedPhoto, who: 'installer' | 'customer') => void;
  onSignOff: (data: CoCFormData) => void;
  signOff?: CocSignOff | null;
  document?: JobPacket | null;
  onBack: () => void;
}

export function CoCStep({
  visible,
  job,
  pages,
  onAddPage,
  onSignature,
  onSignOff,
  signOff,
  document,
  onBack,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const log = useInstallerActivityLog();

  const [showForm, setShowForm] = useState(false);
  const [signed, setSigned] = useState<CoCFormData | null>(null);

  const [scannedFields, setScannedFields] = useState<CocScanFields | null>(null);

  const [readingScan, setReadingScan] = useState(false);

  const [formSession, setFormSession] = useState(0);
  const openForm = useCallback(
    (source: 'auto' | 'edit' | 'scan_cancelled' | 'scan') => {
      log.cocFormOpened(source);
      setFormSession((n) => n + 1);
      setShowForm(true);
    },
    [log]
  );

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
  const hasResult = !!shown || hasPages || !!document;

  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => {
    if (!visible || !document) {
      setPdfUri(null);
      setPdfFailed(false);
      return;
    }
    let cancelled = false;
    setPdfFailed(false);
    resolvePacketUrl(document)
      .then((url) => {
        if (cancelled) return;
        setPdfUri(url);
        if (!url) setPdfFailed(true);
      })
      .catch((err) => {
        console.warn('[CoCStep] Could not resolve the certificate PDF:', err);
        if (!cancelled) setPdfFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, document]);

  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current && !hasResult) openForm('auto');
    if (!visible) setShowForm(false);
    wasVisible.current = visible;
  }, [visible, hasResult, openForm]);

  const customerName =
    [job.customerDetails?.firstName, job.customerDetails?.lastName].filter(Boolean).join(' ') ||
    job.customerName ||
    t('installer.customer');

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

  const startScan = useCallback(async (): Promise<{
    pages: number;
    read: Promise<CocScanFields | null>;
  }> => {
    try {
      const result = await DocumentScanner.scanDocument({
        maxNumDocuments: Math.max(1, 10 - pages.length),
        letUserAdjustCrop: true,
      } as any);

      const scanned: string[] = result?.scannedImages ?? [];
      const reads = scanned.map((uri: string, i: number) => {
        const page = {
          id: `${Date.now()}-${i}`,
          uri,
          takenAt: new Date(Date.now() + i).toISOString(),
        };
        return onAddPage(page);
      });

      return {
        pages: scanned.length,
        read: Promise.all(reads).then((all) => all.find((fields) => !!fields) ?? null),
      };
    } catch (error) {
      if (error instanceof Error && !error.message.includes('cancel')) {
        Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
      }
      return { pages: 0, read: Promise.resolve(null) };
    }
  }, [onAddPage, pages.length]);


  const handleSignatureCaptured = useCallback(
    (uri: string, who: 'installer' | 'customer') =>
      onSignature({ id: `coc-signature-${who}-${Date.now()}`, uri, takenAt: new Date().toISOString() }, who),
    [onSignature]
  );

  const handleDone = () => {
    log.cocCompleted(pages.length);
    onBack();
  };

  const handlePaperFallback = async () => {
    const { pages: count, read } = await startScan();
    log.cocScanned({ pages: count, totalPages: pages.length + count });
    if (count === 0) {
      if (hasResult) setShowForm(false);
      else openForm('scan_cancelled');
      return;
    }

    setReadingScan(true);
    const fields = await read;
    setReadingScan(false);

    if (!fields) {
      setShowForm(false);
      return;
    }
    setScannedFields(fields);
    openForm('scan');
  };

  const handleCloseForm = () => {
    setShowForm(false);
    if (!hasResult) onBack();
  };

  return (
    <>
      {/* The result view — only ever on screen once there is a certificate to show. */}
      <InstallerSubScreen
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
        {/* The certificate as SIGNED on this device. Replaced by the filed document the
            moment there is one — two versions of the same certificate on one screen is
            one more than the crew can act on, and only the PDF is what the office has. */}
        {!document && !!shown && (
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

        {/*
          ⚠️ The scanned-page tiles were REMOVED from this screen, by request.

          They were showing the certificate's own signatures back as "Page 1..6": a
          signature and a scanned page are uploaded identically (`phase: 'coc'`,
          `subcategory: 'coc'`), so every re-sign orphaned a pair that returned from
          the server as pages — directly under the card already displaying them.

          That duplication is fixed at its source in `installer-hydrate`, and this
          screen no longer carries a tile grid at all: it is the RESULT view for a
          signed certificate, and the pages it was drawing were never its subject.
        */}

        {/* Back into the certificate — a correction to what is shown above it, not a
            landing choice.

            ⚠️ The scanner has NO button here, by request. Its only entry point is the
            form's own Paper Fallback pill, which is where sales puts it; this screen is
            the result, and a second way in from it read as a choice the installer had
            already made. `startScan` is still reached from there, so nothing is lost. */}
        {/* The SUBMITTED certificate, as the office holds it.

            Rendered here rather than behind a button because it IS the step now: the
            certificate has been filed, so what the crew needs is to see the document,
            not a way back into a form that can no longer change it. */}
        {!!document && (
          <View
            className="rounded-2xl overflow-hidden border-2 mb-3"
            style={{ borderColor: colors.primary.main, backgroundColor: colors.surface }}
          >
            <View
              className="flex-row items-center px-3 py-2.5"
              style={{ backgroundColor: colors.primary.main + '15' }}
            >
              <View
                className="w-6 h-6 rounded-full items-center justify-center mr-2.5"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="check" size={14} color="#fff" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold" style={{ color: colors.primary.main }}>
                  {t('installer.cocSubmittedTitle')}
                </Text>
                {!!shown?.date && (
                  <Text
                    className="text-[11px] font-semibold"
                    style={{ color: colors.textSecondary }}
                  >
                    {t('installer.cocSignedBy', { name: customerName, date: shown.date })}
                  </Text>
                )}
              </View>
              <Icon name="file-pdf-box" size={22} color={colors.primary.main} />
            </View>

            <TouchableOpacity
              activeOpacity={0.9}
              disabled={!pdfUri}
              onPress={() => setShowPdf(true)}
              style={styles.pdfPreview}
            >
              {pdfUri ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Pdf
                    source={{ uri: pdfUri, cache: true }}
                    singlePage
                    trustAllCerts={false}
                    onError={(err: any) => {
                      console.warn('[CoCStep] Could not render the certificate PDF:', err);
                      setPdfFailed(true);
                    }}
                    style={[styles.pdfPage, { backgroundColor: colors.background }]}
                  />
                </View>
              ) : (
                <View className="flex-1 items-center justify-center px-6">
                  {pdfFailed ? (
                    <Text
                      className="text-xs font-semibold text-center"
                      style={{ color: colors.textSecondary }}
                    >
                      {t('installer.cocDocumentError')}
                    </Text>
                  ) : (
                    <>
                      <ActivityIndicator color={colors.primary.main} />
                      <Text
                        className="mt-2 text-xs font-semibold"
                        style={{ color: colors.textSecondary }}
                      >
                        {t('installer.cocDocumentLoading')}
                      </Text>
                    </>
                  )}
                </View>
              )}
            </TouchableOpacity>

            {!!pdfUri && (
              <View
                className="flex-row items-center justify-center py-2.5"
                style={{ borderTopWidth: 1, borderTopColor: colors.border }}
              >
                <Icon name="arrow-expand" size={15} color={colors.textSecondary} />
                <Text
                  className="ml-1.5 text-[11px] font-bold"
                  style={{ color: colors.textSecondary }}
                >
                  {t('installer.cocDocumentHint')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ⚠️ NO way back into the form once the certificate is SUBMITTED — the office
            holds the signed PDF above, and a second certificate signed over it on the
            device would disagree with the document the customer put their name to.
            Requested explicitly; the button is otherwise unchanged. */}
        {!document && (
          <TouchableOpacity
            onPress={() => openForm('edit')}
            className="h-12 rounded-xl items-center justify-center flex-row"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Icon name="fountain-pen-tip" size={18} color="#fff" />
            <Text className="text-white ml-2 text-base font-bold text-center">
              {shown ? t('installer.cocSignAgain') : t('installer.cocSignOnDevice')}
            </Text>
          </TouchableOpacity>
        )}

      </InstallerSubScreen>

      {/* The step itself. Rendered as a SIBLING of the sub-screen, not inside it: the
          sub-screen is a Modal, so its children stop rendering the moment it hides. */}
      <CoCFormModal
        key={formSession}
        visible={visible && showForm}
        job={job}
        busyLabel={readingScan ? t('installer.cocReadingScan') : null}
        initial={signOff}
        scanned={scannedFields}
        onClose={handleCloseForm}
        onPaperFallback={handlePaperFallback}
        onSignatureCaptured={handleSignatureCaptured}
        onSubmit={(data) => {
          setSigned(data);
          setShowForm(false);
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

      {/* The signed certificate, full screen — the app-wide viewer, so it downloads,
          zooms, shares and reports its own failures exactly like the job packet does. */}
      {!!pdfUri && (
        <PdfPreviewModal
          visible={showPdf}
          uri={pdfUri}
          title={document?.fileName || t('installer.cocFormTitle')}
          onClose={() => setShowPdf(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pdfPreview: { height: 420 },
  pdfPage: { flex: 1 },
});
