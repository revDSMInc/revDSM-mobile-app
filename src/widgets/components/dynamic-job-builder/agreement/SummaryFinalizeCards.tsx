import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { AppointmentSchedulerModal } from '../../../modals/job-builder/AppointmentSchedulerModal';
import { DocumentScannerModal } from '../../../modals/job-builder/DocumentScannerModal';
import { DynamicAgreementDialog } from './DynamicAgreementDialog';
import { AgreementRemoteSignModal } from '../../../modals/job-builder/AgreementRemoteSignModal';
import { LeadService } from '../../../../services/api/leads';
import { logEvent } from '../../../../services/api/LoggerService';
import { logAgreementSigned } from '../../../../utils/activity-log/job-builder-logs';
import {
  buildDocumentAuditMeta,
  buildDocumentOpenMeta,
  documentAuditDescriptor,
  DocumentOpenSource,
  pickUnknownDocuments,
} from '../../../../utils/document-audit';
import { useAuth } from '../../../../hooks/useAuth';
import { convertJpegToPdfAsync } from '../../../../utils/jpeg-to-pdf-native';
import { useNavigation } from '@react-navigation/native';
import { openOrderSheetEditor } from '../../../../services/orderSheetAnnotation';
import { FlashMessage } from '../../../../config/message';
import { usePendingOrderSheetJobs } from '../../../../hooks/usePendingOrderSheetJobs';
import { requestOrderSheetReset } from '../../../../services/annotationSaveService';
import { canAnnotateOrderSheet, serverErrorText, showResetAction } from '../../../../utils/order-sheet-annotation';
import { ConfirmDialog } from '../../../../screens/DynamicDealCenter/components/ConfirmDialog';
import { PdfPreviewModal } from '../../../modals/PdfPreviewModal';
import {
  fetchLeadOutcomeDocumentRows,
  resolveOutcomeDocRows,
} from '../../../../screens/DynamicDealCenter/utils/outcome-documents';

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
  onUploadDocs?: (cat: DocCategory, payloads: any[]) => Promise<any[] | null>;
  onRefreshDocs?: (cat: DocCategory) => Promise<any[] | null>;
  productKey?: string;
  verticalState?: any;
  jobState?: any;
  calculatorResultData?: any;
  repDetails?: any;
  editMode?: boolean;
}

const GREEN = '#22C55E';
const toFlatFiles = (arr?: any[]): any[] =>
  (arr || []).flatMap((x) => (x && Array.isArray(x.files) ? x.files : [x])).filter(Boolean);
const isPdf = (f: any) =>
  (f?.contentType || f?.mimeType || '').includes('pdf') ||
  String(f?.name || f?.uri || f?.url || '').toLowerCase().endsWith('.pdf');
const fileSrc = (f: any) => f?.secureUrl || f?.displayUrl || f?.url || f?.uri || f?.thumbnailUrl || f?.file;
const docIdentity = (d: any): string =>
  String(d?.serverId ?? d?._id ?? d?.filePath ?? d?.id ?? d?.url ?? d?.uri ?? d?.name ?? '');
const dedupeDocs = (files: any[]): any[] => {
  const seen = new Set<string>();
  return files.filter((f) => {
    const key = docIdentity(f);
    if (!key || seen.has(key)) return !key;
    seen.add(key);
    return true;
  });
};

const isOpenableDoc = (f: any): boolean => {
  const s = String(fileSrc(f) || '');
  return s.startsWith('file://') || s.startsWith('http') || s.startsWith('data:');
};
const collapseSignedAgreement = (files: any[]): any[] => {
  const sysGen = files.filter((f) => f?.isSystemGenerated);
  if (!sysGen.length) return files;
  const best = sysGen.find(isOpenableDoc) || sysGen[0];
  const merged = {
    ...best,
    serverId: sysGen.map((f) => f?.serverId).find(Boolean) ?? best?.serverId ?? null,
    filePath: sysGen.map((f) => f?.filePath).find(Boolean) ?? best?.filePath ?? null,
    isSystemGenerated: true,
  };
  const mergedKeys = new Set(
    [merged.serverId, merged.filePath, merged.name].filter(Boolean).map(String)
  );
  const isDupOfSigned = (f: any) => {
    const keys = [f?.serverId, f?.filePath, f?.name].filter(Boolean).map(String);
    return keys.some((k) => mergedKeys.has(k)) || !isOpenableDoc(f);
  };
  let placed = false;
  return files.reduce<any[]>((acc, f) => {
    if (f?.isSystemGenerated) {
      if (!placed) {
        placed = true;
        acc.push(merged);
      }
      return acc;
    }
    if (isDupOfSigned(f)) return acc;
    acc.push(f);
    return acc;
  }, []);
};

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
  onRefreshDocs,
  productKey,
  verticalState,
  jobState,
  calculatorResultData,
  repDetails,
  editMode = false,
}: SummaryFinalizeCardsProps) {
  const agreementRequired = !!isSale && !editMode;
  const orderSheetRequired = !!isDemo && !editMode;
  const showOrderSheetCard = !!isSale || (!!isDemo && !editMode);
  const [schedulerVisible, setSchedulerVisible] = useState(false);
  const [isEditingAppt, setIsEditingAppt] = useState(false);
  const [scannerCategory, setScannerCategory] = useState<DocCategory | null>(null);
  const [uploadingCategory, setUploadingCategory] = useState<DocCategory | null>(null);
  const [agreementDialogVisible, setAgreementDialogVisible] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [remoteManageOpen, setRemoteManageOpen] = useState(false);
  const lastRemoteStatusRef = useRef<string | null>(null);
  const remoteSignedLoggedRef = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ uri: string; title?: string } | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  // REVUIUX-569: the order sheet whose pencil was tapped (spinner on its tile while the editor loads).
  const [annotatingKey, setAnnotatingKey] = useState<string | null>(null);

  const isAppointmentSet = Boolean(scheduleTime?.date);

  const openDoc = (doc: any) => {
    const src = fileSrc(doc);
    if (!src) return;
    if (String(src).startsWith('http') || isPdf(doc)) {
      setPdfPreview({ uri: src, title: doc?.name });
    } else {
      setPreview(src);
    }
  };

  const mergeDocSources = useCallback(
    (server: any[] | undefined, draft: any[] | undefined) => {
      const serverFiles = server || [];
      if (editMode && serverFiles.length) return serverFiles;
      return dedupeDocs([...serverFiles, ...toFlatFiles(draft)]);
    },
    [editMode]
  );

  const agreementFiles = useMemo(
    () => collapseSignedAgreement(mergeDocSources(resolvedDocuments?.agreements, agreements)),
    [agreements, resolvedDocuments, mergeDocSources]
  );
  const orderSheetFiles = useMemo(
    () => mergeDocSources(resolvedDocuments?.orderSheets, orderSheets),
    [orderSheets, resolvedDocuments, mergeDocSources]
  );

  const logSchedulerOpened = () => {
    if (!user?._id) return;
    logEvent('click', {
      user_id: user._id,
      created_by: user._id,
      module_type: 'job_builder',
      meta: {
        draft: true,
        leadId,
        date: scheduleTime?.date || null,
        timeWindow: scheduleTime?.timeWindow || null,
        isTBD: scheduleTime?.date === 'TBD',
        tbdReason: scheduleTime?.reason || null,
        customerName: scheduleTime?.customerName || customerName,
        action: 'appointment_scheduled',
      },
    });
  };

  const logAppointmentScheduled = (data: any) => {
    if (!user?._id) return;
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
  };

  const saveAppointment = (data: any) => {
    onUpdateRootState?.('scheduleTime', { ...data, customerName: data.customerName || customerName });
    setSchedulerVisible(false);
    setIsEditingAppt(false);
  };

  const handleAppointmentBooked = (data: any) => {
    if (isEditingAppt) return;
    logAppointmentScheduled(data);
  };

  const handleScheduleConfirm = (data: any) => {
    logAppointmentScheduled(data);
    saveAppointment(data);
  };

  const handleScheduleAndGenerate = (data: any) => {
    saveAppointment(data);
    setTimeout(() => setAgreementDialogVisible(true), 350);
  };

  const handleScheduleAndUpload = (data: any) => {
    saveAppointment(data);
    setTimeout(() => setScannerCategory('agreement'), 350);
  };

  const rootKeyFor = (cat: DocCategory) => (cat === 'agreement' ? 'agreements' : 'orderSheets');

  const uploadNewFiles = async (cat: DocCategory, newFiles: any[]): Promise<any[] | null> => {
    if (!leadId || !newFiles.length) return null;
    if (isDocUploadingRef) isDocUploadingRef.current = true;
    setUploadingCategory(cat);
    try {
      const payloads: any[] = [];
      const displayDocs: any[] = [];
      for (const f of newFiles) {
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

        const pdfBase64 = alreadyPdf ? base64Body : await convertJpegToPdfAsync(base64Body);
        const baseName = f.name || `${cat}_${Date.now()}`;
        payloads.push({
          name: baseName.replace(/\.[a-z]+$/i, '.pdf'),
          file: `data:application/pdf;base64,${pdfBase64}`,
          documentType: cat,
          isNew: true,
        });
        displayDocs.push({
          name: baseName,
          uri: f.file || f.uri,
          contentType: alreadyPdf ? 'application/pdf' : 'image/jpeg',
          documentType: cat,
          isNew: false,
        });
      }
      if (!payloads.length) return null;

      const serverDocs = onUploadDocs ? await onUploadDocs(cat, payloads) : null;
      if (!serverDocs) {
        Alert.alert('Upload failed', 'Could not save the document. Please try again.');
        return null;
      }
      return serverDocs.length ? serverDocs : displayDocs;
    } catch (e) {
      console.warn('[SummaryFinalizeCards] upload failed', e);
      Alert.alert('Upload failed', 'Could not save the document. Please try again.');
      return null;
    } finally {
      if (isDocUploadingRef) isDocUploadingRef.current = false;
      setUploadingCategory(null);
    }
  };

  const commitUploaded = (cat: DocCategory, files: any[]) => {
    const key = rootKeyFor(cat);
    onUpdateRootState?.(key, files.length ? [{ files }] : []);
    setResolvedDocuments?.((prev) => {
      const base = prev || { agreements: [], orderSheets: [] };
      return { ...base, [key]: files };
    });
    if (leadId) {
      queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
      queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
    }
  };

  const logDocumentSheetOpened = (
    cat: DocCategory,
    kind: 'uploaded' | 'generated',
    source: DocumentOpenSource
  ) => {
    if (!user?._id || !leadId) return;
    const meta = buildDocumentOpenMeta(cat, kind, leadId, source);
    if (!meta) return;
    logEvent('click', {
      user_id: user._id,
      created_by: user._id,
      module_type: 'job_builder',
      meta,
    });
  };

  const logDocumentAudit = (
    cat: DocCategory,
    kind: 'uploaded' | 'removed',
    docs: any[],
    refRows?: any[]
  ) => {
    if (!user?._id || !leadId || !docs.length) return;
    const descriptor = documentAuditDescriptor(cat, kind);
    const meta = buildDocumentAuditMeta(cat, kind, leadId, docs, refRows);
    if (!descriptor || !meta) return;
    logEvent(descriptor.eventType, {
      user_id: user._id,
      created_by: user._id,
      module_type: 'job_builder',
      meta,
    });
  };

  const handleScannerSave = async (cat: DocCategory, images: any[]): Promise<boolean> => {
    const key = cat === 'agreement' ? 'agreements' : 'orderSheets';
    const surviving = new Set((images || []).map(docIdentity).filter(Boolean));
    const keep = (d: any) => surviving.has(docIdentity(d));
    setResolvedDocuments?.((prev) => {
      const base = prev || { agreements: [], orderSheets: [] };
      return { ...base, [key]: (base[key] || []).filter(keep) };
    });
    const remainingDraft = toFlatFiles(cat === 'agreement' ? agreements : orderSheets).filter(keep);
    onUpdateRootState?.(key, remainingDraft.length ? [{ files: remainingDraft }] : []);

    const priorFiles = cat === 'agreement' ? agreementFiles : orderSheetFiles;
    logDocumentAudit(cat, 'removed', pickUnknownDocuments(priorFiles, surviving, docIdentity));

    const newFiles = (images || []).filter((f) => f?.isNew !== false);
    if (!newFiles.length) {
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
        queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
      }
      setScannerCategory(null);
      return true;
    }
    const displayDocs = await uploadNewFiles(cat, newFiles);
    if (displayDocs) {
      commitUploaded(cat, displayDocs);
      const knownIds = new Set(priorFiles.map(docIdentity).filter(Boolean));
      logDocumentAudit(
        cat,
        'uploaded',
        newFiles,
        pickUnknownDocuments(displayDocs, knownIds, docIdentity)
      );
    }
    setScannerCategory(null);
    return !!displayDocs;
  };

  /**
   * REVUIUX-569 - the pencil on an order-sheet tile: opens the annotation editor. Saving is a durable background job that
   * replaces the sheet IN PLACE (`services/orderSheetSync.ts`: PATCH, same `_id`), so the card is NOT edited here - it is
   * re-read when the job lands (effect below). Only a sheet the server already holds can be annotated.
   */
  const handleAnnotateOrderSheet = async (file: any) => {
    const src = fileSrc(file);
    if (!leadId || !src) return;
    const serverId = file?.serverId ?? file?._id;
    if (!serverId) return;
    setAnnotatingKey(docIdentity(file));
    try {
      await openOrderSheetEditor({
        navigation,
        lead: { _id: leadId },
        leadId,
        doc: {
          serverId,
          uri: String(src),
          name: file?.name,
          size: file?.size ?? file?.fileData?.size,
          filePath: file?.filePath,
          bucketName: file?.bucketName,
          contentType: file?.contentType || file?.fileData?.contentType,
          annotation: file?.annotation,
        },
      });
    } finally {
      setAnnotatingKey(null);
    }
  };

  // REVUIUX-569 - "Reset all changes" on an annotated order-sheet tile: restores the pristine original FOR EVERYONE (the server keeps
  // it), asked with the app's own dialog. ⚠️ ConfirmDialog is its own native Modal: raised from a tile with nothing else presenting.
  const [resetTarget, setResetTarget] = useState<any | null>(null);
  const [resettingSheet, setResettingSheet] = useState(false);
  const confirmResetOrderSheet = async () => {
    const file = resetTarget;
    const serverId = file?.serverId ?? file?._id;
    if (!file || !leadId || !serverId || resettingSheet) return;
    setResettingSheet(true);
    try {
      const outcome = await requestOrderSheetReset({
        leadId,
        documentId: String(serverId),
        currentUri: String(fileSrc(file) || ''),
        knownSizes: typeof (file?.size ?? file?.fileData?.size) === 'number' ? [file?.size ?? file?.fileData?.size] : [],
        baseName: file?.name,
      });
      if (outcome === 'unavailable') {
        FlashMessage.warning('Cannot reset', 'The original of this order sheet is not available on this phone.');
      }
      const fresh = onRefreshDocs && outcome !== 'queued' ? await onRefreshDocs('orderSheet') : null;
      if (fresh) commitUploaded('orderSheet', fresh);
    } catch (e: any) {
      console.warn('[SummaryFinalizeCards] order sheet reset failed', e);
      FlashMessage.error('Order sheet not reset', serverErrorText(e, 'Check your connection and try again.'));
    } finally {
      setResettingSheet(false);
      setResetTarget(null);
    }
  };

  // The annotation job runs in the background (and survives offline): when one finishes, re-read the order sheets so the tile
  // shows the new picture - the replace keeps the document's `_id` but the file behind it is new.
  const syncingOrderSheetIds = usePendingOrderSheetJobs(leadId);
  const prevSyncingRef = useRef(syncingOrderSheetIds.size);
  useEffect(() => {
    const before = prevSyncingRef.current;
    prevSyncingRef.current = syncingOrderSheetIds.size;
    if (before > syncingOrderSheetIds.size && onRefreshDocs) {
      onRefreshDocs('orderSheet')
        .then((fresh) => {
          if (fresh) commitUploaded('orderSheet', fresh);
        })
        .catch((e) => console.warn('[SummaryFinalizeCards] could not re-read order sheets after an annotation', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncingOrderSheetIds]);

  const handleAgreementGenerated = async (file: any) => {
    if (file?.isSystemGenerated) {
      const localRef = {
        name: file.name,
        uri: file.uri,
        contentType: 'application/pdf',
        documentType: 'agreement' as const,
        isNew: false,
        isSystemGenerated: true,
      };
      const knownIds = new Set(agreementFiles.map(docIdentity).filter(Boolean));
      let serverDocs: any[] | null = null;
      try {
        serverDocs = onRefreshDocs ? await onRefreshDocs('agreement') : null;
      } catch (e) {
        console.warn('[SummaryFinalizeCards] could not re-read stored agreements', e);
      }
      const adopted = (serverDocs || []).some((d) => !knownIds.has(docIdentity(d)));
      commitUploaded(
        'agreement',
        adopted
          ? serverDocs!.map((d) => ({ ...d, isSystemGenerated: true }))
          : [...toFlatFiles(agreements), localRef]
      );
      if (user?._id && leadId) {
        logAgreementSigned(user._id, leadId, 'in_person').catch(() => {});
      }
      setAgreementDialogVisible(false);
      return;
    }
    const displayDocs = await uploadNewFiles('agreement', [file]);
    if (displayDocs) commitUploaded('agreement', displayDocs);
    setAgreementDialogVisible(false);
  };

  const handleRemoteAgreementComplete = async () => {
    if (!leadId) return;
    let resolvedAgreements: any[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await fetchLeadOutcomeDocumentRows(leadId);
        const resolved = await resolveOutcomeDocRows(rows);
        resolvedAgreements = resolved.agreements || [];
      } catch (e) {
        console.warn('[SummaryFinalizeCards] remote agreement read failed', e);
      }
      if (resolvedAgreements.length) break;
      if (attempt < 2) await new Promise<void>((resolve) => setTimeout(() => resolve(), 1200));
    }
    if (resolvedAgreements.length) {
      commitUploaded(
        'agreement',
        resolvedAgreements.map((d) => ({ ...d, isSystemGenerated: true }))
      );
    } else if (leadId) {
      queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
      queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
    }
  };

  const normalizeRemoteStatus = (raw: any): string | null => {
    const data = raw?.data?.data ?? raw?.data ?? raw;
    const ag =
      data && typeof data === 'object' && 'agreement' in data
        ? data.agreement
        : data?.agreementId
          ? data
          : null;
    return ag?.status ? String(ag.status).toLowerCase() : null;
  };

  const isRemotePending =
    agreementFiles.length === 0 &&
    (remoteStatus === 'pending' ||
      remoteStatus === 'sent' ||
      remoteStatus === 'viewed' ||
      remoteStatus === 'completed');

  useEffect(() => {
    if (!leadId || !isSale || agreementFiles.length > 0) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const tick = async () => {
      try {
        const res = await LeadService.getAgreementRemoteStatus(leadId);
        if (cancelled) return;
        const status = normalizeRemoteStatus(res);
        const prevStatus = lastRemoteStatusRef.current;
        lastRemoteStatusRef.current = status;
        setRemoteStatus(status);
        const active =
          status === 'pending' ||
          status === 'sent' ||
          status === 'viewed' ||
          status === 'completed';
        if (status === 'completed') {
          const wasActive =
            prevStatus === 'pending' || prevStatus === 'sent' || prevStatus === 'viewed';
          if (wasActive && user?._id && !remoteSignedLoggedRef.current) {
            remoteSignedLoggedRef.current = true;
            logAgreementSigned(user._id, leadId, 'remote').catch(() => {});
          }
          await handleRemoteAgreementComplete();
        }
        if (active) {
          if (!intervalId) intervalId = setInterval(tick, 12000);
        } else {
          stop(); // none / cancelled / expired / declined
        }
      } catch {
      }
    };
    tick();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, isSale, agreementFiles.length, remoteStatus]);

  const handleRemoteSent = () => setRemoteStatus('pending');

  const renderDocSection = (
    title: string,
    iconName: string,
    accent: string,
    files: any[],
    cat: DocCategory,
    isAgreement: boolean,
    required = false,
  ) => {
    const isEmpty = files.length === 0;
    const isUploading = uploadingCategory === cat;
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
            <TouchableOpacity
              onPress={() => {
                if (isUploading) return;
                logDocumentSheetOpened(cat, 'uploaded', 'edit_documents');
                setScannerCategory(cat);
              }}
              disabled={isUploading}
              hitSlop={10}
              style={isUploading ? { opacity: 0.4 } : undefined}
            >
              {/* Web swaps to a pencil once documents exist (mdi:pencil). */}
              <Icon name="pencil" size={20} color="white" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.sectionBody}>
          {isEmpty ? (
            isAgreement && isRemotePending ? (
              <View style={{ alignItems: 'center', paddingVertical: 24, borderStyle: 'dashed', borderColor: '#FDE68A', borderWidth: 2, borderRadius: 24, backgroundColor: '#FFFBEB' }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Icon name="clock-outline" size={32} color="#D97706" />
                </View>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#B45309', marginBottom: 6 }}>Pending Customer Signature</Text>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#92400E', textAlign: 'center', paddingHorizontal: 32, marginBottom: 20, lineHeight: 15 }}>
                  The agreement was sent for remote signing. It will appear here automatically once the customer signs.
                </Text>
                <View style={{ width: '100%', paddingHorizontal: 48 }}>
                  <TouchableOpacity onPress={() => setRemoteManageOpen(true)} style={styles.outlineActionBtn}>
                    <Icon name="send-outline" size={16} color="#059669" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#059669', fontWeight: '900', fontSize: 10 }}>Manage / Resend</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
            <View style={{ alignItems: 'center', paddingVertical: 24, borderStyle: 'dashed', borderColor: '#f1f5f9', borderRadius: 24, borderWidth: 2 }}>
              {/* Uploading: the spinner takes the CATEGORY ICON's place, so the card
                  reads as working rather than as empty. */}
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                {isUploading ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Icon name={iconName} size={32} color="#CBD5E1" />
                )}
              </View>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#94a3b8', marginBottom: 24 }}>
                {isUploading ? 'Uploading document\u2026' : 'No documents'}
              </Text>
              {/* Web `document-summary-cards.js` empty state: the agreements card
                  shows Generate AND Add Document side by side. Generate is merely
                  DISABLED until an appointment exists (web tooltip: "Schedule the
                  appointment first to generate the agreement") — Add Document is
                  always available. Mobile made the two mutually exclusive and
                  dropped Add Document from agreements entirely, so with no
                  appointment there was no way to attach one at all. */}
              {/* Actions are withheld mid-upload: re-opening the scanner over an
                  upload in flight would offer the same page again and file it twice. */}
              {!isUploading && (
              <View style={{ width: '100%', paddingHorizontal: 48, gap: 12 }}>
                {isAgreement && (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        if (!isAppointmentSet) return;
                        logDocumentSheetOpened(cat, 'generated', 'generate');
                        setAgreementDialogVisible(true);
                      }}
                      disabled={!isAppointmentSet}
                      style={[styles.outlineActionBtn, !isAppointmentSet && { opacity: 0.4 }]}
                    >
                      <Icon name="auto-fix" size={18} color="#22C55E" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#059669', fontWeight: '900', fontSize: 10 }}>Generate</Text>
                    </TouchableOpacity>
                    {!isAppointmentSet && (
                      <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#ef4444', textAlign: 'center' }}>
                        Schedule an appointment to enable agreements
                      </Text>
                    )}
                  </>
                )}
                <TouchableOpacity
                  onPress={() => {
                    logDocumentSheetOpened(cat, 'uploaded', 'add_document');
                    setScannerCategory(cat);
                  }}
                  style={styles.outlineActionBtn}
                >
                  <Icon name="plus" size={18} color="#0F172A" />
                  <Text style={{ color: '#0f172a', fontWeight: '900', fontSize: 10, marginLeft: 8 }}>Add Document</Text>
                </TouchableOpacity>
              </View>
              )}
            </View>
            )
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
                    {/* REVUIUX-569: annotate this order sheet (replaces it). Withheld mid-upload, like the other actions. */}
                    {cat === 'orderSheet' && !isUploading && showResetAction({ documentType: 'orderSheet', serverId: file?.serverId ?? file?._id, annotation: file?.annotation }) && (
                      <TouchableOpacity
                        onPress={() => setResetTarget(file)}
                        disabled={syncingOrderSheetIds.has(String(file?.serverId ?? file?._id ?? ''))}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityLabel="Reset all changes"
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: 'rgba(183, 110, 0, 0.92)',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: syncingOrderSheetIds.has(String(file?.serverId ?? file?._id ?? '')) ? 0.35 : 1,
                        }}
                      >
                        <Icon name="restore" size={14} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {/* The pencil shows on the job builder AND the My Deals edit flow, for any sheet the server already holds. */}
                    {cat === 'orderSheet' && !isUploading && !!src && canAnnotateOrderSheet({ documentType: 'orderSheet', serverId: file?.serverId ?? file?._id }) && (
                      <TouchableOpacity
                        onPress={() => handleAnnotateOrderSheet(file)}
                        disabled={annotatingKey !== null || syncingOrderSheetIds.has(String(file?.serverId ?? file?._id ?? ''))}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityLabel="Annotate order sheet"
                        style={{
                          position: 'absolute',
                          top: 6,
                          left: 6,
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: 'rgba(15, 23, 42, 0.78)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {annotatingKey === docIdentity(file) || syncingOrderSheetIds.has(String(file?.serverId ?? file?._id ?? '')) ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Icon name="pencil" size={14} color="#fff" />
                        )}
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
              {/* Adding to a card that ALREADY holds documents is just as silent —
                  the new page simply appears some seconds later. A placeholder tile
                  in the PDF tile's own shape stands in for it while it files. */}
              {isUploading && (
                <View style={{ width: 96, height: 128, borderRadius: 12, backgroundColor: '#f8fafc', marginRight: 12, borderWidth: 1, borderColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="small" color={accent} />
                  <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', marginTop: 8 }}>Uploading</Text>
                </View>
              )}
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
                  logSchedulerOpened();
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
                logSchedulerOpened();
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
        onBooked={handleAppointmentBooked}
        onGenerate={handleScheduleAndGenerate}
        onUpload={handleScheduleAndUpload}
        customerName={customerName}
        isEdit={isEditingAppt}
        leadId={leadId}
        isSale={!!isSale}
        initialDate={scheduleTime?.date}
        initialTimeWindow={scheduleTime?.timeWindow}
      />

      <ConfirmDialog
        visible={!!resetTarget}
        tone="warn"
        title="Reset all changes?"
        message="The original order sheet will be restored for everyone, including the installers."
        confirmLabel="Reset all changes"
        cancelLabel="Cancel"
        busy={resettingSheet}
        onConfirm={confirmResetOrderSheet}
        onCancel={() => setResetTarget(null)}
      />
      <DocumentScannerModal
        visible={scannerCategory !== null}
        onClose={() => setScannerCategory(null)}
        onSave={(images: any[]) => handleScannerSave(scannerCategory || 'orderSheet', images)}
        title={scannerCategory === 'agreement' ? 'Scan Agreement' : 'Scan Order Sheet'}
        leadId={leadId || ''}
        category={scannerCategory || 'orderSheet'}
        initialFiles={scannerCategory === 'agreement' ? agreementFiles : orderSheetFiles}
        allowRemoveExisting={scannerCategory === 'agreement' ? !editMode : true}
      />

      <DynamicAgreementDialog
        visible={agreementDialogVisible}
        onClose={() => setAgreementDialogVisible(false)}
        onAgreementGenerated={handleAgreementGenerated}
        onRemoteComplete={handleRemoteAgreementComplete}
        onRemoteSent={handleRemoteSent}
        leadId={leadId}
        jobId={leadId}
        productKey={productKey}
        jobState={jobState}
        verticalState={verticalState}
        customerDetails={{ name: customerName }}
        repDetails={repDetails}
        calculatorResultData={calculatorResultData}
      />

      {/* REMOTE-SIGNATURE TRACKING (Manage / Resend from the pending card). Opens the
          remote sheet standalone — it drives itself from `leadId` (reads the existing
          pending agreement), so this never regenerates the agreement or mints a new
          signing link; it only lets the rep resend / edit a contact / cancel. */}
      <AgreementRemoteSignModal
        visible={remoteManageOpen}
        onClose={() => setRemoteManageOpen(false)}
        leadId={leadId || ''}
        agreementId=""
        payload={{}}
        customerDetails={{ firstName: customerName }}
        onSent={() => setRemoteManageOpen(false)}
        onComplete={() => {
          setRemoteManageOpen(false);
          handleRemoteAgreementComplete();
        }}
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
