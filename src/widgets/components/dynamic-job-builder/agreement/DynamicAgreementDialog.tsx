import React, { useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { DynamicAgreementGenerator } from './DynamicAgreementGenerator';
import { useGetAgreementConfig } from '../../../../screens/DynamicDealCenter/hooks/useAgreementConfig';
import { useGetDescriptionSchema } from '../../../../screens/DynamicDealCenter/hooks/useDescriptionSchema';
import { evaluateDescriptionSchema } from '../../../../utils/dynamic-job-builder/agreement/description-schema-evaluator';
import { generateGutterRooflineDescriptions } from '../../../../utils/dynamic-job-builder/agreement/gutter-roofline-description-generator';
import { generateRoofingDescriptions } from '../../../../utils/dynamic-job-builder/agreement/roofing-description-generator';
import { useAuth } from '../../../../hooks/useAuth';
import { useLeadQuery } from '../../../../hooks/useLeadQuery';
import { formatCurrency } from '../../../../utils/currency';

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

// Was `$${v}`, which printed a contract price as "$22411". Grouped now, so the
// agreement reads the same as the Contract Details card it is generated from.
const money = (v: any) => formatCurrency(v, { fallback: '$0.00' });

/**
 * RN port of web `dynamic-agreement-dialog.js`. Fetches the agreement config +
 * per-product description schema, resolves customer/payment/job details, computes
 * the jobScope (prop → schema evaluator → legacy generators), and hosts
 * DynamicAgreementGenerator in a fullscreen modal.
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
  const { agreementConfig, agreementConfigLoading, agreementConfigError } = useGetAgreementConfig(visible);
  const { schema: descriptionSchema, schemaLoading: descSchemaLoading } = useGetDescriptionSchema(
    visible ? productKey : undefined
  );

  // Logged-in rep (for logging + contractorName fallback) and the lead record
  // (customer details + human-readable leadId + assigned-rep office) — the mobile
  // analog of web's AuthContext + useLead() context. Only fetch while visible.
  const { user } = useAuth();
  const { data: leadData } = useLeadQuery(visible ? leadId || '' : '');

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

  const isLoading = agreementConfigLoading || descSchemaLoading;

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Generate Agreement</Text>
      <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
        <Icon name="close" size={20} color="#1C252E" />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }} edges={['top', 'bottom']}>
        {renderHeader()}

        {isLoading && !agreementConfig ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading agreement configuration...</Text>
          </View>
        ) : agreementConfigError || !agreementConfig ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>Failed to load agreement configuration. Please try again.</Text>
          </View>
        ) : (
          <DynamicAgreementGenerator
            agreementConfig={agreementConfig}
            customerDetails={resolvedCustomerDetails}
            jobDetails={jobDetails}
            paymentDetails={paymentDetails}
            jobScope={computedJobScope}
            contractorName={contractorName}
            onSave={onAgreementGenerated}
            leadId={leadId}
            user={user}
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
});
