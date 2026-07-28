import React, { useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import { resolveS3Url } from '../../utils/s3-utils';
import { useSecureUrls } from '../../hooks/useSecureUrls';
import { useSecureLogo } from '../../hooks/useSecureLogo';
import { useAuth } from '../../hooks/useAuth';
import { useRevRenderRunsQuery } from '../../hooks/useLeadQuery';
import { RevRenderHistoryModal } from '../../widgets/modals/lead-center/RevRenderHistoryModal';
import {
  DealPricing,
  calcMonthly,
  compactPlanLabel,
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
import { AddPlanModal } from './AddPlanModal';

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
  /** Persist the In-Home Monthly shortlist to `lfcalculator.in_home` (debounced). */
  onSetInHome?: (calculatorId: string, inHome: { planKey?: string; addedPlans?: string[]; apr?: number; monthlyPayment?: number; grandTotal?: number }) => void;
  /** Pull-to-refresh hook from the screen (refetch calculators / lead). */
  onRefresh?: () => void;
}

export function InvestmentPanel({ calculator, pricing, verticals, pricingConfig, jobBuilderConfig, descriptionSchemas, lead, onOptIn, onSetInHome, onRefresh }: Props) {
  const [selectedProgram, setSelectedProgram] = useState<'inhome' | 'oneyear' | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  // Which render pair the before/after slider viewer is open on (null = closed).
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Company branding (web parity: investment-panel.js) — the tenant's dynamic logo +
  // company name from the authed user, same source the agreement generator uses.
  const secureLogo = useSecureLogo();
  const { user } = useAuth();
  const companyName = user?.companyName;

  const plans = pricing.plans;
  const method = calculator.paymentMethod || pricing.defaultMethod || 'check';
  const isLowesLead = lead?.lowesLead === true;

  // In-Home "Monthly" shortlist (web parity: `addedPlansByProgram`). The rep builds
  // a selectable $/mo list the customer picks from; the selected plan drives the
  // In-Home monthly + the opt-in payment method. Hydrated from the persisted
  // `lfcalculator.inHome` when present, else seeded from the calculator's saved
  // financing method (a basic cash/card method leaves the shortlist empty). The panel
  // remounts per calculator (keyed by tab id) so no cross-calculator reset is needed.
  const seedFinancingKey = isFinancing(plans, method) ? method : '';
  const savedInHome = calculator.inHome;
  const seedAdded: string[] = Array.isArray(savedInHome?.addedPlans) && savedInHome.addedPlans.length
    ? savedInHome.addedPlans
    : seedFinancingKey ? [seedFinancingKey] : [];
  const seedSelected: string = savedInHome?.planKey || seedFinancingKey;
  const [addedPlanKeys, setAddedPlanKeys] = useState<string[]>(seedAdded);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string>(seedSelected);
  const [showAddPlan, setShowAddPlan] = useState(false);
  // The financing plan driving the In-Home monthly + opt-in: the rep's selection,
  // else the calculator's own method (unchanged from before when nothing is picked).
  const inHomePlanKey = selectedPlanKey || method;

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
  // In-Home monthly follows the selected shortlist plan (same base `result.monthly`
  // uses — endPrice − downPay — so it's unchanged when the rep hasn't re-picked).
  const inHomeMonthlyBase = Math.max(0, endPrice - downPay);
  const inHomeMonthly = useMemo(
    () => calcMonthly(plans, inHomeMonthlyBase, inHomePlanKey),
    [plans, inHomeMonthlyBase, inHomePlanKey],
  );
  // The shortlist rows the In-Home card renders (financing plans only, each with
  // its $/mo on the current base + a compact terms label).
  const inHomeShortlist = useMemo(
    () =>
      addedPlanKeys
        .filter((k) => isFinancing(plans, k))
        .map((k) => ({ key: k, monthly: calcMonthly(plans, inHomeMonthlyBase, k), terms: compactPlanLabel(plans, k) })),
    [addedPlanKeys, plans, inHomeMonthlyBase],
  );

  // Persist the shortlist to `lfcalculator.inHome` (debounced through the calculator
  // hook, so it coordinates with the same in-flight guard the other saves use — no
  // racing direct PUT). Fired on add / select / remove; the seed itself isn't pushed
  // until the rep first interacts (it mirrors the already-persisted paymentMethod).
  const persistInHome = (added: string[], selected: string) => {
    const planKey = selected && isFinancing(plans, selected) ? selected : '';
    onSetInHome?.(calculator.id, {
      planKey,
      addedPlans: added,
      apr: Number(plans[planKey]?.apr) || 0,
      monthlyPayment: calcMonthly(plans, inHomeMonthlyBase, planKey),
      grandTotal: inHomeGrandTotal,
    });
  };
  const handleAddPlan = (key: string) => {
    setShowAddPlan(false);
    const nextAdded = addedPlanKeys.includes(key) ? addedPlanKeys : [...addedPlanKeys, key];
    setAddedPlanKeys(nextAdded);
    setSelectedPlanKey(key); // adding a plan also selects it (web parity)
    persistInHome(nextAdded, key);
  };
  const handleRemovePlan = (key: string) => {
    const nextAdded = addedPlanKeys.filter((k) => k !== key);
    const nextSel = selectedPlanKey === key ? '' : selectedPlanKey;
    setAddedPlanKeys(nextAdded);
    setSelectedPlanKey(nextSel);
    persistInHome(nextAdded, nextSel);
  };
  const handleSelectPlan = (key: string) => {
    setSelectedPlanKey(key);
    persistInHome(addedPlanKeys, key);
  };

  const srVetDiscount = msrp * (seniorVetPct / 100);
  const preOrderDiscountVal = msrp * (discountPct / 100);

  // 1-Year monthly resolved from the saved oneYearMonthlyPlan selection.
  const defaultOneYearKey = useMemo(() => {
    const fin = Object.keys(plans).filter((k) => isFinancing(plans, k));
    return fin.find((k) => Math.round((plans[k]?.apr || 0) * 100) / 100 === 9.99) || fin.find((k) => (plans[k]?.apr || 0) > 0) || fin[0] || method;
  }, [plans, method]);
  const oneYear = calculator.oneYearMonthlyPlan;
  // Web parity (`investment-panel.js`: `const mode = saved?.mode || 'match'`): when the
  // rep hasn't explicitly configured a 1-Year monthly plan, the 1-Year card MIRRORS the
  // In-Home (highlighted) selection — i.e. the plan the rep actually picked — rather than
  // snapping to the 9.99% default. Previously mobile fell through to `defaultOneYearKey`
  // (the 9.99% GreenSky plan), so selecting Wells Fargo on In-Home still showed
  // "GS… 9.99% APR" on the 1-Year card. `'match'` uses the same key the In-Home card
  // resolves (`inHomePlanKey = selectedPlanKey || method`); `'default'` keeps the 9.99%
  // plan; `'custom'` pins the saved plan key.
  const oneYearMode = oneYear?.mode || 'match';
  const oneYearKey =
    oneYearMode === 'match'
      ? inHomePlanKey
      : oneYearMode === 'custom'
        ? oneYear?.planKey || defaultOneYearKey
        : defaultOneYearKey;
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
        calculatorDescriptions: calculator.descriptions,
      }),
    [calculator.entries, verticals, jobBuilderConfig, descriptionSchemas, lead, calculator.descriptions],
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

  // "Includes the Following" list — the calculator's job-scope descriptions when
  // present, otherwise the product/category names. Shown as bullet points below the
  // heading (was a "·"-joined subtitle line for the product names).
  const inclusions = jobScope.length > 0 ? jobScope : productNames;

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

  // Full rev-render runs for this lead — merged into the viewer runs by `runId` so
  // the before/after slider shows the same color-selection chips ("Soffit: Linen")
  // the Tools flow shows (the persisted `selectedRenders` carries no color summary).
  const leadId = lead?._id || lead?.leadId || lead?.id;
  const { data: allRuns } = useRevRenderRunsQuery(leadId || '');
  const runsById = useMemo(() => {
    const m: Record<string, any> = {};
    (Array.isArray(allRuns) ? allRuns : []).forEach((r: any) => {
      const id = String(r?.runId || r?._id || '');
      if (id) m[id] = r;
    });
    return m;
  }, [allRuns]);
  // Runs fed to the shared RevRenderHistoryModal: the calculator's selected pairs,
  // enriched with the full run (color summary/selections) and freshly-resolved
  // secure before/after URLs (the stored ones may have expired).
  const viewerRuns = useMemo(
    () =>
      renders.map((pair) => ({
        ...(runsById[String(pair?.runId || '')] || {}),
        ...pair,
        originalUrl: beforeUriOf(pair),
        generatedUrl: afterUriOf(pair),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renders, runsById, uriByS3],
  );

  const confirmInHome = () => {
    setShowConfirm(false);
    onOptIn(calculator.id, { price: endPrice, paymentMethod: inHomePlanKey, downPayment: downPay });
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
        // Render pairs are STACKED VERTICALLY (web parity: investment-panel.js
        // `<Stack spacing={2}>`), each full-width so the before/after aren't tiny —
        // was a horizontal scroller of small 220px cards. Within a pair the two
        // photos sit side by side, each a 4:3 half that scales with the screen.
        <View style={{ gap: 16, marginBottom: 16 }}>
          {renders.map((pair, i) => {
            const b = beforeUriOf(pair);
            const a = afterUriOf(pair);
            return (
              <View key={pair?.runId || i}>
                {!!pair?.viewLabel && (
                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                    {pair.viewLabel} · revRender™
                  </Text>
                )}
                {/* Tapping either half opens the shared before/after slider viewer
                    (same flow as Tools/revRender), positioned on this pair. */}
                <View style={{ flexDirection: 'row', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
                  <TouchableOpacity activeOpacity={0.85} disabled={!b} onPress={() => b && setViewerIndex(i)} style={{ flex: 1 }}>
                    <Image source={{ uri: b }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', textAlign: 'center', paddingVertical: 4 }}>BEFORE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.85} disabled={!a} onPress={() => a && setViewerIndex(i)} style={{ flex: 1 }}>
                    <Image source={{ uri: a }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#4CBB17', textAlign: 'center', paddingVertical: 4 }}>AFTER</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
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
      </View>

      {/* Includes the Following — job-scope descriptions (else product/category
          names), as bullet points below the heading. */}
      <View style={{ marginBottom: 18 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', textAlign: 'center', marginBottom: 10 }}>Includes the Following:</Text>
        <View style={{ height: 2, backgroundColor: '#16324F', borderRadius: 1, marginBottom: 14 }} />
        {inclusions.length === 0 ? (
          <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', fontStyle: 'italic' }}>
            Job scope will appear once products are configured.
          </Text>
        ) : (
          inclusions.map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, paddingHorizontal: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CBB17', marginTop: 7, marginRight: 10 }} />
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
          planLabel={oneYearMonthly > 0 ? compactPlanLabel(plans, oneYearKey) : undefined}
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
          planInteractive
          shortlistPlans={inHomeShortlist}
          selectedPlanKey={selectedPlanKey}
          onSelectPlan={handleSelectPlan}
          onRemovePlan={handleRemovePlan}
          onAddPlan={() => setShowAddPlan(true)}
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
        planLabel={inHomeMonthly > 0 ? compactPlanLabel(plans, inHomePlanKey) : undefined}
        downPayment={downPay}
        method={effectiveBadge}
        isLowesLead={lead?.lowesLead === true}
        onConfirm={confirmInHome}
        onClose={() => { setShowConfirm(false); setSelectedProgram(null); }}
      />

      {/* "+ Add Plan" financing picker for the In-Home Monthly shortlist. Gates on
          the current end price (− down payment) and adds financing plans only. */}
      <AddPlanModal
        visible={showAddPlan}
        price={inHomeMonthlyBase}
        plans={plans}
        categories={pricing.dropAddCategories}
        added={addedPlanKeys}
        onAdd={handleAddPlan}
        onClose={() => setShowAddPlan(false)}
      />

      {/* Before/After slider viewer — the SAME shared component the Tools/revRender
          flow uses (before/after compare slider, color chips, prev/next through every
          render, delete, Close). Opened on the tapped pair. */}
      <RevRenderHistoryModal
        visible={viewerIndex !== null}
        initialIndex={viewerIndex ?? 0}
        runs={viewerRuns}
        leadId={leadId}
        onClose={() => setViewerIndex(null)}
        onDeleteSuccess={onRefresh}
        showDelete={false}
      />
    </ScrollView>
  );
}
