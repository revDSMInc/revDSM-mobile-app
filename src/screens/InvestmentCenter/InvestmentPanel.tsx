import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl, Platform, Pressable, Dimensions } from 'react-native';
import { format } from 'date-fns';
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

// ── Spotlight zoom: the three cards a tap can lift off the page, in step order. ─
const { width: SPOT_SW, height: SPOT_SH } = Dimensions.get('window');
type SpotlightSectionId = 'total' | 'oneyear' | 'inhome';
const SPOTLIGHT_ORDER: SpotlightSectionId[] = ['total', 'oneyear', 'inhome'];
const SPOTLIGHT_TITLE: Record<SpotlightSectionId, string> = {
  total: 'TOTAL INVESTMENT',
  oneyear: '1 YEAR PROGRAM',
  inhome: 'IN-HOME PRE ORDER',
};
// Target zoom per section. The near-full-width Total card can only enlarge a touch
// (it would overflow otherwise); the half-width program cards zoom in properly.
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
  /** Persist the In-Home Monthly shortlist to `lfcalculator.in_home` (debounced). */
  onSetInHome?: (calculatorId: string, inHome: { planKey?: string; addedPlans?: string[]; apr?: number; monthlyPayment?: number; grandTotal?: number; optInProgram?: 'inhome' | 'oneyear' | null }) => void;
  /** Pull-to-refresh hook from the screen (refetch calculators / lead). */
  onRefresh?: () => void;
}

export function InvestmentPanel({ calculator, pricing, verticals, pricingConfig, jobBuilderConfig, descriptionSchemas, lead, onOptIn, onSetInHome, onRefresh }: Props) {
  const isLeadSold = lead?.status === 'sale';
  const [selectedProgram, setSelectedProgram] = useState<'inhome' | 'oneyear' | null>(
    calculator.inHome?.optInProgram ?? null,
  );
  const activeProgram = isLeadSold ? (selectedProgram || 'inhome') : selectedProgram;
  const [showConfirm, setShowConfirm] = useState(false);
  // Which render pair the before/after slider viewer is open on (null = closed).
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Spotlight zoom state ─────────────────────────────────────────────────────
  // Tapping a card (Total Investment / 1-Year / In-Home) lifts it to screen center,
  // dims the rest, and lets the rep step between the three sections. Each section is
  // wrapped in a measurable anchor so the enlarged copy can fly out from — and back
  // into — its real place.
  const totalRef = useRef<View>(null);
  const oneYearRef = useRef<View>(null);
  const inHomeRef = useRef<View>(null);
  const refOfSection = (id: SpotlightSectionId) =>
    id === 'total' ? totalRef : id === 'oneyear' ? oneYearRef : inHomeRef;
  const [spotlight, setSpotlight] = useState<(SpotlightState & { id: SpotlightSectionId }) | null>(null);

  // ── Forever Record: enlarge / minimize (REVUIUX-505) ─────────────────────────
  // The spotlight IS the handoff's enlarge: 'total' is the MSRP card.
  const programOfSection = (id: SpotlightSectionId): DisplayProgramKey =>
    id === 'total' ? 'msrp' : id === 'oneyear' ? 'oneyear' : 'inhome';
  const priceOfSection = (id: SpotlightSectionId) =>
    id === 'total' ? msrp : id === 'oneyear' ? oneYearGrandTotal : inHomeGrandTotal;

  // What is enlarged right now, and since when, so the minimize can report how long
  // the customer looked at it.
  const enlargedRef = useRef<{ program: DisplayProgramKey; price: number; at: number } | null>(null);

  /**
   * Close the open enlarge, if any. Called when another card is enlarged, when the
   * spotlight closes, and on unmount — the handoff's "if never minimized, close it at
   * scope switch or exit", without which that viewing time is never recorded.
   */
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
  // Unmount runs the cleanup from the FIRST render, so the flush is reached through a
  // ref rather than that stale closure.
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
      // Stepping from one card to another minimizes the old one first, so the two
      // never overlap in the record.
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

  // Company branding (web parity: investment-panel.js) — the tenant's dynamic logo +
  // company name from the authed user, same source the agreement generator uses.
  const secureLogo = useSecureLogo();
  const { user } = useAuth();
  const companyName = user?.companyName;

  // Forever Record (activity log) identity for this panel — every opt-in/out, plan
  // add/remove, payment-method and down-payment event carries this calculator + lead.
  const logUserId = user?._id || user?.id;
  // One VISIT into this job scope (REVUIUX-505). The panel is keyed by tab id, so a
  // mount IS an entry into the scope and this id lasts exactly as long as the visit —
  // the Forever Record groups a scope's events into VISIT blocks by it, instead of
  // inferring where one visit ends and the next begins.
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
  // The panel's DEFAULT payment selection = the method the rep actually chose in the Deal
  // Center (web parity: `defaultPlanKey = calculator.paymentMethod && plans[...] ? ... : ''`).
  // It stays EMPTY when the calculator has no saved method, so NOTHING is pre-selected on
  // landing — a CK badge lights up only when the deal-center method IS `check`. NOTE: this
  // deliberately does NOT use `method`'s `'check'` fallback (which was pre-selecting CK for
  // everyone regardless of what the rep picked upstream).
  const defaultChoice = (calculator.paymentMethod || lead?.paymentMethod) && plans[calculator.paymentMethod || lead?.paymentMethod] ? (calculator.paymentMethod || lead?.paymentMethod) : '';
  const seedChoice = savedInHome?.planKey || defaultChoice;
  const [addedPlanKeys, setAddedPlanKeys] = useState<string[]>(seedAdded);
  // Single "active payment choice" for the WHOLE panel — SHARED by BOTH program cards
  // (web parity: one payment method per lead). It holds EITHER a financing plan key
  // (→ a "Monthly" shortlist row is selected on In-Home; no basic badge) OR a basic method
  // key (→ the SAME CK/CC/AMEX badge lights up on BOTH cards; no shortlist row). Because
  // every badge/plan control writes this one value: (a) selecting a badge on one card
  // selects it on both, and (b) badges and the monthly plan are mutually exclusive.
  const [paymentChoice, setPaymentChoice] = useState<string>(seedChoice);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const closeAddPlan = () => setShowAddPlan(false);
  const choiceIsFinancing = isFinancing(plans, paymentChoice);
  // Shortlist highlight + monthly/opt-in driver: the choice when it's a financing plan
  // (empty when a basic method is active — no monthly row is selected then).
  const selectedPlanKey = choiceIsFinancing ? paymentChoice : '';
  const inHomePlanKey = paymentChoice;
  // Basic CK/CC/AMEX badge highlight — SHARED by both cards: the choice when it's a basic
  // method; none when a financing plan is the active choice (a monthly row is selected).
  const badgeSelection = choiceIsFinancing ? '' : paymentChoice;

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

  // The Investment Center ALWAYS presents the CONFIRMED rollout price. A price the rep
  // dropped/negotiated in the deal center (an "accepted" dropPrice entry) must NOT change
  // any Investment Center figure — MSRP, the two program grand totals and the monthly all
  // stay based on the rollout-confirmed price. (Product decision: "don't ever change it on
  // drops.") Drops remain recorded on the calculator; they're just not reflected here.
  const confirmedPrice = Number(calculator.price) || 0;
  const endPrice = confirmedPrice;

  // The down payment the deal ALREADY carries: the secured (or last-negotiated) drop's,
  // else the rollout card's. The drop modal stores its down payment on the drop ROW, not
  // on the calculator, so seeding from `calculator.downPayment` alone opened this screen
  // on "Add Down Payment" for a deal that already had one -- and opting in then resulted
  // the sale at $0 down, leaving Contract Details with no down payment.
  const seededDownPayment = resolveActiveDownPayment(calculator.dropPrice, calculator.downPayment);
  // Live-adjustable during the presentation.
  const [downText, setDownText] = useState(seededDownPayment ? String(seededDownPayment) : '');
  const [showDownInput, setShowDownInput] = useState(seededDownPayment > 0);
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
  // Human label for a method/plan key — financing → compact plan label, basic → its
  // CK/CC/AMEX/ACH badge (else the plan's own label). Used for the Forever Record.
  const methodLabelOf = (key: string) =>
    isFinancing(plans, key) ? compactPlanLabel(plans, key) : (NON_FINANCING_BADGE[key] || plans[key]?.label || key);

  // The one write path for the shared choice — used by BOTH cards' CK/CC/AMEX badges AND
  // the In-Home shortlist rows. Selecting any of them lights it up on both cards and
  // deselects the other kind (badge ⇄ monthly), because they all read this single value.
  const selectPaymentChoice = (key: string) => {
    // Log the selection to the Forever Record only when it actually changes.
    if (key && key !== paymentChoice) {
      const fin = isFinancing(plans, key);
      logInvestmentPaymentMethodSelected({
        ...logBase,
        method: key,
        methodLabel: methodLabelOf(key),
        isFinancing: fin,
        // A financing plan carries its $/mo (parity with `investment_plan_added`);
        // basic cash/card methods have none, so it's omitted for them.
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
      // The shortlist is In-Home's (see `persistInHome`), so the row is tagged with it.
      logInvestmentPlanAdded({ ...logBase, program: 'inhome', planKey: key, planLabel: compactPlanLabel(plans, key), monthly: calcMonthly(plans, inHomeMonthlyBase, key), isFinancing: isFinancing(plans, key) });
    }
    setAddedPlanKeys(nextAdded);
    setPaymentChoice(key); // adding a plan also selects it (web parity)
    persistInHome(nextAdded, key);
  };
  const handleRemovePlan = (key: string) => {
    const nextAdded = addedPlanKeys.filter((k) => k !== key);
    logInvestmentPlanRemoved({ ...logBase, program: 'inhome', planKey: key, planLabel: compactPlanLabel(plans, key) });
    // If the removed plan was the active choice, revert to the deal-center default
    // (empty when none) rather than leaving a dangling selection.
    const nextChoice = paymentChoice === key ? defaultChoice : paymentChoice;
    setAddedPlanKeys(nextAdded);
    setPaymentChoice(nextChoice);
    persistInHome(nextAdded, nextChoice);
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
  // In-Home financing selection — the plan the rep actually picked — rather than snapping
  // to the 9.99% default (which showed "GS… 9.99% APR" even after Wells Fargo was chosen).
  // `'match'` resolves to a FINANCING key that stays stable while the rep toggles the
  // shared basic badges: the live In-Home shortlist pick (`selectedPlanKey`), else the
  // deal-center financing method (`seedFinancingKey`), else the 9.99% default — so the
  // 1-Year monthly never blanks out when CK/CC/AMEX is selected. `'default'` keeps the
  // 9.99% plan; `'custom'` pins the saved plan key.
  const oneYearMode = oneYear?.mode || 'match';
  const oneYearKey =
    oneYearMode === 'match'
      ? selectedPlanKey || seedFinancingKey || defaultOneYearKey
      : oneYearMode === 'custom'
        ? oneYear?.planKey || defaultOneYearKey
        : defaultOneYearKey;
  const oneYearMonthly = useMemo(() => calcMonthly(plans, oneYearGrandTotal, oneYearKey), [plans, oneYearGrandTotal, oneYearKey]);
  // The 1-Year monthly ALWAYS shows, regardless of the active CK/CC/AMEX/financing
  // choice — the 1-Year Program is a standalone free-financing quote, so its monthly
  // (from `oneYearKey`, which stays on a valid financing plan even when a basic
  // cash/card badge is selected) is presented at all times.
  const oneYearMonthlyShown = oneYearMonthly;

  // ── Forever Record: the VISIT into this job scope (REVUIUX-505) ──────────────
  // Mount = the rep entered this scope; unmount = switched tab or left the screen.
  // The scope-view event carries the BASELINE the Foundation card renders: the prices
  // as the scope opened, before any discount or payment chip.
  useEffect(() => {
    // Pinned for the cleanup: the visit's identity cannot change while it is open.
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
      // A card left enlarged still owes its minimize, and the visit still owes its end.
      flushEnlargedRef.current();
      logInvestmentCalculatorLeft(visitLogBase);
    };
    // Deliberately once per mount: one visit, one pair of events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /**
   * Is this calculator a FULL PACKAGE (Gutter + guard + Soffit + Trim wrap)?
   *
   * When it is, the box + ⓘ REPLACES the inclusions list above — the same swap the
   * Deal Center makes wherever it would otherwise spell the combination out as
   * `G+Versa+S+FWrap`. Same rule and same source of truth (`describeFullPackage`
   * over this calculator's own live entries), so a calculator cannot present as a
   * package on one surface and as a list of its parts on another.
   *
   * ⚠️ It replaces the list on BOTH its branches — the product-name fallback AND
   * real job-scope descriptions. That is the requirement as given ("i need to show
   * the box with information icon"), and it means a package's scope sentences are
   * not shown on this screen at all; the ⓘ card carries what it includes instead.
   * A calculator that is NOT a package still lists everything exactly as before.
   */
  const packageInfo = useMemo(
    () => describeFullPackage(calculator.entries || {}, verticals || []),
    [calculator.entries, verticals],
  );
  // Anchored to the tapped ⓘ so the card opens directly beneath it rather than at
  // a fixed screen edge — the panel scrolls, so the position is only knowable now.
  const [packageInfoVisible, setPackageInfoVisible] = useState(false);
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const openPackageInfo = useCallback((rect: PackageAnchorRect | null) => {
    setPackageAnchor(rect);
    setPackageInfoVisible(true);
  }, []);

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
    // Forever Record: the In-Home opt-in is committed here (the card's Opt In only
    // opens the confirmation modal — this is the actual acceptance).
    logInvestmentOptIn({ ...logBase, program: 'inhome', price: inHomeGrandTotal, monthly: inHomeMonthly, planKey: inHomePlanKey, downPayment: downPay });
    // The customer accepted a price here — the scope's closing event.
    logInvestmentPriceSecured({ ...logBase, program: 'inhome', price: inHomeGrandTotal, monthly: inHomeMonthly, planKey: inHomePlanKey });
    onOptIn(calculator.id, { price: endPrice, paymentMethod: inHomePlanKey, downPayment: downPay });
  };

  // Opt-out via the ✕ on a crossed-off card. The ✕ renders on the OPPOSITE card from
  // the selected plan (a plan is crossed off only while the OTHER plan is selected —
  // the rep must opt out before switching), so pressing it cancels the CURRENTLY
  // SELECTED program. The Forever Record therefore logs `selectedProgram` (the plan
  // actually being opted out of), NOT the card the ✕ happens to sit on — otherwise a
  // 1-Year opt-out was mis-recorded as `inhome` (and vice-versa). Both cards share this.
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

  // Forever Record: log a down-payment change once per distinct value per program
  // (commit fires on both blur and end-editing, so dedupe against the last logged
  // amount; seeded from the down payment the deal opened with). The panel remounts
  // per calculator (keyed by tab id), so these refs reset with it.
  const lastLoggedDownRef = useRef<{ inhome: number; oneyear: number }>({
    inhome: seededDownPayment,
    oneyear: 0,
  });
  const logDownPaymentChange = (program: 'inhome' | 'oneyear', amount: number) => {
    if (isLeadSold || !logUserId) return;
    if (lastLoggedDownRef.current[program] === amount) return;
    const previousAmount = lastLoggedDownRef.current[program];
    lastLoggedDownRef.current[program] = amount;
    // The plan/method ALREADY selected on this card travels with the log. In-Home's is the
    // shared choice (a financing plan or a CK/CC/AMEX badge) and its $/mo is recomputed
    // for the NEW down payment (this runs before the state has re-rendered); 1-Year always
    // shows its financing plan's monthly.
    const key = program === 'inhome' ? paymentChoice : oneYearKey;
    const fin = !!key && isFinancing(plans, key);
    const monthly = !fin
      ? undefined
      : program === 'inhome'
        ? calcMonthly(plans, Math.max(0, endPrice - (endPrice > 0 ? Math.min(amount, endPrice) : amount)), key)
        : oneYearMonthlyShown;
    // A down payment is program-level: it re-prices EVERY plan in the program, so the
    // Forever Record lists each one's monthly before and after (and, on a removal, the
    // monthlies restored) rather than only the plan that happened to be selected.
    //
    // In-Home only: the 1-Year monthly is quoted off `oneYearGrandTotal` and does not
    // subtract its down payment, so there is no before/after to report for it.
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

  // Reusable editable down-payment control — In-Home and 1-Year each have their own
  // (web parity: "Down payment — shown on both cards, each independent").
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

  // The three spotlight-able cards, built once so the SAME element renders both in
  // place (inside its measurable anchor) and enlarged inside the SpotlightOverlay.
  // They're prop-driven/stateless, so rendering an element in two places is safe.
  const totalCardEl = (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#fff' }}>
      <View style={{ backgroundColor: '#1E293B', paddingVertical: 12, alignItems: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>TOTAL INVESTMENT</Text>
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
        // Forever Record: 1-Year Opt In is a direct toggle (no confirm modal).
        if (next === 'oneyear') {
          logInvestmentOptIn({ ...logBase, program: 'oneyear', price: oneYearGrandTotal, monthly: oneYearMonthlyShown, planKey: oneYearKey });
          // 1-Year has no confirmation modal, so the opt-in itself secures the price —
          // logged explicitly so both programs close a scope the same way.
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
      // The picker opens as an overlay INSIDE the spotlight Modal, so the enlarged card stays up.
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
  // The program cards' root is `flex: 1` — in place that fills width inside a ROW.
  // The overlay stacks content in a column, where `flex: 1` would collapse the card
  // to zero height, so wrap them in a row here (the Total card is a plain block and
  // needs no wrapper).
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
      // Keep a focused input (e.g. the down-payment field) above the keyboard. iOS
      // adjusts the scroll insets and scrolls the field into view; Android relies on
      // the activity's adjustResize windowSoftInputMode (app parity with the job builder).
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
        {secureLogo ? null : companyName ? (
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
        {packageInfo.isFullPackage && (
          /* A full package: the box + ⓘ (which carries the Gutter / Soffit / FWrap /
             (Versa OR VMax) breakdown) sits ABOVE the job-scope list. It used to REPLACE
             the list; the customer-facing screen now shows both, so the scope sentences
             are readable without opening the ⓘ. Centred, at presentation size. */
          <View style={{ alignItems: 'center', paddingVertical: 4, marginBottom: 14 }}>
            <FullPackageTitle
              isFullPackage
              extras={packageInfo.extras}
              size={22}
              color="#1C252E"
              iconColor="#16A34A"
              onInfo={openPackageInfo}
            />
          </View>
        )}
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
          // Forever Record: pending In-Home opt-in dismissed at the confirmation
          // step (never committed) — recorded as a cancelled opt-out.
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
        // Opened from the Investment Center → attribute the gallery's activity logs to
        // the presentation, not the RevRender tool (web/Lead Center parity).
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
