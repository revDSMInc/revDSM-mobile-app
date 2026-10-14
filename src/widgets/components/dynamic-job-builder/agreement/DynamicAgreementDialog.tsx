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
  onRemoteComplete?: () => void;
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

function toDisplayId(rawId: any): string {
  const str = String(rawId ?? '').trim() || 'N/A';
  if (str.length > 8) return str.slice(-5).toUpperCase();
  return str;
}


const money = (v: any) => formatCurrency(v, { fallback: '$0.00' });

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

  const { user } = useAuth();
  const { data: leadData, isLoading: leadLoading } = useLeadQuery(visible ? leadId || '' : '');

  const insets = useSafeAreaInsets();

  const renderLocally = !isOnline() || isClientId(leadId);
  // REVUIUX-391 applies offline too: ask BEFORE generating, so the signed copy always has a
  // destination. A lead created at a door asks as well - its queued preference is re-pointed at
  // the real id by `rekeyDeliveryPreference` when the lead itself syncs.
  const needsDelivery = !!leadId;
  const { agreementConfig, agreementConfigLoading } = useGetAgreementConfig(visible);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [deliveryReady, setDeliveryReady] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreementData, setAgreementData] = useState<any>(null);
  const [signVisible, setSignVisible] = useState(true);
  const requestedRef = useRef(false);

  const resolvedRepDetails = useMemo(
    () =>
      repDetails && Object.keys(repDetails).length
        ? repDetails
        : leadData?.assignedRepDetails || {},
    [repDetails, leadData]
  );

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
      if (user?._id) {
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

  useEffect(() => {
    if (!visible) {
      requestedRef.current = false;
      setAgreementData(null);
      setError(null);
      setIsGenerating(false);
      setSignVisible(true);
      setDeliveryReady(false);
      return;
    }
    if (requestedRef.current) return;
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

  const handleSignClose = useCallback(() => {
    setSignVisible(false);
    setTimeout(() => onClose(), 350);
  }, [onClose]);

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
          agreementConfig && (deliveryReady || !needsDelivery) ? (
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
            visible={signVisible}
            animationType="fade"
            onClose={handleSignClose}
            leadId={leadId || ''}
            agreementId={agreementData.agreementId}
            previewBase64={agreementData.previewBase64}
            payload={agreementData.payload}
            signatureFields={agreementData.signatureFields}
            pdfDimensions={agreementData.pdfDimensions}
            onSuccess={handleSigned}
            customerDetails={leadData?.customerDetails}
            onRemoteComplete={onRemoteComplete}
            onRemoteSent={onRemoteSent}
          />
        )}
        <View style={{ height: insets.bottom }} />

        {/* In-card overlay, NOT a second native Modal — this dialog is already one. */}
        <AgreementDeliveryPrompt
          inline
          visible={visible && needsDelivery && !deliveryReady}
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
