import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import { AgreementSignatureModal } from '../../../modals/job-builder/AgreementSignatureModal';
import { LeadService } from '../../../../services/api/leads';
import { useGetDescriptionSchema } from '../../../../screens/DynamicDealCenter/hooks/useDescriptionSchema';
import { evaluateDescriptionSchema } from '../../../../utils/dynamic-job-builder/agreement/description-schema-evaluator';
import { generateGutterRooflineDescriptions } from '../../../../utils/dynamic-job-builder/agreement/gutter-roofline-description-generator';
import { generateRoofingDescriptions } from '../../../../utils/dynamic-job-builder/agreement/roofing-description-generator';
import { logEvent } from '../../../../services/api/LoggerService';
import { useAuth } from '../../../../hooks/useAuth';
import { useLeadQuery } from '../../../../hooks/useLeadQuery';

interface DynamicAgreementDialogProps {
  visible: boolean;
  onClose: () => void;
  onAgreementGenerated: (file: any) => void;
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

function formatInstallDate(raw: any): string {
  if (!raw) return 'TBD';
  if (raw === 'TBD') return 'TBD';
  try {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return 'TBD';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  } catch {
    return 'TBD';
  }
}

// Format a price for the agreement with a thousands separator (web parity: the
// result-lead-modal formats contract price / down payment / balance with
// `.toLocaleString()` before they reach the agreement, e.g. "6,000"). Mobile keeps
// them as raw numbers, so add the commas here — "$6000" → "$6,000". Strips any
// pre-existing `$`/commas so an already-formatted string doesn't double up.
const money = (v: any) => {
  if (v === '' || v === null || v === undefined) return '$0.00';
  const num = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(num) ? `$${num.toLocaleString('en-US')}` : `$${v}`;
};

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

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreementData, setAgreementData] = useState<any>(null);
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
        logEvent('add', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'agreement',
          meta: {
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
      return;
    }
    if (requestedRef.current) return;
    if (leadLoading || descSchemaLoading) return;
    requestedRef.current = true;
    generatePreview();
  }, [visible, leadLoading, descSchemaLoading, generatePreview]);

  const handleRetry = () => {
    requestedRef.current = true;
    generatePreview();
  };

  // The signed PDF comes back from `.../sign` as a file on disk. Read it to base64
  // and emit the upload-payload shape the caller expects. Because it is already a
  // real PDF, SummaryFinalizeCards.uploadNewFiles passes it through untouched
  // (`alreadyPdf`) instead of wrapping a JPEG.
  const handleSigned = async (signedPdfPath: string) => {
    try {
      const base64 = await RNFS.readFile(signedPdfPath.replace('file://', ''), 'base64');
      onAgreementGenerated({
        name: `Agreement_${jobDetails.jobDisplay || 'NA'}_${Date.now()}.pdf`,
        file: `data:application/pdf;base64,${base64}`,
        uri: `file://${signedPdfPath.replace('file://', '')}`,
        contentType: 'application/pdf',
        documentType: 'agreement' as const,
        type: 'agreement' as const,
        isNew: true,
        isSystemGenerated: true,
      });
    } catch (e) {
      console.warn('[DynamicAgreementDialog] reading signed PDF failed', e);
      setError('The agreement was signed but could not be saved. Please try again.');
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Generate Agreement</Text>
      <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
        <Icon name="close" size={20} color="#1C252E" />
      </TouchableOpacity>
    </View>
  );

  // While the server renders the PDF this dialog shows the loading/error shell;
  // once `agreementData` arrives the signature modal takes over the screen.
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }} edges={['top', 'bottom']}>
        {renderHeader()}

        <View style={styles.center}>
          {error ? (
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

        {!!agreementData && (
          <AgreementSignatureModal
            visible
            onClose={onClose}
            leadId={leadId || ''}
            agreementId={agreementData.agreementId}
            previewBase64={agreementData.previewBase64}
            payload={agreementData.payload}
            signatureFields={agreementData.signatureFields}
            pdfDimensions={agreementData.pdfDimensions}
            onSuccess={handleSigned}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
