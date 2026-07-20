import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  Alert,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { AppointmentSchedulerModal } from '../../../modals/job-builder/AppointmentSchedulerModal';
import { DocumentScannerModal } from '../../../modals/job-builder/DocumentScannerModal';
import { DynamicAgreementDialog } from './DynamicAgreementDialog';
import { logEvent } from '../../../../services/api/LoggerService';
import { useAuth } from '../../../../hooks/useAuth';
import { convertJpegToPdf } from '../../../../utils/jpeg-to-pdf';
import { PdfPreviewModal } from '../../../modals/PdfPreviewModal';

type DocCategory = 'agreement' | 'orderSheet';

interface SummaryFinalizeCardsProps {
  leadId?: string;
  isSale?: boolean;
  isDemo?: boolean;
  customerName?: string;
  scheduleTime?: any;
  agreements?: any[];   // [{ files: [...] }]
  orderSheets?: any[];  // [{ files: [...] }]
  onUpdateRootState?: (key: string, value: any) => void;
  resolvedDocuments?: { agreements: any[]; orderSheets: any[] };
  setResolvedDocuments?: React.Dispatch<React.SetStateAction<{ agreements: any[]; orderSheets: any[] }>>;
  isDocUploadingRef?: React.MutableRefObject<boolean>;
  // Persists the base64 doc payloads via the screen (which holds config +
  // dealCenterData to serialize field state and writes the web-shaped outcome).
  onUploadDocs?: (cat: DocCategory, payloads: any[]) => Promise<boolean>;
  productKey?: string;
  verticalState?: any;
  jobState?: any;
  calculatorResultData?: any;
  repDetails?: any;
  /** Web `useDealEditMode()` — true when editing an already-resulted deal. */
  editMode?: boolean;
}

const GREEN = '#22C55E';
// jobState.agreements / .orderSheets are FLAT arrays of file objects (the shape the
// backend outcome endpoint expects: [{ name, file, documentType, isNew }]). Some
// server-loaded shapes wrap them in { files: [...] } — normalize either to flat.
const toFlatFiles = (arr?: any[]): any[] =>
  (arr || []).flatMap((x) => (x && Array.isArray(x.files) ? x.files : [x])).filter(Boolean);
const isPdf = (f: any) =>
  (f?.contentType || f?.mimeType || '').includes('pdf') ||
  String(f?.name || f?.uri || f?.url || '').toLowerCase().endsWith('.pdf');
const fileSrc = (f: any) => f?.secureUrl || f?.displayUrl || f?.url || f?.uri || f?.thumbnailUrl || f?.file;

/**
 * Appointment + Agreement + Order-sheet cards for the dynamic Job Builder summary
 * tab. Mirrors the normal JB SummarySection finalize section, wired to the dynamic
 * root-state setter and the ported client-side agreement generator.
 */
export function SummaryFinalizeCards({
  leadId,
  isSale,
  isDemo,
  customerName = '',
  scheduleTime,
  agreements,
  orderSheets,
  onUpdateRootState,
  resolvedDocuments,
  setResolvedDocuments,
  isDocUploadingRef,
  onUploadDocs,
  productKey,
  verticalState,
  jobState,
  calculatorResultData,
  repDetails,
  editMode = false,
}: SummaryFinalizeCardsProps) {
  // Web `vertical-summary-tab.js:407-409` (uses `useDealEditMode()`): editing an
  // already-resulted deal drops the "Required" gates and hides the demo-only
  // order-sheet card.
  const agreementRequired = !!isSale && !editMode;
  const orderSheetRequired = !!isDemo && !editMode;
  const showOrderSheetCard = !!isSale || (!!isDemo && !editMode);
  const [schedulerVisible, setSchedulerVisible] = useState(false);
  const [isEditingAppt, setIsEditingAppt] = useState(false);
  const [scannerCategory, setScannerCategory] = useState<DocCategory | null>(null);
  const [agreementDialogVisible, setAgreementDialogVisible] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ uri: string; title?: string } | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const isAppointmentSet = Boolean(scheduleTime?.date);

  // View a document: server docs / PDFs (http URLs) open in the PDF viewer (which
  // also handles image URLs); a locally-generated image data-uri opens inline.
  const openDoc = (doc: any) => {
    const src = fileSrc(doc);
    if (!src) return;
    if (String(src).startsWith('http') || isPdf(doc)) {
      setPdfPreview({ uri: src, title: doc?.name });
    } else {
      setPreview(src);
    }
  };

  // Display = resolved (server / just-uploaded) docs + any flat local drafts.
  const agreementFiles = useMemo(
    () => [...toFlatFiles(agreements), ...(resolvedDocuments?.agreements || [])],
    [agreements, resolvedDocuments]
  );
  const orderSheetFiles = useMemo(
    () => [...toFlatFiles(orderSheets), ...(resolvedDocuments?.orderSheets || [])],
    [orderSheets, resolvedDocuments]
  );

  // --- appointment -------------------------------------------------------
  // The scheduler's NEW-appointment flow (isEdit=false) never calls onConfirm — it
  // calls onGenerate ("Generate Dynamic Agreement") or onUpload ("Add Presigned
  // Agreement"). Both must (a) persist scheduleTime and (b) proceed to the next
  // step, exactly like the normal JB. onConfirm is only used by the EDIT flow.
  const saveAppointment = (data: any) => {
    onUpdateRootState?.('scheduleTime', { ...data, customerName: data.customerName || customerName });
    // appointment_scheduled (web parity: schedule-appointment-summary-card handleConfirm).
    if (user?._id) {
      logEvent('change', {
        user_id: user._id,
        created_by: user._id,
        module_type: 'job_builder',
        meta: {
          draft: true,
          leadId,
          date: data?.date,
          timeWindow: data?.timeWindow || null,
          isTBD: data?.date === 'TBD',
          tbdReason: data?.reason || null,
          customerName: data?.customerName || customerName,
          action: 'appointment_scheduled',
        },
      });
    }
    setSchedulerVisible(false);
    setIsEditingAppt(false);
  };

  const handleScheduleConfirm = (data: any) => saveAppointment(data);

  const handleScheduleAndGenerate = (data: any) => {
    saveAppointment(data);
    // Let the scheduler modal finish dismissing before presenting the next modal
    // (iOS only shows one modal at a time; presenting mid-dismiss can no-op).
    setTimeout(() => setAgreementDialogVisible(true), 350);
  };

  const handleScheduleAndUpload = (data: any) => {
    saveAppointment(data);
    setTimeout(() => setScannerCategory('agreement'), 350);
  };

  // --- upload ------------------------------------------------------------
  const rootKeyFor = (cat: DocCategory) => (cat === 'agreement' ? 'agreements' : 'orderSheets');

  // Upload new docs to the lead outcome. The backend requires each doc as a base64
  // PDF at agreements[i].file / orderSheets[i].file (FLAT array, not { files: [] }).
  // Returns display-copies (image thumbnails) on success, or null on failure.
  const uploadNewFiles = async (cat: DocCategory, newFiles: any[]): Promise<any[] | null> => {
    if (!leadId || !newFiles.length) return null;
    if (isDocUploadingRef) isDocUploadingRef.current = true;
    try {
      const payloads: any[] = [];
      const displayDocs: any[] = [];
      for (const f of newFiles) {
        // Resolve to raw base64 (no data: prefix) + whether it's already a PDF.
        let base64Body: string | undefined;
        let alreadyPdf = false;
        const src = f.file && String(f.file).startsWith('data:') ? f.file : null;
        if (src) {
          alreadyPdf = src.startsWith('data:application/pdf');
          base64Body = src.replace(/^data:[^;]+;base64,/, '');
        } else if (f.uri) {
          base64Body = await RNFS.readFile(String(f.uri).replace('file://', ''), 'base64');
          alreadyPdf = isPdf(f);
        }
        if (!base64Body) continue;

        const pdfBase64 = alreadyPdf ? base64Body : convertJpegToPdf(base64Body);
        const baseName = f.name || `${cat}_${Date.now()}`;
        payloads.push({
          name: baseName.replace(/\.[a-z]+$/i, '.pdf'),
          file: `data:application/pdf;base64,${pdfBase64}`,
          documentType: cat,
          isNew: true,
        });
        // Thumbnail: keep the ORIGINAL image (name + uri) so it renders as an image
        // preview, not a generic PDF icon (isPdf keys off name/uri/contentType).
        displayDocs.push({
          name: baseName,
          uri: f.file || f.uri,
          contentType: alreadyPdf ? 'application/pdf' : 'image/jpeg',
          documentType: cat,
          isNew: false,
        });
      }
      if (!payloads.length) return null;

      // Persist via the screen — it holds the config + dealCenterData needed to
      // serialize the field state and writes the web-shaped outcome payload
      // (top-level agreements/orderSheets → upserts the LeadOutcomeDocument S3
      // rows; serialized jobBuilder.dynamicJobState so field state isn't lost).
      const ok = onUploadDocs ? await onUploadDocs(cat, payloads) : false;
      if (!ok) {
        Alert.alert('Upload failed', 'Could not save the document. Please try again.');
        return null;
      }
      return displayDocs;
    } catch (e) {
      console.warn('[SummaryFinalizeCards] upload failed', e);
      Alert.alert('Upload failed', 'Could not save the document. Please try again.');
      return null;
    } finally {
      if (isDocUploadingRef) isDocUploadingRef.current = false;
    }
  };

  // After a successful upload the doc lives on the server. Clear the local draft so
  // the debounced auto-save doesn't resend base64 (which would also trip the
  // backend's "file required" validation), and mirror the uploaded docs into
  // resolvedDocuments for display — matching the normal JB (clear draft + refetch).
  const commitUploaded = (cat: DocCategory, displayDocs: any[]) => {
    onUpdateRootState?.(rootKeyFor(cat), []);
    setResolvedDocuments?.((prev) => {
      const key = cat === 'agreement' ? 'agreements' : 'orderSheets';
      const base = prev || { agreements: [], orderSheets: [] };
      return { ...base, [key]: [...(base[key] || []), ...displayDocs] };
    });
    // Refresh the outcome query so the authoritative server doc (with its secure
    // URL) replaces the local copy — and so a quick re-open isn't served stale cache.
    if (leadId) queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
  };

  const handleScannerSave = async (cat: DocCategory, images: any[]) => {
    const newFiles = (images || []).filter((f) => f?.isNew !== false);
    const displayDocs = await uploadNewFiles(cat, newFiles);
    if (displayDocs) {
      commitUploaded(cat, displayDocs);
      // Audit log: a scanned/presigned agreement was uploaded (web parity — the
      // generated path is logged in DynamicAgreementDialog as agreement_generated).
      if (cat === 'agreement' && user?._id) {
        logEvent('add', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'agreement',
          meta: {
            leadId,
            fieldName: 'agreement',
            // Web parity (document-summary-cards.js): the UPLOADED path labels the
            // field 'Agreement Uploaded'; only the GENERATED path uses 'Agreement'.
            fieldLabel: 'Agreement Uploaded',
            action: 'agreement_uploaded',
          },
        });
      }
    }
    setScannerCategory(null);
  };

  const handleAgreementGenerated = async (file: any) => {
    const displayDocs = await uploadNewFiles('agreement', [file]);
    if (displayDocs) commitUploaded('agreement', displayDocs);
    setAgreementDialogVisible(false);
  };

  const renderDocSection = (
    title: string,
    iconName: string,
    accent: string,
    files: any[],
    cat: DocCategory,
    isAgreement: boolean,
    // Web `document-summary-cards.js`: the badge is driven by a `required` FLAG
    // (agreements → sale, order sheets → demo), not by "is this the agreement
    // card". Mobile hardcoded `isAgreement`, so agreements were always badged
    // Required and order sheets never were.
    required = false,
  ) => {
    const isEmpty = files.length === 0;
    return (
      <View style={styles.card}>
        <View style={[styles.sectionHeader, { backgroundColor: accent }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.sectionHeaderText}>{title}</Text>
            {/* Web parity: Required shows only while there are NO documents —
                once uploaded the badge is replaced by the edit affordance. */}
            {required && isEmpty && (
              <View style={{ backgroundColor: 'white', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 }}>
                <Text style={{ color: accent, fontSize: 6, fontWeight: '900' }}>REQUIRED</Text>
              </View>
            )}
          </View>
          {!isEmpty && (
            <TouchableOpacity onPress={() => setScannerCategory(cat)} hitSlop={10}>
              {/* Web swaps to a pencil once documents exist (mdi:pencil). */}
              <Icon name="pencil" size={20} color="white" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.sectionBody}>
          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingVertical: 24, borderStyle: 'dashed', borderColor: '#f1f5f9', borderRadius: 24, borderWidth: 2 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon name={iconName} size={32} color="#CBD5E1" />
              </View>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#94a3b8', marginBottom: 24 }}>No documents</Text>
              {/* Web `document-summary-cards.js` empty state: the agreements card
                  shows Generate AND Add Document side by side. Generate is merely
                  DISABLED until an appointment exists (web tooltip: "Schedule the
                  appointment first to generate the agreement") — Add Document is
                  always available. Mobile made the two mutually exclusive and
                  dropped Add Document from agreements entirely, so with no
                  appointment there was no way to attach one at all. */}
              <View style={{ width: '100%', paddingHorizontal: 48, gap: 12 }}>
                {isAgreement && (
                  <>
                    <TouchableOpacity
                      onPress={() => isAppointmentSet && setAgreementDialogVisible(true)}
                      disabled={!isAppointmentSet}
                      style={[styles.outlineActionBtn, !isAppointmentSet && { opacity: 0.4 }]}
                    >
                      <Icon name="auto-fix" size={18} color="#22C55E" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#059669', fontWeight: '900', fontSize: 10 }}>Generate</Text>
                    </TouchableOpacity>
                    {!isAppointmentSet && (
                      <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#ef4444', textAlign: 'center' }}>
                        Schedule an appointment to enable agreements
                      </Text>
                    )}
                  </>
                )}
                <TouchableOpacity
                  onPress={() => setScannerCategory(cat)}
                  style={styles.outlineActionBtn}
                >
                  <Icon name="plus" size={18} color="#0F172A" />
                  <Text style={{ color: '#0f172a', fontWeight: '900', fontSize: 10, marginLeft: 8 }}>Add Document</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {files.map((file, i) => {
                const src = fileSrc(file);
                const isPdfDoc = isPdf(file);
                return (
                  <TouchableOpacity
                    key={file.serverId || file.id || i}
                    onPress={() => openDoc(file)}
                    style={{ width: 96, height: 128, borderRadius: 12, backgroundColor: '#f8fafc', marginRight: 12, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', position: 'relative' }}
                  >
                    {isPdfDoc || !src ? (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="file-pdf-box" size={32} color="#EF4444" />
                        <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', marginTop: 8, paddingHorizontal: 4, textAlign: 'center' }} numberOfLines={1}>
                          {file.name || 'PDF'}
                        </Text>
                      </View>
                    ) : (
                      <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    )}
                    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0, 0, 0, 0.6)', paddingVertical: 4 }}>
                      <Text style={{ color: 'white', fontSize: 6, fontWeight: '900', textAlign: 'center' }}>
                        Page {i + 1}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ marginTop: 4 }}>
      {/* APPOINTMENT (sale only) — styled to match old SummarySection */}
      {isSale &&
        (isAppointmentSet ? (
          <View style={styles.card}>
            <View style={[styles.sectionHeader, { backgroundColor: '#10b981' }]}>
              <Text style={styles.sectionHeaderText}>Scheduled Appointment</Text>
              <TouchableOpacity
                onPress={() => {
                  setIsEditingAppt(true);
                  setSchedulerVisible(true);
                }}
                hitSlop={10}
              >
                <Icon name="pencil" size={20} color="white" />
              </TouchableOpacity>
            </View>
            <View style={styles.sectionBody}>
              <Text style={styles.fieldLabel}>Customer</Text>
              <Text style={styles.fieldValue}>{scheduleTime?.customerName || customerName || 'N/A'}</Text>
              <View style={styles.divider} />
              <Text style={styles.fieldLabel}>Date</Text>
              <Text style={styles.fieldValue}>{scheduleTime?.date === 'TBD' ? 'TBD' : scheduleTime?.date || 'N/A'}</Text>
              {scheduleTime?.timeWindow ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.fieldLabel}>Time Window</Text>
                  <Text style={styles.fieldValue}>{scheduleTime.timeWindow}</Text>
                </>
              ) : null}
              {scheduleTime?.reason ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.fieldLabel}>TBD Reason</Text>
                  <Text style={[styles.fieldValue, { fontWeight: '600', color: '#334155' }]}>{scheduleTime.reason}</Text>
                </>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.cardUnscheduled}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a', marginRight: 12 }}>
                Schedule Appointment
              </Text>
              <View style={styles.requiredPillRed}>
                <Text style={styles.requiredPillTextRed}>Required</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#ef4444', marginBottom: 20 }}>
              Appointment scheduling is required to complete the job
            </Text>
            <TouchableOpacity
              onPress={() => {
                setIsEditingAppt(false);
                setSchedulerVisible(true);
              }}
              style={styles.scheduleBtn}
            >
              <Icon name="calendar-clock" size={22} color="white" />
              <Text style={{ color: 'white', fontWeight: '900', fontSize: 14, marginLeft: 12 }}>Schedule Appointment</Text>
            </TouchableOpacity>
          </View>
        ))}

      {/* Web `vertical-summary-tab.js`:
            const agreementRequired  = isSale && !editMode;
            const orderSheetRequired = isDemo && !editMode;
            const showOrderSheetCard = isSale || (isDemo && !editMode);
          The order-sheet card was gated on `isSale` alone, so on a DEMO — the very
          case where web marks it Required — the card never rendered at all. */}
      {isSale && renderDocSection('Agreements', 'file-certificate-outline', '#ef4444', agreementFiles, 'agreement', true, agreementRequired)}

      {showOrderSheetCard && renderDocSection('Order Sheets', 'file-document-outline', '#00B8D9', orderSheetFiles, 'orderSheet', false, orderSheetRequired)}

      {/* MODALS */}
      <AppointmentSchedulerModal
        visible={schedulerVisible}
        onClose={() => {
          setSchedulerVisible(false);
          setIsEditingAppt(false);
        }}
        onConfirm={handleScheduleConfirm}
        onGenerate={handleScheduleAndGenerate}
        onUpload={handleScheduleAndUpload}
        customerName={customerName}
        isEdit={isEditingAppt}
        initialDate={scheduleTime?.date}
        initialTimeWindow={scheduleTime?.timeWindow}
      />

      <DocumentScannerModal
        visible={scannerCategory !== null}
        onClose={() => setScannerCategory(null)}
        onSave={(images: any[]) => handleScannerSave(scannerCategory || 'orderSheet', images)}
        title={scannerCategory === 'agreement' ? 'Scan Agreement' : 'Scan Order Sheet'}
        leadId={leadId || ''}
        category={scannerCategory || 'orderSheet'}
        initialFiles={scannerCategory === 'agreement' ? agreementFiles : orderSheetFiles}
      />

      <DynamicAgreementDialog
        visible={agreementDialogVisible}
        onClose={() => setAgreementDialogVisible(false)}
        onAgreementGenerated={handleAgreementGenerated}
        leadId={leadId}
        jobId={leadId}
        productKey={productKey}
        jobState={jobState}
        verticalState={verticalState}
        customerDetails={{ name: customerName }}
        repDetails={repDetails}
        calculatorResultData={calculatorResultData}
      />

      {/* IMAGE PREVIEW (local data-uri images) */}
      <Modal visible={preview !== null} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <TouchableOpacity style={styles.previewOverlay} activeOpacity={1} onPress={() => setPreview(null)}>
          {!!preview && <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>

      {/* PDF / server-doc VIEWER */}
      <PdfPreviewModal
        visible={pdfPreview !== null}
        uri={pdfPreview?.uri || ''}
        title={pdfPreview?.title || 'Document'}
        onClose={() => setPdfPreview(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardUnscheduled: {
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    padding: 20,
  },
  sectionHeader: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '900',
    color: 'white',
  },
  sectionBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 4,
  },
  fieldValue: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginBottom: 16,
  },
  requiredPillRed: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  requiredPillTextRed: {
    color: 'white',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  scheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    height: 56,
    borderRadius: 12,
  },
  outlineActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    height: 44,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '92%', height: '80%' },
});
