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
import { useAuth } from '../../../../hooks/useAuth';
import { convertJpegToPdf } from '../../../../utils/jpeg-to-pdf';
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
  // Persists the base64 doc payloads via the screen (which holds config +
  // dealCenterData to serialize field state and writes the web-shaped outcome).
  onUploadDocs?: (cat: DocCategory, payloads: any[]) => Promise<any[] | null>;
  /** Re-reads the lead's stored documents for a category (no upload). */
  onRefreshDocs?: (cat: DocCategory) => Promise<any[] | null>;
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
// Stable identity for reconciling a document across the scanner round-trip AND for
// de-duplicating the two display sources: a server doc keeps its serverId (or its
// immutable S3 filePath); a freshly-scanned one falls back to url/uri/name.
const docIdentity = (d: any): string =>
  String(d?.serverId ?? d?._id ?? d?.filePath ?? d?.id ?? d?.url ?? d?.uri ?? d?.name ?? '');
// The same document reaches us from two places once it is on the server: the draft
// copy on `jobState` (what web reads, and what survives a reopen) and the freshly
// signed copy from the outcome query. Keep the FIRST occurrence — callers pass the
// server-resolved list first, so the live signed URL wins over the draft's stale one.
const dedupeDocs = (files: any[]): any[] => {
  const seen = new Set<string>();
  return files.filter((f) => {
    const key = docIdentity(f);
    if (!key || seen.has(key)) return !key;
    seen.add(key);
    return true;
  });
};

// After signing, the SAME agreement can land in the list more than once with DIFFERENT
// identities — the local `file://` system-generated PDF (from an in-person sign) plus
// one or more server rows from the lead-scoped read (including a not-yet-resolved copy
// whose URL is still a bare S3 `filePath`, so it won't open). `dedupeDocs` can't merge
// them (uri vs serverId), so the card showed TWO agreements — one opening, one not.
//
// A system-generated (signed) agreement is UNIQUE per job, so collapse every
// `isSystemGenerated` agreement copy into ONE: display the copy that will actually open
// (a `file://` / `http` / `data:` src), but carry a durable `serverId`/`filePath` from
// any copy so it still dedupes across sources and a later delete/reopen can resolve it.
// Scanned / manually-added agreements (not system-generated) are left untouched.
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
  // The signed agreement can ALSO arrive UNFLAGGED — a copy read from the calculator-
  // scoped outcome query (which doesn't mark `isSystemGenerated`) whose S3 URL often
  // hasn't resolved, so it's a bare `filePath` that won't open. That's the "second
  // agreement, one can't be opened" from the REMOTE (web-signed) flow. Drop a
  // NON-system-generated agreement copy when a signed one exists AND it is either the
  // SAME document (shares serverId/filePath/name) or simply not openable (unresolved).
  // A genuinely-distinct, openable scanned agreement is kept.
  const mergedKeys = new Set(
    [merged.serverId, merged.filePath, merged.name].filter(Boolean).map(String)
  );
  const isDupOfSigned = (f: any) => {
    const keys = [f?.serverId, f?.filePath, f?.name].filter(Boolean).map(String);
    return keys.some((k) => mergedKeys.has(k)) || !isOpenableDoc(f);
  };
  // Preserve order: the FIRST system-generated slot becomes the merged entry; the rest
  // (and any unflagged duplicate/broken copy) are dropped.
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
  onRefreshDocs,
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
  // A remote signature in progress: the lowercase `remote-status` (pending / sent /
  // viewed / completed / …) or null when nothing is out for signature. Drives the
  // "Pending Customer Signature" card. `remoteManageOpen` reopens the tracking sheet
  // (resend / edit contact / cancel) without regenerating the agreement.
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [remoteManageOpen, setRemoteManageOpen] = useState(false);
  // For the "signed remotely" activity log: the last status the poll observed (to detect
  // the active→completed transition) + a once-guard so a reopened, already-signed
  // agreement isn't re-logged (the server audits completion; the client only logs the
  // transition it actually witnesses).
  const lastRemoteStatusRef = useRef<string | null>(null);
  const remoteSignedLoggedRef = useRef(false);
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

  // Display = server-resolved docs first (live signed URLs), then the draft copy
  // held on `jobState` (web's `existingAgreements={jobState?.agreements}`), deduped
  // so a document that exists in both — the normal case once it has uploaded — is
  // listed once.
  //
  // EXCEPT in EDIT mode, where merging the two doubled every document. The deal is
  // already submitted there, so the server read (`downloadOutcomeDocuments` —
  // lead-scoped, and the ONLY source that reflects deletions) is the complete
  // record. The draft copies on `jobState` are those SAME documents, but written by
  // the sign/scan flow WITHOUT a `serverId`/`filePath` — so `docIdentity` keys them
  // on their local `file://` uri while the server copy keys on `serverId`, the two
  // never collide, and `dedupeDocs` cannot merge them. (Name is NOT usable as a
  // fallback key: two genuinely different agreements both display as "Agreement",
  // so matching on it would HIDE a real document.)
  //
  // A document added during the edit session is safe: `commitUploaded` replaces
  // BOTH sources with the server read-back, so it is already in `resolvedDocuments`.
  // The `.length` guard keeps the draft as a fallback if that read ever comes back
  // empty, so an edit can never render zero documents when the draft has some.
  const mergeDocSources = useCallback(
    (server: any[] | undefined, draft: any[] | undefined) => {
      const serverFiles = server || [];
      if (editMode && serverFiles.length) return serverFiles;
      return dedupeDocs([...serverFiles, ...toFlatFiles(draft)]);
    },
    [editMode]
  );

  // NOTE: the backend's unnamed duplicate agreement row is dropped UPSTREAM, on the raw
  // server rows (`dropUnnamedAgreements` in `utils/outcome-documents.ts`). It cannot be
  // done here — every loader defaults the name to 'Agreement' before the rows reach this
  // component, so the empty name that identifies the duplicate is already gone.
  const agreementFiles = useMemo(
    () => collapseSignedAgreement(mergeDocSources(resolvedDocuments?.agreements, agreements)),
    [agreements, resolvedDocuments, mergeDocSources]
  );
  const orderSheetFiles = useMemo(
    () => mergeDocSources(resolvedDocuments?.orderSheets, orderSheets),
    [orderSheets, resolvedDocuments, mergeDocSources]
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
      // It resolves to the category's SERVER documents (serverId + filePath +
      // signed URL), or null when the upload itself failed.
      const serverDocs = onUploadDocs ? await onUploadDocs(cat, payloads) : null;
      if (!serverDocs) {
        Alert.alert('Upload failed', 'Could not save the document. Please try again.');
        return null;
      }
      // Prefer the server copies — they carry the serverId a later delete needs and
      // a URL that is valid on every device (and on web). Only if the read-back came
      // back empty do we fall back to the local thumbnails so the rep still sees the
      // document they just added.
      return serverDocs.length ? serverDocs : displayDocs;
    } catch (e) {
      console.warn('[SummaryFinalizeCards] upload failed', e);
      Alert.alert('Upload failed', 'Could not save the document. Please try again.');
      return null;
    } finally {
      if (isDocUploadingRef) isDocUploadingRef.current = false;
    }
  };

  // Record the uploaded documents ON THE JOB STATE — web parity, and the fix for
  // "the PDF is gone when I come back".
  //
  // Web holds its documents at `jobState.agreements` / `.orderSheets` in
  // `[{ files: [...] }]` groups (`dynamic-job-builder.js#handleAgreementDocumentsChange`)
  // and renders the summary from exactly that (`existingAgreements={jobState?.agreements}`).
  // The storage serializer passes both keys through, so the draft save persists them
  // and a reopen — on either platform — restores them. Mobile used to CLEAR the key
  // here and lean on the calculator-scoped outcome echoing `leadOutcomeDocuments`,
  // which it does not reliably do: the document had uploaded, but nothing that the
  // reopened screen (or web) reads knew about it.
  //
  // `files` are the server rows (serverId + filePath + signed URL) — durable and
  // cross-platform, and NOT base64, so the draft payload stays small.
  const commitUploaded = (cat: DocCategory, files: any[]) => {
    const key = rootKeyFor(cat);
    onUpdateRootState?.(key, files.length ? [{ files }] : []);
    setResolvedDocuments?.((prev) => {
      const base = prev || { agreements: [], orderSheets: [] };
      // The server read-back is the full list for this category, so replace rather
      // than append — appending duplicated every previously-listed document.
      return { ...base, [key]: files };
    });
    // Refresh the outcome + document queries so a re-open isn't served stale cache.
    if (leadId) {
      queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
      queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
    }
  };

  const handleScannerSave = async (cat: DocCategory, images: any[]) => {
    const key = cat === 'agreement' ? 'agreements' : 'orderSheets';
    // Reflect REMOVALS immediately, in BOTH display sources. The scanner already
    // fired the DELETE for any doc the rep crossed out, but only the resolved list
    // was pruned — the copy on the job state was left alone, so a delete-only Update
    // left the removed page on screen until a reopen. Keep just the documents still
    // present in the set the scanner returned (matched by identity).
    const surviving = new Set((images || []).map(docIdentity).filter(Boolean));
    const keep = (d: any) => surviving.has(docIdentity(d));
    setResolvedDocuments?.((prev) => {
      const base = prev || { agreements: [], orderSheets: [] };
      return { ...base, [key]: (base[key] || []).filter(keep) };
    });
    const remainingDraft = toFlatFiles(cat === 'agreement' ? agreements : orderSheets).filter(keep);
    onUpdateRootState?.(key, remainingDraft.length ? [{ files: remainingDraft }] : []);

    const newFiles = (images || []).filter((f) => f?.isNew !== false);
    if (!newFiles.length) {
      // Delete-only Update: no upload to piggyback the refresh on, so drop the cached
      // document lists here — the next read reflects the rows the scanner deleted.
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
        queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
      }
      setScannerCategory(null);
      return;
    }
    const displayDocs = await uploadNewFiles(cat, newFiles);
    if (displayDocs) {
      commitUploaded(cat, displayDocs);
      // Audit log: a scanned/presigned agreement was uploaded (web parity — the
      // generated path is logged in DynamicAgreementDialog as agreement_generated).
      if (cat === 'agreement' && user?._id) {
        // `module_type: 'job_builder'` so the portal's Forever Record renders it (it
        // only routes agreement rows from job_builder logs — matches the regular JB's
        // `logAgreementUploaded`).
        logEvent('add', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'job_builder',
          meta: {
            draft: true,
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
    // A GENERATED agreement is rendered AND FILED by the server.
    //
    // Mobile generates through `pdf-reports/v1/agreement/{leadId}/preview` + `/sign`
    // (web can't share this path — it rasterises the agreement in the browser with
    // html2canvas and has no sign call at all, see `dynamic-agreement-generator.js`).
    // That sign endpoint stores its OWN LeadOutcomeDocument, named server-side from
    // the real job number. Uploading the returned PDF on top of it filed a SECOND row
    // for the same agreement — the two differently-named cards ("Agreement_STN-…" from
    // the server, "Agreement_SPN/A_…" from `handleSigned`'s own template).
    //
    // So a system-generated agreement is NEVER UPLOADED — that is the only way to
    // guarantee one row. An earlier version tried to confirm the server's row first
    // and uploaded when it could not see one, but the confirmation reads the
    // CALCULATOR-scoped outcome, which does not echo `leadOutcomeDocuments`: the check
    // always came back empty, so it always uploaded and the duplicate returned.
    //
    // We still try to adopt the server's row (one cheap read) purely to get its
    // serverId/filePath, which is what makes the draft copy durable off-device and
    // lets a later delete reach the server. When that read shows nothing we record the
    // local `file://` reference instead — the document is stored either way, and
    // `buildDocumentPayloads` knows not to re-send a system-generated one at submit.
    if (file?.isSystemGenerated) {
      const localRef = {
        name: file.name,
        uri: file.uri,
        contentType: 'application/pdf',
        documentType: 'agreement' as const,
        isNew: false,
        // Marks this as already filed by the sign endpoint — never upload, never
        // re-send. Read by `utils/document-payloads.ts`.
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
      // Portal Forever Record "Signed" row — a system-generated agreement is one the
      // rep signed in-person (the `/sign` endpoint filed it).
      if (user?._id && leadId) {
        logAgreementSigned(user._id, leadId, 'in_person').catch(() => {});
      }
      setAgreementDialogVisible(false);
      return;
    }
    // Scanned / manually added agreements have no server-side filing step, so they
    // need an explicit upload. `uploadNewFiles` reads the on-disk `file://` PDF to
    // base64 TRANSIENTLY (never into React state — that was the OOM crash) and PUTs it
    // via `handleUploadDocs`.
    const displayDocs = await uploadNewFiles('agreement', [file]);
    if (displayDocs) commitUploaded('agreement', displayDocs);
    setAgreementDialogVisible(false);
  };

  // A REMOTELY-signed agreement is filed by the server the moment every signer signs
  // (REVDSM-263) — there is NO local `file://` copy to hand back, so the in-person
  // `handleSigned`/`handleAgreementGenerated` path can't be reused (it would commit an
  // empty local reference). Instead we READ the stored agreement from the outcome and
  // commit it like any server-filed document.
  //
  // The read MUST be LEAD-scoped (`fetchLeadOutcomeDocumentRows` → `getLeadOutcome`):
  // agreements live on `leadOutcomeDocuments`, which the calculator-scoped outcome
  // (`onRefreshDocs`) does not echo. Routing the resolved server rows through
  // `commitUploaded` mirrors the in-person adopt path exactly — it writes BOTH the
  // display list and the durable `jobState.agreements` copy (so a calc-scoped refetch
  // can't wipe it) and marks the rows already-filed so finalize never double-sends.
  //
  // A short retry covers the race where "Done" is tapped in the instant between the
  // final signature and the server finishing the PDF filing.
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
      // `isSystemGenerated` marks these as already-filed (parity with the in-person
      // adopt branch) so the legacy no-system-generated payload path skips them.
      commitUploaded(
        'agreement',
        resolvedAgreements.map((d) => ({ ...d, isSystemGenerated: true }))
      );
    } else if (leadId) {
      // Nothing readable yet — at least drop the caches so a reopen picks it up.
      queryClient.invalidateQueries({ queryKey: ['leadOutcome', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leadOutcomeDocs', leadId] });
      queryClient.invalidateQueries({ queryKey: ['editOutcomeDocs', leadId] });
    }
  };

  // ── Remote signature tracking ────────────────────────────────────────────────
  // The remote flow is mobile-only (REVDSM-263): the rep sends the agreement, the
  // homeowner e-signs on their own device, and the server files the signed PDF when
  // every signer is done. So there is a window where the agreement is OUT for
  // signature with no document filed yet — we surface it as "Pending Customer
  // Signature" and poll the signed PDF in once it exists.

  // `remote-status` → the lowercase agreement status (or null when nothing is out).
  // Mirrors AgreementRemoteSignModal.normalizeAgreement.
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

  // An agreement is out for remote signature but not yet filed. `completed` is kept
  // "active" for the brief window between the last signature and the server filing
  // the PDF (the poll swaps in the document the moment it lands).
  const isRemotePending =
    agreementFiles.length === 0 &&
    (remoteStatus === 'pending' ||
      remoteStatus === 'sent' ||
      remoteStatus === 'viewed' ||
      remoteStatus === 'completed');

  // Probe `remote-status` on open, then poll while pending. Only runs for a SALE with
  // no filed agreement — once a document exists (`agreementFiles.length > 0`) there is
  // nothing to track and this early-returns, which also stops any running poll.
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
          // Portal timeline: log the completion ONCE, and only when we WITNESS the
          // transition from an active (pending/sent/viewed) state this session — not on
          // reopen of an already-signed agreement (that would mis-timestamp and duplicate;
          // the backend audits the actual completion time).
          const wasActive =
            prevStatus === 'pending' || prevStatus === 'sent' || prevStatus === 'viewed';
          if (wasActive && user?._id && !remoteSignedLoggedRef.current) {
            remoteSignedLoggedRef.current = true;
            // `agreement_signed` on `module_type: 'job_builder'` — the action the portal's
            // Forever Record renders as the "Signed" row (signMethod: 'remote' keeps the
            // web-link distinction in meta).
            logAgreementSigned(user._id, leadId, 'remote').catch(() => {});
          }
          // Signed PDF is filed server-side — read it into the card. Once it commits,
          // agreementFiles becomes non-empty and this effect re-runs → early return.
          await handleRemoteAgreementComplete();
        }
        if (active) {
          if (!intervalId) intervalId = setInterval(tick, 12000);
        } else {
          stop(); // none / cancelled / expired / declined
        }
      } catch {
        // Network / not-found → treat as no active remote agreement.
      }
    };
    tick();
    return () => {
      cancelled = true;
      stop();
    };
    // `remoteStatus` is a dep so the poll RESTARTS when it becomes active — e.g. the
    // rep sends the agreement (handleRemoteSent → 'pending') after the initial probe
    // already found nothing and stopped. A no-op tick sets the same value → no
    // re-render → no churn; only a real status change re-runs the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, isSale, agreementFiles.length, remoteStatus]);

  // The rep just sent the agreement for remote signature (the whole stack closed back
  // to this summary). Reflect the pending state immediately; the poll keeps it in sync
  // and swaps in the signed PDF once the customer signs.
  const handleRemoteSent = () => setRemoteStatus('pending');

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
            isAgreement && isRemotePending ? (
              // Agreement is out for REMOTE signature — hide Generate / Add Document
              // and show the pending status. The signed PDF appears here on its own
              // once the customer signs (the poll reads it in). "Manage / Resend"
              // reopens the tracking sheet without regenerating the agreement.
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
        // ORDER SHEETS ARE NEVER RESTRICTED — written as an explicit branch on the
        // category (rather than folding both cases into one boolean) so that editing
        // the agreement rule here cannot silently take the ✕ off order sheets too.
        //
        // Agreements: hidden in the CREATE flow only. While the job is being built the
        // agreement on file is the freshly signed/generated one and the scan sheet is
        // for ADDING pages, not destroying it. Pages scanned in THIS session keep their
        // ✕ regardless (`item.isNew` in DocumentScannerModal), so a misscan is never
        // stuck. The MY DEALS edit flow (`editMode`) keeps delete: the rep is revising a
        // submitted deal and must be able to swap out a wrong agreement.
        allowRemoveExisting={scannerCategory === 'agreement' ? editMode : true}
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
          // Customer signed while the rep had the tracking sheet open — read the filed
          // PDF straight into the card.
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
