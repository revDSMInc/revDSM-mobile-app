import React, { useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, Modal, Pressable, TextInput, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import { resolveS3Url } from '../../utils/s3-utils';
import { useSecureUrls } from '../../hooks/useSecureUrls';
import { useSecureLogo } from '../../hooks/useSecureLogo';
import { useAuth } from '../../hooks/useAuth';
import {
  DealPricing,
  calcMonthly,
  planLabelOf,
  isFinancing,
} from '../DynamicDealCenter/hooks/useDealPricing';
import {
  computeRolloutResult,
  screensCountFromEntries,
  screenUnitPriceFromSchemas,
} from '../DynamicDealCenter/utils/dynamic-rollout-pricing';
import { buildInvestmentJobScope } from '../DynamicDealCenter/utils/investment-job-scope';
import { formatAmountInput, stripAmount } from '../DynamicDealCenter/utils/format-amount';
import { ProgramCard } from './ProgramCard';
import { OptInConfirmModal } from './OptInConfirmModal';

/**
 * One calculator's Investment Center panel (web parity: `investment-panel.js`),
 * with the FIX for the web bug: the "Includes the Following" list is the DYNAMIC
 * per-product job-scope matrix (footages/colors stripped), not a hardcoded gutter
 * list. Shows the renders bound to this calculator (secure-resolved + tappable),
 * the scope matrix, the total investment, and the In-Home vs 1-Year program
 * branches (opting into 1-Year crosses off In-Home; opting into In-Home fires the
 * Result Lead handoff). The rep can adjust the pre-order discount + down payment
 * live during the presentation, and an accepted drop is surfaced as the price basis.
 */

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

/** Compact badge label for a non-financing (cash/card) method (web parity). */
const NON_FINANCING_BADGE: Record<string, string> = { check: 'CK', mcVisaDscvr: 'CC', lowes_ach: 'ACH', lowes_cc: 'CC' };

interface Props {
  calculator: any;
  pricing: DealPricing;
  verticals: any[];
  pricingConfig: any;
  jobBuilderConfig: any;
  descriptionSchemas: any[];
  lead: any;
  onOptIn: (calculatorId: string, opts: { price: number; paymentMethod?: string; downPayment?: number }) => void;
  /** Pull-to-refresh hook from the screen (refetch calculators / lead). */
  onRefresh?: () => void;
}

export function InvestmentPanel({ calculator, pricing, verticals, pricingConfig, jobBuilderConfig, descriptionSchemas, lead, onOptIn, onRefresh }: Props) {
  const [selectedProgram, setSelectedProgram] = useState<'inhome' | 'oneyear' | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Company branding (web parity: investment-panel.js) — the tenant's dynamic logo +
  // company name from the authed user, same source the agreement generator uses.
  const secureLogo = useSecureLogo();
  const { user } = useAuth();
  const companyName = user?.companyName;

  const plans = pricing.plans;
  const method = calculator.paymentMethod || pricing.defaultMethod || 'check';
  const isLowesLead = lead?.lowesLead === true;

  // Basic (non-financing) method badges shown next to each Grand Total — CK/CC/AMEX
  // for standard leads, ACH/CC for Lowe's (web parity: program-card.js `basicPlans`).
  const basicBadges = useMemo(() => {
    const out: { key: string; label: string }[] = [];
    const seen = new Set<string>();
    Object.entries(plans).forEach(([k, p]: any) => {
      if (!p || p.type === 'financing') return;
      const lowes = /lowes/i.test(k);
      if (isLowesLead ? !lowes : lowes) return;
      const label = NON_FINANCING_BADGE[k] || p.shortlabel || String(p.label || k).split(/[\s(]/)[0].toUpperCase();
      if (seen.has(label)) return;
      seen.add(label);
      out.push({ key: k, label });
    });
    return out;
  }, [plans, isLowesLead]);
  const [selectedBadge, setSelectedBadge] = useState('');
  // Effective badge: the rep's pick, else the calc's method if it's a basic one, else the first.
  const effectiveBadge = selectedBadge || basicBadges.find((b) => b.key === method)?.key || basicBadges[0]?.key || 'check';

  // An accepted drop is the negotiated current price — present that (else the
  // confirmed end price). Both flow through the SAME computeRolloutResult the rollout
  // uses, so the card values stay consistent with what the rep locked.
  const drops: any[] = Array.isArray(calculator.dropPrice) ? calculator.dropPrice : [];
  const acceptedDrop = drops.find((d) => d?.status === 'accepted');
  const confirmedPrice = Number(calculator.price) || 0;
  const endPrice = Number(acceptedDrop?.price) || confirmedPrice;
  const hasDrop = !!acceptedDrop && Number(acceptedDrop?.price) > 0 && Number(acceptedDrop.price) !== confirmedPrice;

  // Live-adjustable during the presentation.
  const [downText, setDownText] = useState(calculator.downPayment ? String(calculator.downPayment) : '');
  const [showDownInput, setShowDownInput] = useState((calculator.downPayment || 0) > 0);
  // Pre-order discount is fixed at the calculator's saved value (else the config
  // default) — the live % selector was removed per the Investment Center redesign.
  const discountPct = calculator.discountPercentage || pricing.defaultPreOrder;
  // 1-Year card has its own independent down payment (web parity: "each independent").
  const [oneYearDownText, setOneYearDownText] = useState('');
  const [showOneYearDown, setShowOneYearDown] = useState(false);

  const seniorVetPct = pricing.seniorVetPct;
  const rawDown = parseFloat(downText) || 0;
  const downPay = endPrice > 0 ? Math.min(rawDown, endPrice) : rawDown;

  const screensCount = useMemo(() => screensCountFromEntries(calculator.entries), [calculator.entries]);
  const screenUnitPrice = useMemo(() => screenUnitPriceFromSchemas(verticals, pricingConfig), [verticals, pricingConfig]);

  const result = useMemo(
    () =>
      computeRolloutResult({
        endPrice,
        screensCount,
        screenUnitPrice,
        discountConfig: pricing.discountConfig,
        discountPct,
        seniorVetPct,
        downPayment: downPay,
        plan: plans[method],
      }),
    [endPrice, screensCount, screenUnitPrice, pricing.discountConfig, discountPct, seniorVetPct, downPay, plans, method],
  );

  const msrp = result.msrp;
  const inHomeProgram = result.programs.find((p: any) => p.isHighlighted) || result.programs[result.programs.length - 1];
  const oneYearProgram = result.programs.find((p: any) => !p.isHighlighted) || result.programs[0];
  const inHomeGrandTotal = inHomeProgram?.grandTotal ?? msrp;
  const oneYearGrandTotal = oneYearProgram?.grandTotal ?? msrp;
  const inHomeMonthly = result.monthly;
  const srVetDiscount = msrp * (seniorVetPct / 100);
  const preOrderDiscountVal = msrp * (discountPct / 100);

  // 1-Year monthly resolved from the saved oneYearMonthlyPlan selection.
  const defaultOneYearKey = useMemo(() => {
    const fin = Object.keys(plans).filter((k) => isFinancing(plans, k));
    return fin.find((k) => Math.round((plans[k]?.apr || 0) * 100) / 100 === 9.99) || fin.find((k) => (plans[k]?.apr || 0) > 0) || fin[0] || method;
  }, [plans, method]);
  const oneYear = calculator.oneYearMonthlyPlan;
  const oneYearKey = oneYear?.mode === 'match' ? method : oneYear?.mode === 'custom' ? (oneYear?.planKey || defaultOneYearKey) : defaultOneYearKey;
  const oneYearMonthly = useMemo(() => calcMonthly(plans, oneYearGrandTotal, oneYearKey), [plans, oneYearGrandTotal, oneYearKey]);

  // Dynamic per-product job-scope matrix (no footages/colors) — the corrected data.
  const jobScope = useMemo(
    () =>
      buildInvestmentJobScope({
        entries: calculator.entries || {},
        calculatorSchemas: verticals,
        jobBuilderConfig,
        descriptionSchemas,
        lead,
      }),
    [calculator.entries, verticals, jobBuilderConfig, descriptionSchemas, lead],
  );

  // Product/category names present in this calculator (for the heading).
  const productNames = useMemo(() => {
    const catIds = new Set<string>();
    Object.values(calculator.entries || {}).forEach((e: any) => {
      if (e?.categoryId && e.inputValue > 0) catIds.add(e.categoryId);
    });
    const names: string[] = [];
    (verticals || []).forEach((v: any) =>
      (v?.categories || []).forEach((c: any) => {
        if (catIds.has(c.id) && c.label) names.push(c.label);
      }),
    );
    return Array.from(new Set(names));
  }, [calculator.entries, verticals]);

  // ── Renders: resolve fresh secure URLs (stored ones may have expired) ────────
  const renders: any[] = useMemo(
    () => (Array.isArray(calculator.selectedRenders) ? calculator.selectedRenders : []),
    [calculator.selectedRenders],
  );
  const renderPhotos = useMemo(() => {
    const arr: any[] = [];
    renders.forEach((p) => {
      if (p?.s3UrlOriginal) arr.push({ s3url: p.s3UrlOriginal, bucketName: p.bucketName, category: 'r' });
      if (p?.s3UrlGenerated) arr.push({ s3url: p.s3UrlGenerated, bucketName: p.bucketName, category: 'r' });
    });
    return arr;
  }, [renders]);
  const renderSecure = useSecureUrls(renderPhotos);
  const uriByS3 = useMemo(() => {
    const m: Record<string, string> = {};
    Object.values(renderSecure.data || {}).forEach((arr: any) =>
      (arr || []).forEach((x: any) => { if (x?.s3url) m[x.s3url] = x.uri; }),
    );
    return m;
  }, [renderSecure.data]);
  const beforeUriOf = (p: any) => uriByS3[p?.s3UrlOriginal] || p?.originalUrl || (p?.s3UrlOriginal ? resolveS3Url(p.s3UrlOriginal) : '') || '';
  const afterUriOf = (p: any) => uriByS3[p?.s3UrlGenerated] || p?.generatedUrl || (p?.s3UrlGenerated ? resolveS3Url(p.s3UrlGenerated) : '') || '';
  const rendersLoading = renderPhotos.length > 0 && renderSecure.isLoading && Object.keys(uriByS3).length === 0;

  const confirmInHome = () => {
    setShowConfirm(false);
    onOptIn(calculator.id, { price: endPrice, paymentMethod: method, downPayment: downPay });
  };

  const onPullRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([renderSecure.refetch?.(), Promise.resolve(onRefresh?.())]);
    } finally {
      setRefreshing(false);
    }
  };

  // Reusable editable down-payment control — In-Home and 1-Year each have their own
  // (web parity: "Down payment — shown on both cards, each independent").
  const renderDownEditor = (
    text: string,
    setText: (v: string) => void,
    show: boolean,
    setShow: (v: boolean) => void,
    cap: number,
  ) => {
    const commit = () => {
      let v = parseFloat(text) || 0;
      if (cap > 0 && v > cap) { v = cap; setText(String(v)); }
    };
    const dp = parseFloat(text) || 0;
    return show ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 10, height: 36 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: '#94A3B8', marginRight: 4, lineHeight: 14 }}>$</Text>
        <TextInput
          style={{ flex: 1, fontSize: 11, fontWeight: '900', color: '#1C252E', padding: 0, margin: 0, height: '100%', lineHeight: 14, textAlignVertical: 'center' }}
          value={formatAmountInput(text)}
          onChangeText={(t) => setText(stripAmount(t))}
          onEndEditing={commit}
          onBlur={commit}
          placeholder="Add Down Payment"
          placeholderTextColor="#94A3B8"
          keyboardType="numeric"
        />
        {dp > 0 && (
          <TouchableOpacity onPress={() => { setText(''); setShow(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color="#FF5630" />
          </TouchableOpacity>
        )}
      </View>
    ) : (
      <TouchableOpacity onPress={() => setShow(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2196F3', backgroundColor: '#2196F30D', borderRadius: 10, paddingVertical: 8 }}>
        <Ionicons name="add" size={13} color="#2196F3" />
        <Text style={{ fontSize: 10, fontWeight: '800', color: '#2196F3' }}>{`Add Down Payment`}</Text>
      </TouchableOpacity>
    );
  };
  const inHomeDownEditor = renderDownEditor(downText, setDownText, showDownInput, setShowDownInput, endPrice);
  const oneYearDownEditor = renderDownEditor(oneYearDownText, setOneYearDownText, showOneYearDown, setShowOneYearDown, oneYearGrandTotal);

  // Program breakdown rows. In-Home carries an extra "% Discount" row, so reserve
  // both cards' breakdown block to the taller count — this keeps the Grand Total /
  // Add-Down-Payment / monthly on the same line across the two cards.
  const oneYearRows = [
    { label: 'Total', value: fmt(msrp) },
    { label: `${seniorVetPct}% Sr + Vet`, value: `-${fmt(srVetDiscount)}`, green: true },
  ];
  const inHomeRows = [
    { label: 'Total', value: fmt(msrp) },
    { label: `${seniorVetPct}% Sr + Vet`, value: `-${fmt(srVetDiscount)}`, green: true },
    { label: `${discountPct}% Discount`, value: `-${fmt(preOrderDiscountVal)}`, green: true },
  ];
  const maxProgramRows = Math.max(oneYearRows.length, inHomeRows.length);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // Keep a focused input (e.g. the down-payment field) above the keyboard. iOS
      // adjusts the scroll insets and scrolls the field into view; Android relies on
      // the activity's adjustResize windowSoftInputMode (app parity with the job builder).
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor="#4CBB17" colors={['#4CBB17']} />}
    >
      {/* Company branding — dynamic logo + company name (web parity), else the
          Leaf Filter wordmark fallback. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, minHeight: 32, marginBottom: 12 }}>
        {!!secureLogo && (
          <Image source={{ uri: secureLogo }} style={{ height: 32, width: 120 }} resizeMode="contain" />
        )}
        {companyName ? (
          <Text style={{ fontSize: 15, fontWeight: '800', fontStyle: 'italic', color: '#15803D', textTransform: 'capitalize' }}>{companyName}</Text>
        ) : !secureLogo ? (
          <Text style={{ fontSize: 15, fontWeight: '800', fontStyle: 'italic', color: '#15803D' }}>
            Leaf Filter <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8' }}>GUTTER PROTECTION</Text>
          </Text>
        ) : null}
      </View>

      {/* Selected renders — secure-resolved, tappable to zoom */}
      {rendersLoading ? (
        <View style={{ height: 118, borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginBottom: 16, backgroundColor: '#F8FAFC' }}>
          <ActivityIndicator size="small" color="#4CBB17" />
          <Text style={{ fontSize: 10, color: '#94A3B8', marginTop: 6 }}>Loading renders…</Text>
        </View>
      ) : renders.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }} style={{ marginBottom: 16 }}>
          {renders.map((pair, i) => {
            const b = beforeUriOf(pair);
            const a = afterUriOf(pair);
            return (
              <View key={pair?.runId || i} style={{ width: 220, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity activeOpacity={0.85} disabled={!b} onPress={() => b && setPreview(b)} style={{ flex: 1 }}>
                    <Image source={{ uri: b }} style={{ width: '100%', height: 110, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                    <Text style={{ fontSize: 8, fontWeight: '900', color: '#94A3B8', textAlign: 'center', paddingVertical: 3 }}>BEFORE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.85} disabled={!a} onPress={() => a && setPreview(a)} style={{ flex: 1 }}>
                    <Image source={{ uri: a }} style={{ width: '100%', height: 110, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                    <Text style={{ fontSize: 8, fontWeight: '900', color: '#4CBB17', textAlign: 'center', paddingVertical: 3 }}>AFTER</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* "Your Investment with {company}" heading (web parity) + the product list */}
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
          <View style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
          <Text style={{ fontSize: 15, fontWeight: '900', color: '#16324F', textAlign: 'center', textTransform: 'capitalize' }}>
            Your Investment with {companyName || 'LeafFilter®'}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
        </View>
        {productNames.length > 0 && (
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#4CBB17', marginTop: 4, textAlign: 'center' }}>
            {productNames.join(' · ')}
          </Text>
        )}
      </View>

      {/* Includes the Following — the DYNAMIC job scope matrix */}
      <View style={{ marginBottom: 18 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', textAlign: 'center', marginBottom: 12 }}>Includes the Following:</Text>
        {jobScope.length === 0 ? (
          <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', fontStyle: 'italic' }}>
            Job scope will appear once products are configured.
          </Text>
        ) : (
          jobScope.map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, paddingHorizontal: 4 }}>
              <Ionicons name="checkmark-circle" size={16} color="#4CBB17" style={{ marginTop: 1, marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: 14, color: '#1C252E', lineHeight: 20 }}>{line}</Text>
            </View>
          ))
        )}
      </View>

      {/* Total Investment (MSRP) */}
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
        <View style={{ backgroundColor: '#1E293B', paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>TOTAL INVESTMENT</Text>
        </View>
        <View style={{ backgroundColor: '#fff', paddingVertical: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 34, fontWeight: '900', color: '#15803D' }}>{fmt(msrp)}</Text>
          {hasDrop && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Ionicons name="pricetag" size={11} color="#B45309" />
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#B45309' }}>Negotiated {fmt(endPrice)} · was {fmt(confirmedPrice)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Branch connector — MSRP branching DOWN into the two program cards with an
          arrowhead pointing into each (web parity: investment-panel.js SVG). */}
      <View style={{ alignItems: 'center', marginTop: 4, marginBottom: -6, zIndex: 1 }}>
        <Svg width={200} height={40} viewBox="0 0 200 40">
          <Path
            d="M 100 0 L 100 15 M 20 15 L 180 15 M 20 15 L 20 35 M 180 15 L 180 35"
            fill="none"
            stroke="rgba(145,158,171,0.35)"
            strokeWidth={2}
          />
          <Path d="M 15 30 L 20 40 L 25 30" fill="rgba(145,158,171,0.35)" />
          <Path d="M 175 30 L 180 40 L 185 30" fill="rgba(145,158,171,0.35)" />
        </Svg>
      </View>

      {/* Program branches — extra top padding leaves room for the floating PRICE
          LOCK badge that sits above the 1-Year card. */}
      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 14 }}>
        <ProgramCard
          title="1 YEAR PROGRAM"
          priceLock
          rows={oneYearRows}
          reserveRows={maxProgramRows}
          grandTotal={oneYearGrandTotal}
          badges={basicBadges}
          selectedBadgeKey={effectiveBadge}
          onSelectBadge={setSelectedBadge}
          downPaymentSlot={oneYearDownEditor}
          monthly={oneYearMonthly}
          planLabel={oneYearMonthly > 0 ? planLabelOf(plans, oneYearKey) : undefined}
          selected={selectedProgram === 'oneyear'}
          crossedOff={selectedProgram === 'inhome'}
          optInLabel="Opt In (1-Yr)"
          onOptIn={() => setSelectedProgram(selectedProgram === 'oneyear' ? null : 'oneyear')}
          onRevert={() => setSelectedProgram(null)}
        />
        <ProgramCard
          title="IN-HOME PRE ORDER"
          highlighted
          rows={inHomeRows}
          reserveRows={maxProgramRows}
          grandTotal={inHomeGrandTotal}
          badges={basicBadges}
          selectedBadgeKey={effectiveBadge}
          onSelectBadge={setSelectedBadge}
          monthly={inHomeMonthly}
          planLabel={inHomeMonthly > 0 ? planLabelOf(plans, method) : undefined}
          downPaymentSlot={inHomeDownEditor}
          selected={selectedProgram === 'inhome'}
          crossedOff={selectedProgram === 'oneyear'}
          optInLabel="Opt In"
          onOptIn={() => { setSelectedProgram('inhome'); setShowConfirm(true); }}
          onRevert={() => setSelectedProgram(null)}
        />
      </View>

      <OptInConfirmModal
        visible={showConfirm}
        price={inHomeGrandTotal}
        monthly={inHomeMonthly}
        planLabel={inHomeMonthly > 0 ? planLabelOf(plans, method) : undefined}
        downPayment={downPay}
        method={method}
        isLowesLead={lead?.lowesLead === true}
        onConfirm={confirmInHome}
        onClose={() => { setShowConfirm(false); setSelectedProgram(null); }}
      />

      {/* Full-screen render preview */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable onPress={() => setPreview(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          {preview && <Image source={{ uri: preview }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
          <TouchableOpacity onPress={() => setPreview(null)} style={{ position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
