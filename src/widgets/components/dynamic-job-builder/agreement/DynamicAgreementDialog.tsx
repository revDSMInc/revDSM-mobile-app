import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AgreementSignatureModal } from '../../../modals/job-builder/AgreementSignatureModal';
import { DynamicAgreementGenerator } from './DynamicAgreementGenerator';
import { AgreementRemoteSignModal } from '../../../modals/job-builder/AgreementRemoteSignModal';
import { useGetAgreementConfig } from '../../../../screens/DynamicDealCenter/hooks/useAgreementConfig';
import { isOnline } from '../../../../services/connectivity';
import { isClientId } from '../../../../utils/offline-lead-work';
// ⚠️ The local `new Date(raw)` this replaced printed TBD on every scheduled job — Hermes cannot
// parse the `M/d/yyyy` the scheduler writes. See `utils/install-date.ts`.
import { formatInstallDate } from '../../../../utils/install-date';
import { LeadService } from '../../../../services/api/leads';
import { AgreementDeliveryPrompt } from '../../../modals/job-builder/AgreementDeliveryPrompt';
import { useGetDescriptionSchema } from '../../../../screens/DynamicDealCenter/hooks/useDescriptionSchema';
import { evaluateDescriptionSchema } from '../../../../utils/dynamic-job-builder/agreement/description-schema-evaluator';
import { generateGutterRooflineDescriptions } from '../../../../utils/dynamic-job-builder/agreement/gutter-roofline-description-generator';
import { generateRoofingDescriptions } from '../../../../utils/dynamic-job-builder/agreement/roofing-description-generator';
import { logEvent } from '../../../../services/api/LoggerService';
import { useAuth } from '../../../../hooks/useAuth';
import { useLeadQuery } from '../../../../hooks/useLeadQuery';
import { formatCurrency } from '../../../../utils/currency';

interface DynamicAgreementDialogProps {
  visible: boolean;
  onClose: () => void;
  onAgreementGenerated: (file: any) => void;
  /** Fired after a REMOTE signing session completes so the caller can read the
   *  server-filed (lead-scoped) signed agreement back into the summary. The dialog
   *  still closes via `onClose`; this only refreshes the document list. */
  onRemoteComplete?: () => void;
  /** Fired when the rep SENDS the agreement for remote signature (still pending). The
   *  dialog closes and the caller marks the summary "Pending Customer Signature". */
  onRemoteSent?: (agreementId?: string) => void;
  leadId?: string;
  jobId?: string;
  productKey?: string;
  jobState?: any;
  verticalState?: any;
  customerDetails?: any;
  repDetails?: any;
  calculatorResultData?: any;
  jobScope?: string[];
}

// Office short-code + job-number resolution — mirrors the normal Job Builder's
// getJobBuilderHeaderNumber (src/screens/JobBuilder/index.tsx) so the dynamic
// agreement shows the SAME job-number format: short office code + last 5 chars.
function shortenOfficeName(name: any): string {
  if (!name || typeof name !== 'string') return '';
  const words = name.trim().split(' ');
  if (words.length === 1) {
    return name.length <= 3 ? name.toUpperCase() : name.slice(0, 3).toUpperCase();
  }
  return words
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function resolveOfficeName(repDetails: any, user: any): string {
  const officeDetails = repDetails?.office?.[0];
  let officeName = typeof officeDetails === 'string' ? officeDetails : officeDetails?.name;
  if (!officeName) officeName = repDetails?.officeName;
  if (!officeName && user?.office) {
    const uo = Array.isArray(user.office) ? user.office[0] : user.office;
    officeName = typeof uo === 'object' ? uo?.name || uo?.officeName : uo;
  }
  return officeName || '';
}

// Format a raw id into the display id: last 5 chars uppercased for long (mongo)
// ids, otherwise the id verbatim — matches the normal JB.
function toDisplayId(rawId: any): string {
  const str = String(rawId ?? '').trim() || 'N/A';
  if (str.length > 8) return str.slice(-5).toUpperCase();
  return str;
}


// Grouped thousands so the agreement reads the same as the Contract Details card it
// is generated from — was `$${v}`, which printed a contract price as "$22411".
// `formatCurrency` is engine-independent (no Intl dependency); see utils/currency.
const money = (v: any) => formatCurrency(v, { fallback: '$0.00' });

/**
 * Agreement generation for the dynamic Job Builder.
 *
 * The PDF is rendered SERVER-SIDE — identical to the normal Job Builder
 * (`SummarySection.handleGenerateAgreement`): this dialog assembles the same
 * `{ customer, job, payment, jobScope, contractorName }` payload, POSTs it to
 * `pdf-reports/v1/agreement/{leadId}/preview`, and hands the returned
 * `previewBase64` + `signatureFields` + `pdfDimensions` to AgreementSignatureModal.
 * Signing POSTs to `pdf-reports/v1/agreement/{leadId}/sign`, which returns the
 * flattened signed PDF; that PDF is emitted through `onAgreementGenerated` as a
 * `data:application/pdf;base64,...` file so the caller uploads it verbatim (no
 * client-side JPEG→PDF wrapping).
 *
 * Replaces the previous on-device `react-native-view-shot` capture
 * (DynamicAgreementGenerator), which produced a JPEG wrapped in a hand-built PDF.
 */
export function DynamicAgreementDialog({
  visible,
  onClose,
  onAgreementGenerated,
  onRemoteComplete,
  onRemoteSent,
  leadId,
  jobId,
  productKey,
  jobState,
  verticalState = {},
  customerDetails = {},
  repDetails = {},
  calculatorResultData = {},
  jobScope: jobScopeProp,
}: DynamicAgreementDialogProps) {
  const { schema: descriptionSchema, schemaLoading: descSchemaLoading } = useGetDescriptionSchema(
    visible ? productKey : undefined
  );

  // Logged-in rep (for logging + contractorName fallback) and the lead record
  // (customer details + human-readable leadId + assigned-rep office) — the mobile
  // analog of web's AuthContext + useLead() context. Only fetch while visible.
  const { user } = useAuth();
  const { data: leadData, isLoading: leadLoading } = useLeadQuery(visible ? leadId || '' : '');

  // ⚠️ Read HERE, outside the `Modal`, and painted as an explicit spacer below — a
  // `SafeAreaView` rendered INSIDE a react-native `Modal` is a separate native view hierarchy
  // that the app-root SafeAreaProvider does not reach, so its insets come back as ZERO and the
  // header lands under the status bar with its title struck through by the clock. That is what
  // QA hit, and it took the close button with it: the only way out of a full-screen dialog was
  // half-hidden behind the system bar. `AgreementSignatureModal` already does exactly this, and
  // it is why THAT screen never had the problem.
  const insets = useSafeAreaInsets();

  // ── Rendering the agreement at a door with no signal ────────────────────────
  //
  // Online the SERVER renders the PDF (`/preview`) and the customer signs on top of it. That is
  // one request the rep cannot make at a door, and it is the whole reason the agreement blocked
  // offline mode. So offline the DEVICE renders the same document, from the company's own
  // agreement config — the layout, header and terms the server template is built from, cached
  // while there was still signal.
  //
  // ⚠️ Decided by the CONNECTION, not by the lead: a lead created offline carries an id this
  // device minted, so `POST pdf-reports/v1/agreement/lead-1773…/preview` is a request that cannot
  // succeed however good the signal is.
  const renderLocally = !isOnline() || isClientId(leadId);
  const { agreementConfig, agreementConfigLoading } = useGetAgreementConfig(visible);
  const [remoteOpen, setRemoteOpen] = useState(false);
  // REVUIUX-391: how the homeowner wants the signed copy is asked BEFORE the server renders the
  // agreement, and the preview request below waits for the answer to be saved on the lead.
  // Offline there is nothing to save to, so the device-rendered path skips it.
  const [deliveryReady, setDeliveryReady] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreementData, setAgreementData] = useState<any>(null);
  // Controls the AgreementSignatureModal (level 2) SEPARATELY from this dialog
  // (level 1) so the two never collapse in the same frame — see `handleSignClose`.
  const [signVisible, setSignVisible] = useState(true);
  // Guards the one-shot preview request per open (effects can re-run as the lead
  // query settles; a second POST would mint a second agreement record).
  const requestedRef = useRef(false);

  // Prefer the explicit repDetails prop; fall back to the lead's assigned rep.
  const resolvedRepDetails = useMemo(
    () =>
      repDetails && Object.keys(repDetails).length
        ? repDetails
        : leadData?.assignedRepDetails || {},
    [repDetails, leadData]
  );

  // Customer details: merge the lead record over the (sparse) prop, matching web.
  const resolvedCustomerDetails = useMemo(() => {
    const c = leadData?.customerDetails || {};
    const fullName = c.firstName ? `${c.firstName} ${c.lastName || ''}`.trim() : '';
    return {
      name: fullName || customerDetails.name || 'Valued Customer',
      address: c.address || leadData?.fullAddress || customerDetails.address || '',
      phone:
        c.phone ||
        c.phoneNumber ||
        c.mobile ||
        customerDetails.phone ||
        customerDetails.phoneNumber ||
        customerDetails.mobile ||
        '',
      email: c.email || customerDetails.email || '',
    };
  }, [leadData, customerDetails]);

  const jobDetails = useMemo(() => {
    // Multi-source fallback chain (web parity): human leadId first, then the
    // various job/lead ids, then N/A. Kept as the raw value for the filename.
    const rawId =
      leadData?.leadId ||
      jobState?.leadId ||
      calculatorResultData?.leadId ||
      jobId ||
      leadId ||
      'N/A';
    const officeCode = shortenOfficeName(resolveOfficeName(resolvedRepDetails, user)) || 'N/A';
    const displayId = toDisplayId(rawId);
    return {
      jobNumber: String(rawId),
      officeCode,
      jobDisplay: `${officeCode}${displayId}`,
    };
  }, [leadData, jobState, calculatorResultData, jobId, leadId, resolvedRepDetails, user]);

  const paymentDetails = useMemo(() => {
    const cr = calculatorResultData || {};
    const js = jobState || {};
    const method = cr.paymentMethod || js.paymentMethod || '';
    // First non-empty wins. These 7 financing fields mirror web (dynamic-agreement-
    // dialog.js lines 119-130), sourced from the mobile result/job-state data model.
    const pick = (...vals: any[]) => vals.find((v) => v != null && v !== '') || '';
    return {
      price: money(cr.contractPrice ?? cr.originalContractPrice),
      downPayment: money(cr.downPayment),
      downPaymentMethod: method || 'N/A',
      balance: money(cr.balance),
      balanceMethod: method === 'Cash' ? 'Cash' : 'Financed',
      installDate: formatInstallDate(jobState?.scheduleTime?.date),
      installWindow: jobState?.scheduleTime?.timeWindow || '',
      authNumber: pick(cr.wfAuthNumber, cr.authNumber, js.wfAuthNumber),
      planNumber: pick(cr.planNumber, js.planNumber),
      greenskyAppId: pick(cr.greenskyAppId, cr.applicationId, js.greenskyAppId),
      greenskyShoppingPass: pick(cr.greenskyShoppingPass, cr.shoppingPass, js.greenskyShoppingPass),
      safeIdRecordNumber: pick(cr.safeIdRecordNumber, js.safeIdRecordNumber),
      ccLast4: pick(cr.ccLast4, js.ccLast4),
      financingNote:
        pick(cr.financingNote, js.financingNote) ||
        (method && method !== 'Cash' ? `${method} Financing` : ''),
    };
  }, [calculatorResultData, jobState]);

  const contractorName =
    resolvedRepDetails.name ||
    `${resolvedRepDetails.firstName || ''} ${resolvedRepDetails.lastName || ''}`.trim() ||
    user?.displayName ||
    `${user?.firstName || ''} ${user?.lastName || ''}`.trim() ||
    'LeafFilter Rep';

  // jobScope priority: explicit prop → schema evaluator → legacy generators.
  const computedJobScope = useMemo(() => {
    if (jobScopeProp && jobScopeProp.length > 0) return jobScopeProp;

    const hasVerticalState = verticalState && Object.keys(verticalState).length > 0;
    if (descriptionSchema && hasVerticalState) {
      const lines = evaluateDescriptionSchema(descriptionSchema, jobState, verticalState);
      if (lines && lines.length) return lines;
    }
    if (hasVerticalState) {
      const GUTTER_ROOFLINE_ID = '';
      const ROOFING_ID = '';
      if (productKey === ROOFING_ID) return generateRoofingDescriptions(verticalState);
      if (productKey === GUTTER_ROOFLINE_ID) return generateGutterRooflineDescriptions(verticalState);
    }
    return [];
  }, [jobScopeProp, productKey, verticalState, descriptionSchema, jobState]);

  // Payload shape is byte-for-byte the normal JB's (SummarySection.tsx:1246-1270)
  // so the server template renders identically for dynamic and legacy jobs.
  const buildPayload = useCallback(
    () => ({
      customer: {
        name: resolvedCustomerDetails.name,
        address: resolvedCustomerDetails.address || 'N/A',
        phone: resolvedCustomerDetails.phone || 'N/A',
        email: resolvedCustomerDetails.email || 'N/A',
      },
      job: {
        jobNumber: jobDetails.jobNumber,
        jobDisplay: jobDetails.jobDisplay,
      },
      payment: {
        price: paymentDetails.price,
        downPayment: paymentDetails.downPayment,
        downPaymentMethod: paymentDetails.downPaymentMethod,
        balance: paymentDetails.balance,
        balanceMethod: paymentDetails.balanceMethod,
        installDate: paymentDetails.installDate,
        installWindow: paymentDetails.installWindow,
      },
      jobScope:
        computedJobScope.length > 0
          ? computedJobScope
          : ['Project completion per summary details'],
      contractorName,
    }),
    [resolvedCustomerDetails, jobDetails, paymentDetails, computedJobScope, contractorName]
  );

  const generatePreview = useCallback(async () => {
    if (!leadId) {
      setError('Missing lead — cannot generate an agreement.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const payload = buildPayload();
      const response = await LeadService.previewAgreement(leadId, payload);
      const data = response.data?.data || response.data;

      if (!data?.agreementId || !data?.previewBase64) {
        throw new Error('Missing agreement data from response');
      }

      setAgreementData({ ...data, payload });
      // Audit log (parity with the previous local generator + the normal JB's
      // logAgreementGenerated): the agreement document now exists server-side.
      if (user?._id) {
        // `module_type: 'job_builder'` (NOT 'agreement') — the portal's Forever Record
        // renders agreement rows ONLY from job_builder logs (log-item.js routes
        // `moduleType === 'job_builder'` + action includes 'agreement' → AgreementLog;
        // the milestone "Generated" row matches action `agreement_generated`). This is
        // exactly what the regular Job Builder logs (`logAgreementGenerated`), so the
        // dynamic flow's agreement now shows in the docs/forever record like it used to.
        logEvent('add', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'job_builder',
          meta: {
            draft: true,
            leadId,
            fieldName: 'agreement',
            fieldLabel: 'Agreement',
            action: 'agreement_generated',
          },
        });
      }
    } catch (e) {
      console.warn('[DynamicAgreementDialog] preview failed', e);
      setError('Failed to generate agreement. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [leadId, buildPayload, user]);

  // Fire the preview once per open, after the lead + description schema have
  // settled (both feed the payload — requesting earlier would send a "Valued
  // Customer" placeholder and an empty job scope).
  useEffect(() => {
    if (!visible) {
      requestedRef.current = false;
      setAgreementData(null);
      setError(null);
      setIsGenerating(false);
      // Re-arm the signature modal for the next open.
      setSignVisible(true);
      // Ask again on the next open — the rep may have corrected the contact since.
      setDeliveryReady(false);
      return;
    }
    if (requestedRef.current) return;
    // ⚠️ Never request the server preview offline. It is not merely doomed — the dialog would sit
    // on "Generating agreement…" for the length of an axios timeout before showing an error, with
    // the customer waiting, when the device could have rendered the document immediately.
    if (renderLocally) return;
    if (!deliveryReady) return;
    if (leadLoading || descSchemaLoading) return;
    requestedRef.current = true;
    generatePreview();
  }, [visible, leadLoading, descSchemaLoading, generatePreview, renderLocally, deliveryReady]);

  const handleRetry = () => {
    requestedRef.current = true;
    generatePreview();
  };

  // Staged teardown — the fix for the BLANK BLACK SCREEN on remote-sign "Done".
  //
  // The dynamic flow stacks THREE native modals: this dialog (level 1) →
  // AgreementSignatureModal (level 2) → AgreementRemoteSignModal (level 3). The remote
  // sheet already dismisses itself first; but then level 2 and level 1 were torn down
  // in the SAME frame (AgreementSignatureModal.onClose === this dialog's onClose, and
  // level 2 is level 1's child). Collapsing two native modals at once orphans a
  // backdrop and leaves a blank black screen. So dismiss level 2 first (slide it out),
  // then close level 1 a frame later. Used for EVERY close of the signature modal
  // (in-person cancel / submit AND remote-complete), so the teardown is always safe.
  const handleSignClose = useCallback(() => {
    setSignVisible(false);
    setTimeout(() => onClose(), 350);
  }, [onClose]);

  // The signed PDF comes back from `.../sign` as a file on disk. The sign endpoint
  // has ALREADY persisted it as a LeadOutcomeDocument server-side (identical to the
  // normal Job Builder, whose onSuccess merely refetches the outcome). So we emit
  // ONLY a lightweight reference — the on-disk `file://` path — and NOT the PDF's
  // base64 body. Reading the whole (multi-MB) PDF into base64 here, holding it in
  // React state, and re-uploading it (the old behaviour) both (a) filed a SECOND
  // outcome-document row for the same agreement and (b) spiked the JS heap enough to
  // crash the app on submit. `isSystemGenerated` tells the caller this doc is already
  // stored and must not be re-uploaded.
  /**
   * The device-rendered agreement, signed at the door.
   *
   * ⚠️ It is emitted WITHOUT `isSystemGenerated`, and that single flag is the whole difference
   * from the online path. `isSystemGenerated` means "the sign endpoint already filed this, never
   * upload it" — true online, and false here in the way that matters most: nothing has filed this
   * document, and marking it filed would leave the signed contract on the device forever, with the
   * summary card showing it as though the office had it.
   *
   * Unmarked, it takes the same route a SCANNED agreement takes — which is already offline-aware,
   * so the queueing needed no new path of its own.
   */
  const handleLocallySigned = (file: any) => {
    onAgreementGenerated({
      ...file,
      documentType: 'agreement' as const,
      type: 'agreement' as const,
      isNew: true,
      isSystemGenerated: false,
    });
  };

  const handleSigned = (signedPdfPath: string) => {
    const cleanPath = signedPdfPath.replace('file://', '');
    onAgreementGenerated({
      name: `Agreement_${jobDetails.jobDisplay || 'NA'}_${Date.now()}.pdf`,
      uri: `file://${cleanPath}`,
      contentType: 'application/pdf',
      documentType: 'agreement' as const,
      type: 'agreement' as const,
      isNew: true,
      isSystemGenerated: true,
    });
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Generate Agreement</Text>
      <View style={styles.headerActions}>
        {/* ⚠️ Offline the rep never reaches AgreementSignatureModal — the device-rendered
            generator IS the signing screen — so Send Remotely has to live here or the option
            simply disappears when there is no signal. That is exactly the door where a rep is
            most likely to want it: the customer can sign later, on their own phone, once the
            request goes out. */}
        {renderLocally && !!leadId && (
          <>
          <TouchableOpacity onPress={() => setRemoteOpen(true)} style={styles.remoteBtn}>
            <Icon name="send-outline" size={16} color="#118D57" />
            <Text style={styles.remoteBtnText}>SEND REMOTELY</Text>
          </TouchableOpacity>
               <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Icon name="close" size={20} color="#1C252E" />
        </TouchableOpacity>
          </>
        )}
   
       
      </View>
    </View>
  );

  // While the server renders the PDF this dialog shows the loading/error shell;
  // once `agreementData` arrives the signature modal takes over the screen.
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      {/* ⚠️ A `Modal` is its own native view tree, so the app-root GestureHandlerRootView does not
          reach it. Without this one, Android never delivers the offline agreement's pinch / pan
          (`DynamicAgreementGenerator`) — iOS happened to work, which hid it. */}
      <GestureHandlerRootView style={styles.page}>
        <View style={[styles.statusBarPad, { height: insets.top }]} />
        
        
        {renderHeader()}

        {/* ── Offline: the device renders the agreement and the customer signs on it ──
            The generator hosts its own signature and initials pads, so this IS the signing
            screen — there is no second modal, which also means no stacked-modal teardown to
            stage. `onSave` fires only once both marks are drawn (the generator's own gate). */}
        {renderLocally ? (
          agreementConfig ? (
            <DynamicAgreementGenerator
              agreementConfig={agreementConfig}
              customerDetails={resolvedCustomerDetails}
              jobDetails={jobDetails}
              paymentDetails={paymentDetails}
              jobScope={
                computedJobScope.length > 0
                  ? computedJobScope
                  : ['Project completion per summary details']
              }
              contractorName={contractorName}
              leadId={leadId}
              user={user}
              onSave={handleLocallySigned}
            />
          ) : (
            <View style={styles.center}>
              {agreementConfigLoading ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.muted}>Preparing agreement...</Text>
                </>
              ) : (
                // ⚠️ The one offline failure that cannot be worked around here. The config is
                // company setup, and with no copy on the device there is no document to render —
                // so say which thing is missing rather than "failed to generate".
                <Text style={styles.errorText}>
                  This agreement's layout hasn't been downloaded yet. Open a lead once while
                  you're online, then try again.
                </Text>
              )}
            </View>
          )
        ) : (
        <View style={styles.center}>
          {/* Only the loading/error shell — hidden once the signature modal exists
              (it covers this screen), so the brief reveal during the staged teardown
              is a clean light background, not a stray "Preparing agreement…" spinner. */}
          {agreementData ? null : error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={handleRetry} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator />
              <Text style={styles.muted}>
                {isGenerating ? 'Generating agreement...' : 'Preparing agreement...'}
              </Text>
            </>
          )}
        </View>
        )}

        {/* The offline twin of the sheet AgreementSignatureModal opens. Only ONE modal is stacked
            on this dialog offline (there is no signature modal in between), so no staged teardown
            is needed here — the sheet closes itself, then this dialog closes. */}
        {renderLocally && (
          <AgreementRemoteSignModal
            visible={remoteOpen}
            onClose={() => setRemoteOpen(false)}
            leadId={leadId || ''}
            customerDetails={leadData?.customerDetails}
            onSent={(id) => {
              setRemoteOpen(false);
              setTimeout(() => {
                onRemoteSent?.(id);
                onClose();
              }, 350);
            }}
            onComplete={() => {
              setRemoteOpen(false);
              setTimeout(() => {
                onRemoteComplete?.();
                onClose();
              }, 350);
            }}
          />
        )}

        {!!agreementData && (
          <AgreementSignatureModal
            // `signVisible` (not a bare `visible`) so `handleSignClose` can slide this
            // level-2 modal out a frame BEFORE this dialog (level 1) closes — the
            // blank-black-screen fix. `onClose` routes through the staged teardown.
            visible={signVisible}
            // ⚠️ `fade`, NOT the default `slide`. This modal is a CHILD of the dialog's own
            // full-screen modal, which is already on screen showing "Generating agreement…".
            // Sliding it up too meant one 'Generate' tap played two full-screen open
            // animations, which reads as the app opening two separate screens. Fading it in
            // swaps the document in over the spinner, so the pair reads as the single screen
            // it logically is. The loading shell already renders `null` once `agreementData`
            // exists, so nothing shows through the cross-fade.
            animationType="fade"
            onClose={handleSignClose}
            leadId={leadId || ''}
            agreementId={agreementData.agreementId}
            previewBase64={agreementData.previewBase64}
            payload={agreementData.payload}
            signatureFields={agreementData.signatureFields}
            pdfDimensions={agreementData.pdfDimensions}
            onSuccess={handleSigned}
            // Enables "Send Remotely" (primary buyer + coBuyers[]). The signed
            // agreement is persisted server-side (lead-scoped); `onRemoteComplete`
            // reads it back into the summary, and the modal still closes via onClose.
            customerDetails={leadData?.customerDetails}
            onRemoteComplete={onRemoteComplete}
            onRemoteSent={onRemoteSent}
          />
        )}
        <View style={{ height: insets.bottom }} />

        {/* In-card overlay, NOT a second native Modal — this dialog is already one. */}
        <AgreementDeliveryPrompt
          inline
          visible={visible && !renderLocally && !deliveryReady && !!leadId}
          leadId={leadId || ''}
          customerDetails={leadData?.customerDetails || customerDetails}
          onCancel={onClose}
          onConfirmed={() => setDeliveryReady(true)}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F5F5' },
  /** Paints the notch area in the header's own white so the two read as one bar. */
  statusBarPad: { backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#1C252E' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#118D57',
  },
  remoteBtnText: { color: '#118D57', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F6F8',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  muted: { color: '#94A3B8', fontSize: 13 },
  errorText: { color: '#EF4444', fontSize: 13, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#059669',
  },
  retryBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
