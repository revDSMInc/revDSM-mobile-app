import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Platform, Pressable, Dimensions } from 'react-native';
import { format } from 'date-fns';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import { resolveS3Url } from '../../utils/s3-utils';
import { useSecureUrls } from '../../hooks/useSecureUrls';
import { useWarmedImageUris } from '../../hooks/useWarmedImageUris';
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
import { buildScopeGroups, flattenScopeGroups } from '../../utils/investment-scope-groups';
import { evaluateDealCenterDescriptions } from '../../utils/deal-center-descriptions';
import { useGetDealCenterDescriptionSchemas } from '../DynamicDealCenter/hooks/useDescriptionSchema';
import { formatAmountInput, stripAmount } from '../DynamicDealCenter/utils/format-amount';
import { resolveActiveDownPayment } from '../DynamicDealCenter/utils/drop-prices';
import { ProgramCard } from './ProgramCard';
import { OptInConfirmModal } from './OptInConfirmModal';
import { describeFullPackage } from '../DynamicDealCenter/utils/tab-naming';
import {
  FullPackageTitle,
  FullPackageInfoModal,
  type PackageAnchorRect,
} from '../DynamicDealCenter/components/FullPackageBadge';
import { AddPlanModal } from './AddPlanModal';
import { SpotlightOverlay, SpotlightState, SpotlightRect } from './SpotlightOverlay';
import { triggerHaptic } from '../../utils/haptics';
import { resolveRepOneYearKey, resolveOneYearDefaultKey } from '../../utils/one-year-default';
import {
  logInvestmentOptIn,
  logInvestmentOptOut,
  logInvestmentPlanAdded,
  logInvestmentPlanRemoved,
  logInvestmentPaymentMethodSelected,
  logInvestmentDownPaymentChanged,
  logInvestmentCalculatorViewed,
  logInvestmentCalculatorLeft,
  logInvestmentProgramEnlarged,
  logInvestmentProgramMinimized,
  logInvestmentPriceSecured,
  DisplayProgramKey,
  PlanMonthlyChange,
} from '../../utils/activity-log/investment-center-log';
import { NUMERIC_KEYBOARD } from '../../utils/keyboard-type';

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

const NON_FINANCING_BADGE: Record<string, string> = { check: 'CK', mcVisaDscvr: 'CC', lowes_ach: 'ACH', lowes_cc: 'CC' };

const { width: SPOT_SW, height: SPOT_SH } = Dimensions.get('window');
type SpotlightSectionId = 'total' | 'oneyear' | 'inhome';
const SPOTLIGHT_ORDER: SpotlightSectionId[] = ['total', 'oneyear', 'inhome'];
const SPOTLIGHT_TITLE: Record<SpotlightSectionId, string> = {
  total: 'TOTAL INVESTMENT',
  oneyear: '1 YEAR PROGRAM',
  inhome: 'IN-HOME PRE ORDER',
};
const SPOTLIGHT_BASE_SCALE: Record<SpotlightSectionId, number> = {
  total: 1.14,
  oneyear: 1.62,
  inhome: 1.62,
};

interface Props {
  calculator: any;
  pricing: DealPricing;
  verticals: any[];
  pricingConfig: any;
  jobBuilderConfig: any;
  descriptionSchemas: any[];
  lead: any;
  onOptIn: (calculatorId: string, opts: { price: number; paymentMethod?: string; downPayment?: number }) => void;
  onSetInHome?: (calculatorId: string, inHome: { planKey?: string; addedPlans?: string[]; apr?: number; monthlyPayment?: number; grandTotal?: number; optInProgram?: 'inhome' | 'oneyear' | null }) => void;
  onRefresh?: () => void;
  /** Plan key the rep set as the lead-wide default on ANY of this lead's calculators. */
}

export function InvestmentPanel({ calculator, pricing, verticals, pricingConfig, jobBuilderConfig, descriptionSchemas, lead, onOptIn, onSetInHome, onRefresh }: Props) {
  const isLeadSold = lead?.status === 'sale';
  const [selectedProgram, setSelectedProgram] = useState<'inhome' | 'oneyear' | null>(
    calculator.inHome?.optInProgram ?? null,
  );
  const activeProgram = isLeadSold ? (selectedProgram || 'inhome') : selectedProgram;
  const [showConfirm, setShowConfirm] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const totalRef = useRef<View>(null);
  const oneYearRef = useRef<View>(null);
  const inHomeRef = useRef<View>(null);
  const refOfSection = (id: SpotlightSectionId) =>
    id === 'total' ? totalRef : id === 'oneyear' ? oneYearRef : inHomeRef;
  const [spotlight, setSpotlight] = useState<(SpotlightState & { id: SpotlightSectionId }) | null>(null);

  const programOfSection = (id: SpotlightSectionId): DisplayProgramKey =>
    id === 'total' ? 'msrp' : id === 'oneyear' ? 'oneyear' : 'inhome';
  const priceOfSection = (id: SpotlightSectionId) =>
    id === 'total' ? msrp : id === 'oneyear' ? oneYearGrandTotal : inHomeGrandTotal;

  const enlargedRef = useRef<{ program: DisplayProgramKey; price: number; at: number } | null>(null);

  const flushEnlarged = () => {
    const open = enlargedRef.current;
    if (!open) return;
    enlargedRef.current = null;
    logInvestmentProgramMinimized({
      ...logBase,
      program: open.program,
      price: open.price,
      enlargedSeconds: Math.max(0, Math.round((Date.now() - open.at) / 1000)),
    });
  };
  const flushEnlargedRef = useRef(flushEnlarged);
  flushEnlargedRef.current = flushEnlarged;

  const openSpotlight = (id: SpotlightSectionId) => {
    const node = refOfSection(id).current;
    if (!node) return;
    node.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (!w || !h) return;
      const rect: SpotlightRect = { x, y, w, h };
      const finalScale = Math.max(
        1.02,
        Math.min(SPOTLIGHT_BASE_SCALE[id], (SPOT_SW * 0.94) / w, (SPOT_SH * 0.72) / h),
      );
      triggerHaptic('light');
      flushEnlarged();
      const program = programOfSection(id);
      const price = priceOfSection(id);
      enlargedRef.current = { program, price, at: Date.now() };
      logInvestmentProgramEnlarged({ ...logBase, program, price });
      setSpotlight({ id, rect, finalScale });
    });
  };
  const stepSpotlight = (dir: 1 | -1) => {
    if (!spotlight) return;
    const i = SPOTLIGHT_ORDER.indexOf(spotlight.id);
    openSpotlight(SPOTLIGHT_ORDER[(i + dir + SPOTLIGHT_ORDER.length) % SPOTLIGHT_ORDER.length]);
  };

  const secureLogo = useSecureLogo();
  const { user } = useAuth();
  const companyName = user?.companyName;
  const hasLogoSource = !!(user?.companyLogo || user?.profilePicture);

  const logUserId = user?._id || user?.id;
  const visitIdRef = useRef(
    `${calculator.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const logBase = {
    userId: logUserId,
    leadId: lead?._id || lead?.leadId || lead?.id,
    calculatorId: calculator.id,
    calculatorTitle: calculator.title,
    visitId: visitIdRef.current,
  };
  const logBaseOnMountRef = useRef(logBase);

  const plans = pricing.plans;
  const method = calculator.paymentMethod || pricing.defaultMethod || 'check';
  const isLowesLead = lead?.lowesLead === true;

  const seedFinancingKey = isFinancing(plans, method) ? method : '';
  const savedInHome = calculator.inHome;
  const seedAdded: string[] = Array.isArray(savedInHome?.addedPlans) && savedInHome.addedPlans.length
    ? savedInHome.addedPlans
    : seedFinancingKey ? [seedFinancingKey] : [];
  const defaultChoice = (calculator.paymentMethod || lead?.paymentMethod) && plans[calculator.paymentMethod || lead?.paymentMethod] ? (calculator.paymentMethod || lead?.paymentMethod) : '';
  const seedChoice = savedInHome?.planKey || defaultChoice;
  const [addedPlanKeys, setAddedPlanKeys] = useState<string[]>(seedAdded);
  const [paymentChoice, setPaymentChoice] = useState<string>(seedChoice);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const closeAddPlan = () => setShowAddPlan(false);
  const choiceIsFinancing = isFinancing(plans, paymentChoice);
  const selectedPlanKey = choiceIsFinancing ? paymentChoice : '';
  const inHomePlanKey = paymentChoice;
  const badgeSelection = choiceIsFinancing ? '' : paymentChoice;

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

  const confirmedPrice = Number(calculator.price) || 0;
  const endPrice = confirmedPrice;

  const seededDownPayment = resolveActiveDownPayment(calculator.dropPrice, calculator.downPayment);
  const [downText, setDownText] = useState(seededDownPayment ? String(seededDownPayment) : '');
  const [showDownInput, setShowDownInput] = useState(seededDownPayment > 0);
  const discountPct = calculator.discountPercentage || pricing.defaultPreOrder;
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
  const inHomeMonthlyBase = Math.max(0, endPrice - downPay);
  const inHomeMonthly = useMemo(
    () => calcMonthly(plans, inHomeMonthlyBase, inHomePlanKey),
    [plans, inHomeMonthlyBase, inHomePlanKey],
  );
  const inHomeShortlist = useMemo(
    () =>
      addedPlanKeys
        .filter((k) => isFinancing(plans, k))
        .map((k) => ({ key: k, monthly: calcMonthly(plans, inHomeMonthlyBase, k), terms: compactPlanLabel(plans, k) })),
    [addedPlanKeys, plans, inHomeMonthlyBase],
  );

  const persistInHome = (added: string[], selected: string, optInOverride?: 'inhome' | 'oneyear' | null) => {
    const planKey = selected && isFinancing(plans, selected) ? selected : '';
    onSetInHome?.(calculator.id, {
      planKey,
      addedPlans: added,
      apr: Number(plans[planKey]?.apr) || 0,
      monthlyPayment: calcMonthly(plans, inHomeMonthlyBase, planKey),
      grandTotal: inHomeGrandTotal,
      optInProgram: optInOverride !== undefined ? optInOverride : (selectedProgram ?? calculator.inHome?.optInProgram ?? null),
    });
  };
  const methodLabelOf = (key: string) =>
    isFinancing(plans, key) ? compactPlanLabel(plans, key) : (NON_FINANCING_BADGE[key] || plans[key]?.label || key);

  const selectPaymentChoice = (key: string) => {
    if (key && key !== paymentChoice) {
      const fin = isFinancing(plans, key);
      logInvestmentPaymentMethodSelected({
        ...logBase,
        method: key,
        methodLabel: methodLabelOf(key),
        isFinancing: fin,
        monthly: fin ? calcMonthly(plans, inHomeMonthlyBase, key) : undefined,
      });
    }
    setPaymentChoice(key);
    persistInHome(addedPlanKeys, key);
  };
  const handleAddPlan = (key: string) => {
    closeAddPlan();
    const nextAdded = addedPlanKeys.includes(key) ? addedPlanKeys : [...addedPlanKeys, key];
    if (!addedPlanKeys.includes(key)) {
      logInvestmentPlanAdded({ ...logBase, program: 'inhome', planKey: key, planLabel: compactPlanLabel(plans, key), monthly: calcMonthly(plans, inHomeMonthlyBase, key), isFinancing: isFinancing(plans, key) });
    }
    setAddedPlanKeys(nextAdded);
    setPaymentChoice(key); // adding a plan also selects it (web parity)
    persistInHome(nextAdded, key);
  };
  const handleRemovePlan = (key: string) => {
    const nextAdded = addedPlanKeys.filter((k) => k !== key);
    logInvestmentPlanRemoved({ ...logBase, program: 'inhome', planKey: key, planLabel: compactPlanLabel(plans, key) });
    const nextChoice = paymentChoice === key ? defaultChoice : paymentChoice;
    setAddedPlanKeys(nextAdded);
    setPaymentChoice(nextChoice);
    persistInHome(nextAdded, nextChoice);
  };

  const srVetDiscount = msrp * (seniorVetPct / 100);
  const preOrderDiscountVal = msrp * (discountPct / 100);

  // REVUIUX-444: same rule as the rollout card - `Default` is LIVE and rep-scoped (user.defaultOneYearPaymentMethod).
  const repOneYearKey = useMemo(() => resolveRepOneYearKey(plans, user), [plans, user?.defaultOneYearPaymentMethod]);
  const defaultOneYearKey = useMemo(
    () => resolveOneYearDefaultKey(plans, user, method),
    [plans, user?.defaultOneYearPaymentMethod, user?.defaultPaymentMethod, method],
  );
  const oneYear = calculator.oneYearMonthlyPlan;
  const oneYearMode = oneYear?.mode || (repOneYearKey ? 'default' : 'match');
  const oneYearKey =
    oneYearMode === 'match'
      ? selectedPlanKey || seedFinancingKey || defaultOneYearKey
      : oneYearMode === 'custom'
        ? oneYear?.planKey || defaultOneYearKey
        : defaultOneYearKey;
  const oneYearMonthly = useMemo(() => calcMonthly(plans, oneYearGrandTotal, oneYearKey), [plans, oneYearGrandTotal, oneYearKey]);
  const oneYearMonthlyShown = oneYearMonthly;

  useEffect(() => {
    const visitLogBase = logBaseOnMountRef.current;
    logInvestmentCalculatorViewed({
      ...visitLogBase,
      baseline: {
        msrp: { price: msrp },
        oneYear: {
          price: oneYearGrandTotal,
          monthly: oneYearMonthlyShown,
          planLabel: oneYearMonthlyShown > 0 ? compactPlanLabel(plans, oneYearKey) : undefined,
        },
        inHome: {
          price: inHomeGrandTotal,
          monthly: inHomeMonthly,
          planLabel: inHomePlanKey ? compactPlanLabel(plans, inHomePlanKey) : undefined,
        },
      },
    });
    return () => {
      flushEnlargedRef.current();
      logInvestmentCalculatorLeft(visitLogBase);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const inclusions = jobScope.length > 0 ? jobScope : productNames;

  /**
   * The same bullets, grouped under a "<categoryName> Installation:" heading.
   *
   * `descriptionsByCategory` arrives beside the flat `descriptions` list. A group with no
   * category name renders as loose bullets, which is also the whole-panel fallback when the API
   * (or an offline cache written before this field existed) sends only the flat list - so the
   * panel never goes blank on older data.
   */
  /**
   * ⚠️ Evaluated ON DEVICE when the server sent nothing.
   *
   * The lines are rendered server-side inside `GET /appointments/:id/lfcalculators` and are not
   * stored on the calculator, so a calculator built OFFLINE has none at all - the panel then fell
   * back to bare category names ("Gutters") and the scope the customer had already been shown
   * CHANGED after the sync.
   *
   * ⚠️ Server lines WIN whenever they exist. This only fills a gap; it never overrides, so an
   * online deal is byte-for-byte what it always was and nothing else on this screen moves.
   */
  const { schemas: dealCenterDescriptionSchemas } = useGetDealCenterDescriptionSchemas();
  const serverByCategory = (calculator as any)?.descriptionsByCategory;
  const serverFlat = (calculator as any)?.descriptions;
  const localDescriptions = useMemo(() => {
    const hasServer =
      (Array.isArray(serverByCategory) && serverByCategory.length > 0) ||
      (Array.isArray(serverFlat) && serverFlat.length > 0);
    if (hasServer || !dealCenterDescriptionSchemas.length) return null;
    return evaluateDealCenterDescriptions(dealCenterDescriptionSchemas, calculator);
  }, [serverByCategory, serverFlat, dealCenterDescriptionSchemas, calculator]);

  const descriptionsByCategory = serverByCategory ?? localDescriptions?.descriptionsByCategory;
  // The flat fallback prefers locally evaluated lines over bare category names.
  const scopeLines = localDescriptions?.descriptions?.length
    ? localDescriptions.descriptions
    : inclusions;
  const scopeGroups = useMemo(
    () => buildScopeGroups(descriptionsByCategory, scopeLines),
    [descriptionsByCategory, scopeLines],
  );
  const hasScopeLines = flattenScopeGroups(scopeGroups).length > 0;

  const packageInfo = useMemo(
    () => describeFullPackage(calculator.entries || {}, verticals || []),
    [calculator.entries, verticals],
  );
  const [packageInfoVisible, setPackageInfoVisible] = useState(false);
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const openPackageInfo = useCallback((rect: PackageAnchorRect | null) => {
    setPackageAnchor(rect);
    setPackageInfoVisible(true);
  }, []);

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

  const warmedRenders = useWarmedImageUris(
    useMemo(
      () => renders.flatMap((p) => [beforeUriOf(p), afterUriOf(p)]).filter(Boolean),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [renders, uriByS3]
    )
  );

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
    logInvestmentOptIn({ ...logBase, program: 'inhome', price: inHomeGrandTotal, monthly: inHomeMonthly, planKey: inHomePlanKey, downPayment: downPay });
    logInvestmentPriceSecured({ ...logBase, program: 'inhome', price: inHomeGrandTotal, monthly: inHomeMonthly, planKey: inHomePlanKey });
    onOptIn(calculator.id, { price: endPrice, paymentMethod: inHomePlanKey, downPayment: downPay });
  };

  const revertSelectedProgram = () => {
    const optingOutOf = selectedProgram;
    setSelectedProgram(null);
    persistInHome(addedPlanKeys, paymentChoice, null);
    if (optingOutOf) logInvestmentOptOut({ ...logBase, program: optingOutOf });
  };

  const onPullRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([renderSecure.refetch?.(), Promise.resolve(onRefresh?.())]);
    } finally {
      setRefreshing(false);
    }
  };

  const lastLoggedDownRef = useRef<{ inhome: number; oneyear: number }>({
    inhome: seededDownPayment,
    oneyear: 0,
  });
  const logDownPaymentChange = (program: 'inhome' | 'oneyear', amount: number) => {
    if (isLeadSold || !logUserId) return;
    if (lastLoggedDownRef.current[program] === amount) return;
    const previousAmount = lastLoggedDownRef.current[program];
    lastLoggedDownRef.current[program] = amount;
    const key = program === 'inhome' ? paymentChoice : oneYearKey;
    const fin = !!key && isFinancing(plans, key);
    const monthly = !fin
      ? undefined
      : program === 'inhome'
        ? calcMonthly(plans, Math.max(0, endPrice - (endPrice > 0 ? Math.min(amount, endPrice) : amount)), key)
        : oneYearMonthlyShown;
    const inHomeBaseFor = (dp: number) =>
      Math.max(0, endPrice - (endPrice > 0 ? Math.min(dp, endPrice) : dp));
    const planMonthlies: PlanMonthlyChange[] =
      program === 'inhome'
        ? addedPlanKeys
            .filter((k) => isFinancing(plans, k))
            .map((k) => ({
              planId: k,
              planLabel: compactPlanLabel(plans, k),
              old: calcMonthly(plans, inHomeBaseFor(previousAmount), k),
              new: calcMonthly(plans, inHomeBaseFor(amount), k),
            }))
        : [];

    logInvestmentDownPaymentChanged({
      ...logBase,
      program,
      amount,
      previousAmount,
      planMonthlies,
      selection: key ? { key, label: methodLabelOf(key), isFinancing: fin, monthly } : undefined,
    });
  };

  const renderDownEditor = (
    text: string,
    setText: (v: string) => void,
    show: boolean,
    setShow: (v: boolean) => void,
    cap: number,
    program: 'inhome' | 'oneyear',
  ) => {
    const commit = () => {
      let v = parseFloat(text) || 0;
      if (cap > 0 && v > cap) { v = cap; setText(String(v)); }
      logDownPaymentChange(program, v);
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
          keyboardType={NUMERIC_KEYBOARD}
          returnKeyType="done"
          editable={!isLeadSold}
        />
        {dp > 0 && !isLeadSold && (
          <TouchableOpacity onPress={() => { setText(''); setShow(false); logDownPaymentChange(program, 0); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color="#FF5630" />
          </TouchableOpacity>
        )}
      </View>
    ) : (
      <TouchableOpacity
        onPress={isLeadSold ? undefined : () => setShow(true)}
        disabled={isLeadSold}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: isLeadSold ? '#94A3B8' : '#2196F3',
          backgroundColor: isLeadSold ? '#F1F5F9' : '#2196F30D',
          borderRadius: 10,
          paddingVertical: 8,
          opacity: isLeadSold ? 0.8 : 1,
        }}
      >
        <Ionicons name="add" size={13} color={isLeadSold ? '#94A3B8' : '#2196F3'} />
        <Text style={{ fontSize: 10, fontWeight: '800', color: isLeadSold ? '#94A3B8' : '#2196F3' }}>
          {`Add Down Payment`}
        </Text>
      </TouchableOpacity>
    );
  };
  const inHomeDownEditor = renderDownEditor(downText, setDownText, showDownInput, setShowDownInput, endPrice, 'inhome');
  const oneYearDownEditor = renderDownEditor(oneYearDownText, setOneYearDownText, showOneYearDown, setShowOneYearDown, oneYearGrandTotal, 'oneyear');

  const oneYearRows = [
    { label: 'Total', value: fmt(msrp) },
    { label: `${seniorVetPct}% Sr + Vet`, value: `-${fmt(srVetDiscount)}`, green: true },
  ];
  const inHomeRows = [
    { label: 'Total', value: fmt(msrp) },
    { label: `${seniorVetPct}% Sr + Vet`, value: `-${fmt(srVetDiscount)}`, green: true },
    { label: `${discountPct}% Discount`, value: `-${fmt(preOrderDiscountVal)}`, green: true },
  ];
  const customer = lead?.customerDetails;
  const preparedFor = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : (lead?.jobBuilder?.scheduleTime?.customerName || 'N/A');
  const address = customer?.address || lead?.fullAddress || 'N/A';

  const formattedDate = useMemo(() => {
    let displayDate = new Date();
    const dateStr = lead?.updatedAt || lead?.leadDatetime || lead?.createdAt;
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        displayDate = parsed;
      }
    }
    try {
      return format(displayDate, 'MM/dd/yyyy, hh:mm:ss a');
    } catch (err) {
      return displayDate.toLocaleString();
    }
  }, [lead]);

  const repName = lead?.assignedRep || (lead?.assignedRepDetails ? `${lead.assignedRepDetails.firstName || ''} ${lead.assignedRepDetails.lastName || ''}`.trim() : '');
  const regionID = lead?.assignedRepDetails?.region?.[0]?.regionID || '';
  const repText = regionID ? `${repName} · ${regionID}` : (repName || 'N/A');

  const maxProgramRows = Math.max(oneYearRows.length, inHomeRows.length);

  const totalCardEl = (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' }}>
      <View style={{ backgroundColor: '#1E293B', paddingVertical: 12, alignItems: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 1, paddingLeft: 1, textAlign: 'center' }}>TOTAL INVESTMENT</Text>
      </View>
      <View style={{ backgroundColor: '#fff', paddingVertical: 22, alignItems: 'center' }}>
        <Text style={{ fontSize: 34, fontWeight: '900', color: '#15803D' }}>{fmt(msrp)}</Text>
      </View>
    </View>
  );
  const oneYearCardEl = (
    <ProgramCard
      title="1 YEAR PROGRAM"
      priceLock
      rows={oneYearRows}
      reserveRows={maxProgramRows}
      grandTotal={oneYearGrandTotal}
      badges={basicBadges}
      selectedBadgeKey={badgeSelection}
      onSelectBadge={selectPaymentChoice}
      downPaymentSlot={oneYearDownEditor}
      monthly={oneYearMonthlyShown}
      planLabel={oneYearMonthlyShown > 0 ? compactPlanLabel(plans, oneYearKey) : undefined}
      selected={selectedProgram === 'oneyear'}
      crossedOff={selectedProgram === 'inhome'}
      optInLabel="Opt In (1-Yr)"
      onOptIn={() => {
        const next = selectedProgram === 'oneyear' ? null : 'oneyear';
        setSelectedProgram(next);
        persistInHome(addedPlanKeys, paymentChoice, next);
        if (next === 'oneyear') {
          logInvestmentOptIn({ ...logBase, program: 'oneyear', price: oneYearGrandTotal, monthly: oneYearMonthlyShown, planKey: oneYearKey });
          logInvestmentPriceSecured({ ...logBase, program: 'oneyear', price: oneYearGrandTotal, monthly: oneYearMonthlyShown, planKey: oneYearKey });
        } else {
          logInvestmentOptOut({ ...logBase, program: 'oneyear' });
        }
      }}
      onRevert={revertSelectedProgram}
      readOnly={isLeadSold}
    />
  );
  const inHomeCardEl = (
    <ProgramCard
      title="IN-HOME PRE ORDER"
      highlighted
      rows={inHomeRows}
      reserveRows={maxProgramRows}
      grandTotal={inHomeGrandTotal}
      badges={basicBadges}
      selectedBadgeKey={badgeSelection}
      onSelectBadge={isLeadSold ? undefined : selectPaymentChoice}
      planInteractive
      shortlistPlans={inHomeShortlist}
      selectedPlanKey={selectedPlanKey}
      onSelectPlan={isLeadSold ? undefined : selectPaymentChoice}
      onRemovePlan={isLeadSold ? undefined : handleRemovePlan}
      onAddPlan={isLeadSold ? undefined : () => setShowAddPlan(true)}
      downPaymentSlot={isLeadSold ? undefined : inHomeDownEditor}
      downPayment={isLeadSold ? (calculator.downPayment || lead?.downPayment || 0) : downPay}
      selected={activeProgram === 'inhome'}
      crossedOff={activeProgram === 'oneyear'}
      optInLabel="Opt In"
      onOptIn={() => {
        setSpotlight(null);
        setSelectedProgram('inhome');
        setShowConfirm(true);
        persistInHome(addedPlanKeys, paymentChoice, 'inhome');
      }}
      onRevert={revertSelectedProgram}
      readOnly={isLeadSold}
    />
  );
  const spotlightCardEl =
    spotlight?.id === 'total'
      ? totalCardEl
      : spotlight?.id === 'oneyear'
        ? <View style={{ flexDirection: 'row' }}>{oneYearCardEl}</View>
        : spotlight?.id === 'inhome'
          ? <View style={{ flexDirection: 'row' }}>{inHomeCardEl}</View>
          : null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor="#4CBB17" colors={['#4CBB17']} />}
    >
      {/* Company branding — dynamic logo + company name (web parity), else the
          Leaf Filter wordmark fallback. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 32, marginBottom: 12 }}>
        {!!secureLogo && (
          <Image source={{ uri: secureLogo }} style={{ height: 32, width: 120 }} resizeMode="contain" />
        )}
        {/* The logo stands alone; the company name is only the fallback when there is no logo
            (the heading below already says "Your Investment With {company}"). */}
        {/* While a logo is configured but still resolving, show nothing — the name text flashed
            before the logo on every calculator-tab switch. */}
        {secureLogo || hasLogoSource ? null : companyName ? (
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
                    <Image source={{ uri: warmedRenders[b] || b }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', textAlign: 'center', paddingVertical: 4 }}>BEFORE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.85} disabled={!a} onPress={() => a && setViewerIndex(i)} style={{ flex: 1 }}>
                    <Image source={{ uri: warmedRenders[a] || a }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
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
        {packageInfo.isFullPackage && (
          <View style={{ alignItems: 'center', paddingVertical: 4, marginBottom: 14 }}>
            <FullPackageTitle
              isFullPackage
              extras={packageInfo.extras}
              title={calculator.title}
              size={22}
              color="#1C252E"
              iconColor="#16A34A"
              onInfo={openPackageInfo}
            />
          </View>
        )}
        {!hasScopeLines ? (
          <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', fontStyle: 'italic' }}>
            Job scope will appear once products are configured.
          </Text>
        ) : (
          scopeGroups.map((group, gi) => (
            <View key={gi} style={{ marginBottom: gi < scopeGroups.length - 1 ? 6 : 0 }}>
              {/* A group with no category name keeps the original look: bullets, no heading. */}
              {!!group.heading && (
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '800',
                    color: '#16324F',
                    marginBottom: 8,
                    marginTop: gi === 0 ? 0 : 6,
                    paddingHorizontal: 4,
                  }}
                >
                  {group.heading}
                </Text>
              )}
              {group.lines.map((line, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    marginBottom: 10,
                    paddingHorizontal: 4,
                    paddingLeft: group.heading ? 10 : 4,
                  }}
                >
                  {/* Black under a trade heading; an uncategorised bullet keeps the original
                      green, so that group looks exactly as it always has. */}
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: group.heading ? '#1C252E' : '#4CBB17',
                      marginTop: 7,
                      marginRight: 10,
                    }}
                  />
                  <Text style={{ flex: 1, fontSize: 14, color: '#1C252E', lineHeight: 20 }}>{line}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>

      {/* Total Investment (MSRP) — tap to spotlight-zoom it. */}
      <Pressable ref={totalRef} collapsable={false} onPress={() => openSpotlight('total')}>
        {totalCardEl}
      </Pressable>

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
          LOCK badge that sits above the 1-Year card. Each card is a measurable
          spotlight anchor (a tap on the card body zooms it; the inner buttons —
          badges / opt-in / down-payment — are deeper touchables and still fire). */}
      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 14 }}>
        <Pressable ref={oneYearRef} collapsable={false} onPress={() => openSpotlight('oneyear')} style={{ flex: 1 }}>
          {oneYearCardEl}
        </Pressable>
        <Pressable ref={inHomeRef} collapsable={false} onPress={() => openSpotlight('inhome')} style={{ flex: 1 }}>
          {inHomeCardEl}
        </Pressable>
      </View>

      {/* Its own `Modal`: the panel renders inside a navigable SCREEN, so there is
          no host sheet to stack inside. Positioned against the ⓘ that was tapped. */}
      <FullPackageInfoModal
        visible={packageInfoVisible}
        onClose={() => setPackageInfoVisible(false)}
        anchorRect={packageAnchor}
      />

      <OptInConfirmModal
        visible={showConfirm}
        price={inHomeGrandTotal}
        monthly={inHomeMonthly}
        planLabel={inHomeMonthly > 0 ? compactPlanLabel(plans, inHomePlanKey) : undefined}
        downPayment={downPay}
        method={paymentChoice}
        isLowesLead={lead?.lowesLead === true}
        onConfirm={confirmInHome}
        onClose={() => {
          setShowConfirm(false);
          setSelectedProgram(null);
          persistInHome(addedPlanKeys, paymentChoice, null);
          logInvestmentOptOut({ ...logBase, program: 'inhome', cancelledBeforeConfirm: true });
        }}
      />

      {/* "+ Add Plan" financing picker for the In-Home Monthly shortlist. Gates on
          the current end price (− down payment) and adds financing plans only. */}
      <AddPlanModal
        visible={showAddPlan && !spotlight}
        price={inHomeMonthlyBase}
        plans={plans}
        categories={pricing.dropAddCategories}
        added={addedPlanKeys}
        onAdd={handleAddPlan}
        onClose={closeAddPlan}
      />

      {/* Lead details footer shown when lead is sold */}
      {isLeadSold && (
        <View style={{
          backgroundColor: '#F1F5F9',
          borderRadius: 12,
          padding: 16,
          marginTop: 24,
          borderWidth: 1,
          borderColor: '#E2E8F0',
        }}>
          <Text style={{ fontSize: 13, color: '#475569', lineHeight: 20, marginBottom: 6 }}>
            <Text style={{ fontWeight: 'bold' }}>Prepared for: </Text>
            {preparedFor}
          </Text>
          <Text style={{ fontSize: 13, color: '#475569', lineHeight: 20, marginBottom: 6 }}>
            <Text style={{ fontWeight: 'bold' }}>Address: </Text>
            {address}
          </Text>
          <Text style={{ fontSize: 13, color: '#475569', lineHeight: 20, marginBottom: 6 }}>
            <Text style={{ fontWeight: 'bold' }}>Date: </Text>
            {formattedDate}
          </Text>
          <Text style={{ fontSize: 13, color: '#475569', lineHeight: 20 }}>
            <Text style={{ fontWeight: 'bold' }}>Rep: </Text>
            {repText}
          </Text>
        </View>
      )}

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
        moduleType="investment_center"
      />

      {/* Spotlight zoom — the tapped card flies from its place to screen-center,
          dims the rest, and the bottom pill steps through all three sections. */}
      <SpotlightOverlay
        spotlight={spotlight}
        title={spotlight ? SPOTLIGHT_TITLE[spotlight.id] : ''}
        onClosed={() => {
          flushEnlarged();
          setSpotlight(null);
        }}
        onPrev={() => stepSpotlight(-1)}
        onNext={() => stepSpotlight(1)}
        overlay={
          spotlight && showAddPlan ? (
            <AddPlanModal
              inline
              visible
              price={inHomeMonthlyBase}
              plans={plans}
              categories={pricing.dropAddCategories}
              added={addedPlanKeys}
              onAdd={handleAddPlan}
              onClose={closeAddPlan}
            />
          ) : null
        }
      >
        {spotlightCardEl}
      </SpotlightOverlay>
    </ScrollView>
  );
}
