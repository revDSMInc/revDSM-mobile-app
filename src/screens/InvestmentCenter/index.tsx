import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCalculatorSchema } from '../DynamicDealCenter/hooks/useCalculatorSchema';
import { useDealPricing } from '../DynamicDealCenter/hooks/useDealPricing';
import { useDynamicCalculatorSchemas } from '../DynamicDealCenter/hooks/useDynamicCalculatorSchemas';
import { useGetDescriptionSchemas } from '../DynamicDealCenter/hooks/useDescriptionSchema';
import { useDynamicCalculators } from '../DynamicDealCenter/hooks/useDynamicCalculators';
import { useSubmitDigitalConsentMutation, useFinalizeConsentUploadMutation, useUploadPaperConsentOCRMutation } from '../../hooks/useLeadMutation';
import { ConsentFormModal } from '../../widgets/modals/lead-center/ConsentFormModal';
import { PaperFallbackModal } from '../../widgets/modals/lead-center/PaperFallbackModal';
import { InvestmentPanel } from './InvestmentPanel';
import { queryClient } from '../../services/api/queryClient';

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
  const { tabs, activeTabId, setActiveTabId, loading: calcLoading, handleSetInHome } = useDynamicCalculators(lead, verticals);

  // ── Consent gate ────────────────────────────────────────────────────────────
  const consentMutation = useSubmitDigitalConsentMutation();
  const finalizeMutation = useFinalizeConsentUploadMutation();
  const ocrMutation = useUploadPaperConsentOCRMutation();
  const [localConsentSigned, setLocalConsentSigned] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  // Paper Fallback: uploads a photo of a paper consent form, OCR-scans it, then
  // reopens the consent form prefilled with the extracted fields (LeadCenter parity).
  const [showPaperFallback, setShowPaperFallback] = useState(false);
  const [prefilledOcrData, setPrefilledOcrData] = useState<any>(null);
  // Back button raises a confirm before leaving (the presentation shouldn't close on
  // a stray tap); only "Exit" actually navigates back.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // Calculator-tab scroll metrics — drive the left/right blur-fade edges (Deal Center
  // parity) that signal a long tab name / more tabs are scrolled off-screen.
  const [tabScrollOffset, setTabScrollOffset] = useState(0);
  const [tabScrollViewWidth, setTabScrollViewWidth] = useState(0);
  const [tabContentWidth, setTabContentWidth] = useState(0);
  const consentSigned = localConsentSigned || hasSignedConsent(lead);

  const handleConsentSubmit = useCallback(
    async (data: any) => {
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
        setShowConsent(false);
        setPrefilledOcrData(null);
      } catch {
        // leave the gate up; the rep can retry
      }
    },
    [consentMutation, finalizeMutation, lead?._id],
  );

  // OCR payload → consent form prefill (mirror of LeadCenter.parseOcrData).
  const parseOcrData = useCallback((ocrResult: any) => {
    const dataList = ocrResult?.data;
    const getFromData = (label: string) => {
      if (Array.isArray(dataList)) {
        const item = dataList.find((i: any) => i?.label?.toLowerCase() === label.toLowerCase());
        return item?.value ?? '';
      }
      if (dataList && typeof dataList === 'object') {
        return dataList[label] ?? dataList[label.replace(/\s+/g, '')] ?? '';
      }
      return '';
    };

    const fullName = getFromData('Customer Name') || '';
    const [firstName = '', ...lastNameParts] = fullName.split(' ');
    const lastName = lastNameParts.join(' ');

    const rawDate = getFromData('Date') || '';
    const normalizeOcrDate = (input: string) => {
      if (!input) return '';
      const s = String(input).trim().replace(/[-.]/g, '/');
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (m) {
        const mm = String(parseInt(m[1], 10)).padStart(2, '0');
        const dd = String(parseInt(m[2], 10)).padStart(2, '0');
        const y = m[3];
        const yyyy = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
        return `${yyyy}-${mm}-${dd}`;
      }
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${yyyy}-${mm}-${dd}`;
      }
      return s;
    };

    return {
      firstName,
      lastName,
      phoneNumber: getFromData('Phone') || '',
      email: getFromData('Email') || '',
      leadId: getFromData('Lead ID') || '',
      date: normalizeOcrDate(rawDate),
    };
  }, []);

  const handlePaperFallbackSubmit = useCallback(
    async (fileData: any) => {
      try {
        const res = await ocrMutation.mutateAsync(fileData);
        setPrefilledOcrData(parseOcrData(res));
        setShowPaperFallback(false);
        setShowConsent(true);
      } catch (err) {
        console.error('OCR scanning error:', err);
      }
    },
    [ocrMutation, parseOcrData],
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

  // Open the consent form DIRECTLY when the customer hasn't signed yet — the rep
  // shouldn't have to tap through a gate first. Fires once per screen mount.
  const consentAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (isLoading || consentSigned || consentAutoOpenedRef.current) return;
    consentAutoOpenedRef.current = true;
    setShowConsent(true);
  }, [isLoading, consentSigned]);

  const Header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#fff' }}>
      <TouchableOpacity
        onPress={() => setShowExitConfirm(true)}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name="chevron-back" size={20} color="#334155" />
      </TouchableOpacity>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#1C252E' }}>
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
            disabled={consentMutation.isPending}
            style={{ marginTop: 22, paddingHorizontal: 26, paddingVertical: 13, borderRadius: 14, backgroundColor: '#4CBB17', opacity: consentMutation.isPending ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            {consentMutation.isPending && <ActivityIndicator size="small" color="#fff" />}
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#fff' }}>{consentMutation.isPending ? 'Submitting…' : 'Sign Consent Form'}</Text>
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
          {/* Calculator tabs — with left/right blur-fade edges (Deal Center parity)
              that show a long tab name / more tabs continue off-screen. */}
          {visible.length > 1 && (
            <View style={{ position: 'relative', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ paddingHorizontal: 12 }}
                onScroll={(e) => setTabScrollOffset(e.nativeEvent.contentOffset.x)}
                onContentSizeChange={(w) => setTabContentWidth(w)}
                onLayout={(e) => setTabScrollViewWidth(e.nativeEvent.layout.width)}
                scrollEventThrottle={16}
              >
                {visible.map((t) => {
                  const isActive = t.id === active?.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => setActiveTabId(t.id)}
                      style={{ paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: isActive ? '#16A34A' : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '900', color: isActive ? '#1C252E' : '#94A3B8',paddingBottom:4 }}>{t.title}</Text>
                      <Ionicons name="checkmark" size={14} color={isActive ? '#16A34A' : '#CBD5E1'} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Left fade — shown once the row is scrolled away from the start. */}
              {tabScrollOffset > 5 && (
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' }} pointerEvents="none">
                  {[1.0, 0.8, 0.6, 0.4, 0.2, 0.08].map((opacity, idx) => (
                    <View key={`tab-left-fade-${idx}`} style={{ width: 4, height: '100%', opacity, overflow: 'hidden' }}>
                      <BlurView style={{ position: 'absolute', left: -idx * 4, top: 0, bottom: 0, width: 24 }} blurType="light" blurAmount={10} reducedTransparencyFallbackColor="rgba(255,255,255,1)" />
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.45)' }]} />
                    </View>
                  ))}
                </View>
              )}

              {/* Right fade — shown while more content continues past the edge. */}
              {tabScrollOffset + tabScrollViewWidth < tabContentWidth - 5 && (
                <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 24, flexDirection: 'row' }} pointerEvents="none">
                  {[0.08, 0.2, 0.4, 0.6, 0.8, 1.0].map((opacity, idx) => (
                    <View key={`tab-right-fade-${idx}`} style={{ width: 4, height: '100%', opacity, overflow: 'hidden' }}>
                      <BlurView style={{ position: 'absolute', left: -idx * 4, top: 0, bottom: 0, width: 24 }} blurType="light" blurAmount={10} reducedTransparencyFallbackColor="rgba(255,255,255,1)" />
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.45)' }]} />
                    </View>
                  ))}
                </View>
              )}
            </View>
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
              onSetInHome={handleSetInHome}
              onRefresh={() => {
                const lid = lead?._id || lead?.leadId || lead?.id;
                if (lid) {
                  queryClient.invalidateQueries({ queryKey: ['lead', lid] });
                  queryClient.invalidateQueries({ queryKey: ['revrender-runs', lid] });
                }
              }}
            />
          )}
        </>
      )}

      <ConsentFormModal
        visible={showConsent}
        // Cancel / header-✕ raise the "Exit consent form?" confirmation inside the
        // modal itself (shared ConsentFormModal); only "Exit to Tools" reaches here,
        // where we dismiss and return to the previous screen.
        onClose={() => { setShowConsent(false); setPrefilledOcrData(null); navigation?.goBack(); }}
        // Paper Fallback → close the consent form and open the photo-upload/OCR modal.
        onPaperFallback={() => { setShowConsent(false); setShowPaperFallback(true); }}
        onSubmit={handleConsentSubmit}
        lead={lead}
        type="consent"
        loading={consentMutation.isPending}
        prefilledData={prefilledOcrData}
      />

      {showPaperFallback && (
        <PaperFallbackModal
          visible={showPaperFallback}
          onClose={() => setShowPaperFallback(false)}
          onSubmit={handlePaperFallbackSubmit}
          loading={ocrMutation.isPending}
        />
      )}

      {/* Exit confirmation — blurred backdrop, matching the consent form's exit
          prompt. Non-dismissable: only Stay / Exit act. */}
      <Modal visible={showExitConfirm} transparent animationType="fade" onRequestClose={() => setShowExitConfirm(false)}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType="light"
            blurAmount={10}
            reducedTransparencyFallbackColor="rgba(255,255,255,0.5)"
            pointerEvents="none"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} pointerEvents="none" />
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '900', color: '#1C252E', textAlign: 'center' }}>Exit Investment Center?</Text>
            <Text style={{ fontSize: 13, color: '#637381', textAlign: 'center', marginTop: 8, lineHeight: 19 }}>
              This will return to your Tools menu. The signed consent stays on file.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 22, alignSelf: 'stretch' }}>
              <TouchableOpacity onPress={() => setShowExitConfirm(false)} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#334155' }}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowExitConfirm(false); navigation?.goBack(); }}
                style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#fff' }}>Exit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
