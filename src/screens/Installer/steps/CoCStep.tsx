import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
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
  /**
   * One scanned page, straight to the parent for upload.
   *
   * Resolves to the certificate the BACKEND read off that page, or `null` when it read
   * nothing — the Paper Fallback path is the only one that gets anything back, and it
   * is what prefills the form. A `null` leaves the form exactly as it would have been.
   */
  onAddPage: (page: CapturedPhoto) => Promise<CocScanFields | null>;
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
  /**
   * The SIGNED certificate as the server generated it, off the submit response.
   *
   * Its presence is what turns this step from a form into a filed document: the PDF is
   * shown in the tab and the certificate can no longer be edited from here.
   */
  document?: JobPacket | null;
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

  /**
   * What the backend read off the SCANNED paper certificate — Job #, date, who signed
   * and the three attestations.
   *
   * Kept on the STEP rather than in the form: the form is remounted on every open (see
   * `formSession`), so anything held there would be discarded the moment the crew
   * closed it to check something. These values came off the paper the customer has
   * already signed — they outlive one look at the form.
   */
  const [scannedFields, setScannedFields] = useState<CocScanFields | null>(null);

  /** True while a scanned page is being read — see `handlePaperFallback`. */
  const [readingScan, setReadingScan] = useState(false);

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
  const openForm = useCallback(
    (source: 'auto' | 'edit' | 'scan_cancelled' | 'scan') => {
      log.cocFormOpened(source);
      setFormSession((n) => n + 1);
      setShowForm(true);
    },
    [log]
  );

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
  // A submitted certificate counts on its own: the crew may have signed it on another
  // device, in which case the PDF is the only thing this one has.
  const hasResult = !!shown || hasPages || !!document;

  /**
   * The signed certificate, resolved to something a viewer can open.
   *
   * The document arrives as a bucket-relative key, so it has to be exchanged for a
   * signed URL (`resolvePacketUrl`, which caches inside S3's hour). Resolved only while
   * the step is OPEN — a job list mounting seven steps must not sign seven URLs.
   */
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

  /**
   * Open the form the moment the step opens with nothing captured.
   *
   * Keyed off the visible TRANSITION, not off `hasResult` on every render: re-running it
   * whenever the result changes would throw the form back up the instant an installer
   * deleted their last scanned page from the result view.
   */
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

  /**
   * Returns how many pages the pass produced, so the caller can react to a cancel,
   * alongside the certificate read back off them.
   *
   * WARNING: `read` is a PROMISE and is deliberately NOT awaited here. The page count is
   * known the moment the scanner closes, and the scan log — including a cancelled pass —
   * is written from it; the certificate only lands once the upload has been answered.
   * Awaiting it here would hold the count, and the cancel path, behind a round trip.
   */
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
          // Stamped per page, not per scan: `timestampTaken` is what orders the
          // pages once they come back from the server, so two pages from the same
          // pass must not share a timestamp.
          takenAt: new Date(Date.now() + i).toISOString(),
        };
        // The parent adds it to state and uploads it; the upload hook logs the page
        // once S3 has answered with the s3url and byte size the portal needs. The
        // certificate the backend read off the page comes back through the same call.
        return onAddPage(page);
      });

      return {
        pages: scanned.length,
        // The FIRST page that came back with a certificate wins. A multi-page scan is
        // one document and the fields sit on the page carrying the signatures, so a
        // later page that read nothing must not blank what an earlier one found.
        read: Promise.all(reads).then((all) => all.find((fields) => !!fields) ?? null),
      };
    } catch (error) {
      if (error instanceof Error && !error.message.includes('cancel')) {
        Alert.alert('Scanning Error', 'An error occurred while trying to scan the document.');
      }
      return { pages: 0, read: Promise.resolve(null) };
    }
  }, [onAddPage, pages.length]);


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
    const { pages: count, read } = await startScan();
    // Includes a cancelled pass (`pages: 0`) — a run of those is a scanner the crew
    // could not get to work, which is invisible if only successes are recorded.
    log.cocScanned({ pages: count, totalPages: pages.length + count });
    if (count === 0) {
      if (!hasResult) openForm('scan_cancelled');
      return;
    }

    // The read is a round trip behind the scanner closing, and the form is down while
    // it runs — without saying so the crew is left on the result screen with no reason
    // to think anything is still happening.
    setReadingScan(true);
    const fields = await read;
    setReadingScan(false);

    // Read nothing? Leave the step exactly as it was before any of this existed: the
    // pages are filed and the result screen stands. Only a certificate that was
    // actually read reopens the form — an empty one would ask the crew to fill in, by
    // hand, the paper they have just scanned.
    if (!fields) return;
    setScannedFields(fields);
    openForm('scan');
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
                // ⚠️ `pointerEvents="none"` is what keeps this page scrollable. The PDF
                // view handles its own pan and pinch, and inside the step's ScrollView
                // the two fight — the tab stops scrolling past the document. Deaf to
                // touch, it is a picture, and the press below opens the real viewer.
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
        // What was actually FILED, so reopening shows the certificate on the server
        // rather than whatever this device happens to remember. The `key` above still
        // discards anything typed and abandoned in a previous open.
        initial={signOff}
        // Read off the paper by the backend. Outranks `initial` field by field — it is
        // the document in the crew's hand, and it carries the Job # and the date the
        // certificate was actually signed on.
        scanned={scannedFields}
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

      {/* Reading the scanned certificate.

          A blocking card rather than a spinner on the result screen: the form is down,
          the pages are already filed, and the next thing that happens — the form coming
          back with the paper's own values in it — is a surprise without this. */}
      <Modal visible={visible && readingScan} transparent animationType="fade">
        <View
          className="flex-1 items-center justify-center px-10"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          <View
            className="rounded-2xl px-6 py-5 items-center"
            style={{ backgroundColor: colors.surface }}
          >
            <ActivityIndicator color={colors.primary.main} />
            <Text
              className="mt-3 text-sm font-semibold text-center"
              style={{ color: colors.text }}
            >
              {t('installer.cocReadingScan')}
            </Text>
          </View>
        </View>
      </Modal>

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
  /** Tall enough to read the certificate's heading and its first fields at a glance. */
  pdfPreview: { height: 420 },
  pdfPage: { flex: 1 },
});
