import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCalculatorSchema } from '../DynamicDealCenter/hooks/useCalculatorSchema';
import { useDealPricing } from '../DynamicDealCenter/hooks/useDealPricing';
import { useDynamicCalculatorSchemas } from '../DynamicDealCenter/hooks/useDynamicCalculatorSchemas';
import { useGetDescriptionSchemas } from '../DynamicDealCenter/hooks/useDescriptionSchema';
import { useDynamicCalculators } from '../DynamicDealCenter/hooks/useDynamicCalculators';
import { useSubmitDigitalConsentMutation, useFinalizeConsentUploadMutation } from '../../hooks/useLeadMutation';
import { ConsentFormModal } from '../../widgets/modals/lead-center/ConsentFormModal';
import { InvestmentPanel } from './InvestmentPanel';

/**
 * Investment Center (web parity: `src/sections/job/components/investment-center/`).
 * The in-home presentation step: gated on a signed customer consent form, then one
 * tab per priced calculator showing its renders, the DYNAMIC job-scope matrix, the
 * total investment, and the In-Home vs 1-Year program branches. Opting into In-Home
 * hands off to the Result Lead (Sale) flow in the Dynamic Deal Center.
 */

interface Props {
  navigation?: NativeStackNavigationProp<any>;
  route?: { params?: { lead?: any } };
}

/** Web `generatedReports` consent check — mirror of OperationalSections.findReport. */
function hasSignedConsent(lead: any): boolean {
  const reports = [
    ...(lead?.generatedReports || []),
    ...(lead?.outcomeData?.generatedReports || []),
    ...(lead?.leadData?.generatedReports || []),
    ...(lead?.outcome?.generatedReports || []),
  ];
  return reports.some(
    (r: any) =>
      (r.reportType === 'consent_form' ||
        r.reportName?.toLowerCase().includes('consent') ||
        r.reportPath?.toLowerCase().includes('consent')) &&
      !r.isReset,
  );
}

export default function InvestmentCenterScreen({ navigation, route }: Props) {
  const lead = route?.params?.lead;

  const { configuredSchemas, isLoading: schemaLoading, pricingConfig } = useCalculatorSchema();
  const verticals = configuredSchemas;
  const pricing = useDealPricing(lead);
  const { config: jobBuilderConfig, isLoading: jbLoading } = useDynamicCalculatorSchemas();
  const { schemas: descriptionSchemas } = useGetDescriptionSchemas();
  const { tabs, activeTabId, setActiveTabId, loading: calcLoading } = useDynamicCalculators(lead, verticals);

  // ── Consent gate ────────────────────────────────────────────────────────────
  const consentMutation = useSubmitDigitalConsentMutation();
  const finalizeMutation = useFinalizeConsentUploadMutation();
  const [localConsentSigned, setLocalConsentSigned] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const consentSigned = localConsentSigned || hasSignedConsent(lead);

  const handleConsentSubmit = useCallback(
    async (data: any) => {
      setShowConsent(false);
      setConsentBusy(true);
      try {
        const res = await consentMutation.mutateAsync({ leadId: lead?._id, payload: data });
        // On a digital submission the mutation returns the generated PDF path; register
        // it as a consent report so the gate stays satisfied on reload (web parity).
        if (typeof res === 'string') {
          await finalizeMutation
            .mutateAsync({ leadId: lead?._id, pdfPath: res, reportType: 'consent_form' })
            .catch(() => {});
        }
        setLocalConsentSigned(true);
      } catch {
        // leave the gate up; the rep can retry
      } finally {
        setConsentBusy(false);
      }
    },
    [consentMutation, finalizeMutation, lead?._id],
  );

  // Only real, priced calculators appear (web `visibleCalculators`): a bare-number
  // title means an empty calculator, and an unpriced one has nothing to present.
  const visible = useMemo(
    () =>
      tabs.filter(
        (t) => !/^\d+$/.test((t.title || '').trim()) && (t.isRolloutConfirmed || (t.price || 0) > 0),
      ),
    [tabs],
  );
  const active = visible.find((t) => t.id === activeTabId) || visible[0];

  // ── Opt-in handoff → Result Lead (Sale) in the Dynamic Deal Center ───────────
  const handleOptIn = useCallback(
    (calculatorId: string, opts: { price: number; paymentMethod?: string; downPayment?: number }) => {
      navigation?.navigate('DynamicDealCenter', {
        lead,
        resultOptIn: { calculatorId, ...opts },
      });
    },
    [navigation, lead],
  );

  const isLoading = schemaLoading || jbLoading || calcLoading;

  const Header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#fff' }}>
      <TouchableOpacity
        onPress={() => navigation?.goBack()}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="chevron-back" size={20} color="#334155" />
      </TouchableOpacity>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#1C252E', marginRight: 34 }}>
        Investment Center
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
      {Header}

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#4CBB17" />
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Loading Investment Center…</Text>
        </View>
      ) : !consentSigned ? (
        // ── Consent gate ──
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Ionicons name="document-text-outline" size={34} color="#2563EB" />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E', textAlign: 'center' }}>Customer consent required</Text>
          <Text style={{ fontSize: 13, color: '#637381', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            Have the customer sign the consent form to unlock their 1-year free quote and the Investment Center presentation.
          </Text>
          <TouchableOpacity
            onPress={() => setShowConsent(true)}
            disabled={consentBusy}
            style={{ marginTop: 22, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 14, backgroundColor: '#4CBB17', opacity: consentBusy ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            {consentBusy && <ActivityIndicator size="small" color="#fff" />}
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#fff' }}>{consentBusy ? 'Submitting…' : 'Sign Consent Form'}</Text>
          </TouchableOpacity>
        </View>
      ) : visible.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cube-outline" size={44} color="#CBD5E1" />
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#475569', marginTop: 12, textAlign: 'center' }}>No priced calculators yet</Text>
          <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
            Confirm a rollout in the Deal Center first, then come back to present it here.
          </Text>
        </View>
      ) : (
        <>
          {/* Calculator tabs */}
          {visible.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }} contentContainerStyle={{ paddingHorizontal: 12 }}>
              {visible.map((t) => {
                const isActive = t.id === active?.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => setActiveTabId(t.id)}
                    style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: isActive ? '#16A34A' : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '900', color: isActive ? '#1C252E' : '#94A3B8' }}>{t.title}</Text>
                    <Ionicons name="checkmark" size={14} color={isActive ? '#16A34A' : '#CBD5E1'} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {active && (
            <InvestmentPanel
              key={active.id}
              calculator={active}
              pricing={pricing}
              verticals={verticals}
              pricingConfig={pricingConfig}
              jobBuilderConfig={jobBuilderConfig}
              descriptionSchemas={descriptionSchemas}
              lead={lead}
              onOptIn={handleOptIn}
            />
          )}
        </>
      )}

      <ConsentFormModal
        visible={showConsent}
        onClose={() => setShowConsent(false)}
        onPaperFallback={() => setShowConsent(false)}
        onSubmit={handleConsentSubmit}
        lead={lead}
        type="consent"
        loading={consentMutation.isPending}
      />
    </SafeAreaView>
  );
}
