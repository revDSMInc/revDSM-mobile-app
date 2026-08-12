import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { BlurView } from '@react-native-community/blur';
import { MODAL_BLUR_AMOUNT, MODAL_SCRIM } from './modal-chrome';
import { useTheme } from '../../../theme/ThemeProvider';
import type { CalculatorEntry, CalculatorSchema } from '../types/calculator';
import { buildCategoryMeta, styleForKey } from '../utils/icon-color';
import { DealPricing } from '../hooks/useDealPricing';
import { FlashMessage } from '../../../config/message';
import { unitSuffix, labelWithSection } from '../utils/item-format';
import { describeFullPackage } from '../utils/tab-naming';
import { FullPackageTitle, FullPackageInfoOverlay, type PackageAnchorRect } from './FullPackageBadge';
import { useOutcomeLogging } from '../../../hooks/useOutcomeLogging';
import { useAuth } from '../../../hooks/useAuth';
import { FUND } from './funding/funding-theme';
import { PaymentRowsGroup } from './funding/PaymentRowsGroup';
import { FundingView } from './funding/FundingView';
import { SendLinkModal } from './funding/SendLinkModal';
import { useFunding } from '../hooks/useFunding';
import type { FundingChannel, FundingPaymentRow, FundingRecord } from '../../../services/api/FundingService';
import {
  applyDecisionsToRows,
  assignedTotal,
  attemptLog,
  coverageOK,
  effectiveRowAmount,
  formatStamp,
  fundingBlockers,
  hasDecline,
  hydrateRowsFromRecord,
  MULTI_METHOD_ENABLED,
  needsAttentionRowId,
  newPaymentId,
  toUpsertRows,
  type DecisionBanner,
  type PaymentRow,
} from '../utils/funding';

/**
 * The full **Result Lead** sheet.
 *
 * It is now TWO screens behind one header (mockup `screenResult` / `screenFunding`):
 *
 *  1. **Result Lead** — One Leg, Result, and a *Pricing* panel where the contract
 *     price is split across as many payment methods as the deal needs (see
 *     `funding/PaymentRowsGroup`). Job Summary and the Versatile/Pineapple toggles
 *     are unchanged.
 *  2. **Funding** — one card per payment, each driven to the end of its own life
 *     cycle before the job can be submitted (see `funding/FundingView`).
 *
 * The two talk to each other in both directions: **Confirm** projects the pricing
 * rows into funding payments, and coming back (Back / *Edit payments*) folds any
 * lender decision onto the rows it came from — a declined row locks at $0 and the
 * contract price unlocks, because a decision the lender made is a fact the rep now
 * has to price around.
 *
 * The **Demo** branch is untouched: a demo has nothing to fund, so it keeps the
 * original single-screen form and the Build Job button.
 */

const ONE_LEG_OPTIONS = ['No', 'MR', 'MRS'];

// Same 19 reasons the regular outcome flow uses (ResultViews.tsx demoReasons).
// These stay STATIC intentionally: demo/result reasons have NO backend endpoint
// on either platform — the web hardcodes them everywhere too. Payment plans and
// discount tiers are the only dynamic (backend-driven) data (see useDealPricing).
const DEMO_REASONS = [
  // Straight apostrophe in "Didn't Like" to match the web reason string byte-for-byte
  // (web uses U+0027); a curly apostrophe would fork the persisted/reported reason.
  "Can't Afford", "Didn't Like", 'DIY', 'Lowes Demo', 'Lowes Pending Sale',
  'Lowes Rehash', 'Moving', 'No Job', 'No Need / Want', 'No Snap Decision',
  'Other Projects', 'Rental Property', 'Rushed - No Time', 'Shop Around',
  'Talk to Spouse', 'Think About It', 'Too Much Money', 'Would Not Commit',
  'Other (Explain)',
];

/** Amounts are money; compare with a cent of slack rather than exactly. */
const EPS = 0.01;

const PRICE_UNLOCK_HINT =
  'Unlocked because a lender decision changed what this job can fund. Lower the price if you are rewriting the deal.';

interface ResultJobModalProps {
  visible?: boolean;
  /** The lead — needed to fire the `lead_result_field_entry` outcome logs (web parity). */
  lead?: any;
  calculatorTitle?: string;
  resultType?: 'sale' | 'demo' | null;
  /** prefill for the contract price (the rollout end / latest drop price) */
  initialPrice?: number;
  /** prefill for the payment method from the calculator's selected plan (web parity) */
  initialPaymentMethod?: string;
  /** prefill for the down payment carried from a secured/viewed drop price */
  initialDownPayment?: number;
  /** entered line items → the Job Summary card */
  entries?: Record<string, CalculatorEntry>;
  /** all configured verticals — used to resolve Job Summary category pills + icons */
  verticals?: CalculatorSchema[];
  /** sectionId → label, so Job Summary rows read "5' 5" Gutter/DS/E (All Stories)". */
  sectionLabelMap?: Record<string, string>;
  isLowesLead?: boolean;
  /** Backend-driven payment plans + discount config (static fallback). */
  pricing: DealPricing;
  onClose?: () => void;
  onConfirm?: (data: {
    resultType: 'sale' | 'demo';
    oneLeg?: string;
    contractPrice?: number;
    /** Demo only: the last price quoted (web `lastPriceQuoted`), previously dropped on mobile. */
    lastPriceQuoted?: number;
    downPayment?: number;
    balance?: number;
    downPaymentMethod?: string;
    balancePaymentMethod?: string;
    demoReason?: string;
    reasonExplanation?: string;
    versatile?: boolean;
    pineapple?: boolean;
    /**
     * Sale only — the funding record as the SERVER holds it once Submit landed.
     * `payments` is the full multi-method breakdown; the four fields above stay
     * populated (first/summed) so every existing consumer of the outcome payload
     * keeps working unchanged.
     */
    bankDecline?: boolean;
    payments?: FundingPaymentRow[];
    fundingAttempts?: FundingRecord['attemptHistory'];
  }) => void;
}

/** Floating-label helper shared by every field (notched-outline look, web parity). */
function FloatingLabel({ text, error, bg = '#fff' }: { text: string; error?: boolean; bg?: string }) {
  return (
    <Text style={{ position: 'absolute', top: -8, left: 12, zIndex: 10, paddingHorizontal: 4, backgroundColor: bg, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, color: error ? '#EF4444' : '#000' }}>
      {text}
    </Text>
  );
}

/** Dropdown select — options render inline (in-flow) below the box, like the regular. */
function SelectField({ label, value, placeholder, options, onSelect, disabled, capitalize, error, bg }: {
  label: string; value: string; placeholder: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void; disabled?: boolean; capitalize?: boolean; error?: boolean; bg?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: 20, position: 'relative' }}>
      <FloatingLabel text={label} error={error} bg={bg} />
      <TouchableOpacity
        activeOpacity={0.8}
        disabled={disabled}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, borderColor: error ? '#EF4444' : open ? '#1C252E' : '#919EAB33', backgroundColor: disabled ? '#F4F6F8' : '#fff' }}
      >
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: selected ? (disabled ? '#919EAB' : '#1C252E') : '#919EAB', textTransform: capitalize ? 'capitalize' : 'none' }}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name={disabled ? 'lock-closed' : open ? 'chevron-up' : 'chevron-down'} size={18} color="#919EAB" />
      </TouchableOpacity>
      {open && !disabled && (
        <View style={{ borderWidth: 1, borderColor: '#1C252E', borderRadius: 8, backgroundColor: '#F8FAFC', marginTop: 4, overflow: 'hidden' }}>
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <TouchableOpacity
                key={o.value}
                onPress={() => { onSelect(o.value); setOpen(false); }}
                style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#919EAB14', backgroundColor: isSel ? '#F4F6F8' : 'transparent' }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: isSel ? '#1C252E' : '#637381', textTransform: capitalize ? 'capitalize' : 'none' }}>{o.label}</Text>
                {isSel && <Ionicons name="checkmark" size={16} color="#1C252E" />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

/* NOTE: the old single-select `BalancePaymentField` lived here. The balance is now
   one line per method inside `funding/PaymentRowsGroup`, which renders the same
   provider-grouped catalog (and the same `planBelowMin` gating) per row. */

/** $-prefixed money input with the floating-label look. */
function MoneyField({ label, value, onChange, editable = true, labelBg, trailing }: {
  label: string; value: string; onChange?: (v: string) => void; editable?: boolean;
  /** Match the label's cut-out to whatever the field sits on (white, or the Pricing panel). */
  labelBg?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 20, position: 'relative' }}>
      <FloatingLabel text={label} bg={labelBg} />
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#919EAB33', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, backgroundColor: editable ? '#fff' : '#F4F6F8' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', marginRight: 4, color: editable ? '#1C252E' : '#919EAB' }}>$</Text>
        <TextInput
          style={{ flex: 1, fontSize: 13, fontWeight: '600', color: editable ? '#1C252E' : '#919EAB', padding: 0 }}
          value={value}
          editable={editable}
          onChangeText={(t) => onChange?.(t.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          placeholderTextColor="#919EAB"
          keyboardType="numeric"
        />
        {trailing}
      </View>
    </View>
  );
}

export function ResultJobModal({
  visible = false,
  lead,
  calculatorTitle,
  resultType: initialResultType,
  initialPrice,
  initialPaymentMethod,
  initialDownPayment,
  entries = {},
  verticals = [],
  sectionLabelMap = {},
  pricing,
  onClose,
  onConfirm,
}: ResultJobModalProps) {
  const { isDark } = useTheme();
  // The funding endpoints are company-scoped by a header (spec §1). The lead's own
  // company wins over the signed-in rep's — same resolution `JobDocsSection` uses.
  const { user } = useAuth();
  // Web `result-lead-modal.js:61`. See `Lead.isRehashed`.
  const isRehashed = lead?.isRehashed === true;
  const [oneLeg, setOneLeg] = useState('No');
  const [resultType, setResultType] = useState<'sale' | 'demo'>(initialResultType || 'sale');
  const [demoReason, setDemoReason] = useState('');
  const [reasonExplanation, setReasonExplanation] = useState('');
  const [contractPrice, setContractPrice] = useState('');
  const [versatile, setVersatile] = useState(false);
  const [pineapple, setPineapple] = useState(false);

  // ── funding state ────────────────────────────────────────────────────────
  /**
   * The Funding API. It owns the record; everything the funding screen renders
   * comes from there and ⚠️ **no step is ever advanced locally** (spec rule 3).
   * Only the PRICING rows below are local, because they are an unsaved draft until
   * the rep taps Confirm.
   */
  const funding = useFunding(lead?._id || lead?.leadId || lead?.id, lead?.companyId || user?.companyId);

  /** Which half of the sheet is showing. A demo never leaves `result`. */
  const [screen, setScreen] = useState<'result' | 'funding'>('result');
  /** The editable pricing lines. One down row + one auto balance row to start. */
  const [rows, setRows] = useState<PaymentRow[]>([]);
  /** Messages a lender decision left above the Balance group. */
  const [banners, setBanners] = useState<DecisionBanner[]>([]);
  /** A decision changed what the job can fund, so the contract price opens up. */
  const [priceUnlocked, setPriceUnlocked] = useState(false);
  /** `bank_decline` is only reachable once a lender has actually declined. */
  const [resultChoice, setResultChoice] = useState<'sale' | 'bank_decline'>('sale');
  /** Payment pid whose share sheet is open, plus the url `POST …/link` returned. */
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);

  const isSale = resultType === 'sale';
  const payments = funding.payments;
  const bankDeclined = isSale && resultChoice === 'bank_decline';

  /**
   * Down payments are cash/card only, so a plan carried in from the rollout is
   * only a valid SEED if it is one of those — a financing key belongs to the
   * balance. Same rule as the deal-edit wizard's `toDownPaymentKey`.
   */
  const seedDownMethod = useCallback(
    (key?: string) => (key && pricing.outcomeDownPaymentMethods.some((o) => o.value === key) ? key : ''),
    [pricing.outcomeDownPaymentMethods]
  );

  /**
   * Open the sheet: reset the form, then load whatever funding this lead already
   * has and seed the pricing rows from it.
   *
   * ⚠️ Hydrating rather than always re-seeding is what keeps `pid` STABLE across
   * visits — it is the server's merge key, so inventing fresh ids on every open
   * would create a second set of rows for the same deal on the next save.
   */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    setResultType(initialResultType || 'sale');
    setDemoReason('');
    setReasonExplanation('');
    setScreen('result');
    setBanners([]);
    setPriceUnlocked(false);
    setResultChoice('sale');
    setLinkTarget(null);
    setLinkUrl('');
    funding.clearServerBlockers();

    const seededPrice = initialPrice && initialPrice > 0 ? String(Math.round(initialPrice)) : '';
    setContractPrice(seededPrice);
    const freshRows: PaymentRow[] = [
      {
        pid: newPaymentId(),
        kind: 'down',
        amount: initialDownPayment && initialDownPayment > 0 ? String(Math.round(initialDownPayment)) : '',
        method: seedDownMethod(initialPaymentMethod),
      },
      // The auto row absorbs whatever the down payment leaves, so the two halves
      // always add up to the contract without the rep doing the subtraction.
      { pid: newPaymentId(), kind: 'bal', amount: '', method: initialPaymentMethod || '', auto: true },
    ];
    setRows(freshRows);

    // A demo never funds anything, so don't fetch a record it will never use.
    if ((initialResultType || 'sale') !== 'sale') return;

    funding.load().then((record) => {
      if (cancelled || !record) return;
      const saved = hydrateRowsFromRecord(record, pricing.plans);
      if (saved.length) setRows(saved);
      // The stored contract price wins over the rollout's: it is what the saved
      // rows were priced against, and a mismatch would misreport the remainder.
      if (record.contractPrice > 0) setContractPrice(String(record.contractPrice));
      if (record.result === 'bankDecline') setResultChoice('bank_decline');
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialResultType, initialPrice, initialPaymentMethod, initialDownPayment, seedDownMethod]);

  const contractNum = parseFloat(contractPrice) || 0;

  const downRows = useMemo(() => rows.filter((r) => r.kind === 'down'), [rows]);
  const balRows = useMemo(() => rows.filter((r) => r.kind === 'bal'), [rows]);
  const downTotal = useMemo(
    () => downRows.reduce((n, r) => n + effectiveRowAmount(r, rows, contractNum), 0),
    [downRows, rows, contractNum]
  );
  const balanceTotal = useMemo(
    () => balRows.reduce((n, r) => n + effectiveRowAmount(r, rows, contractNum), 0),
    [balRows, rows, contractNum]
  );

  /**
   * The single-method fields every existing consumer of the outcome payload still
   * reads (`buildCalculatorOutcomePayload`, the outcome logs, the deal-edit
   * baseline). With a split contract there is no one method, so the FIRST funded
   * row of each half stands in — and the summed totals stay exact.
   */
  const primaryDownMethod = useMemo(
    () => downRows.find((r) => r.method && effectiveRowAmount(r, rows, contractNum) > 0)?.method || '',
    [downRows, rows, contractNum]
  );
  const primaryBalanceMethod = useMemo(
    () => balRows.find((r) => r.method && effectiveRowAmount(r, rows, contractNum) > 0)?.method || '',
    [balRows, rows, contractNum]
  );

  // Web parity (result-lead-modal.js): fire the `lead_result_field_entry` outcome
  // logs for this resulted lead.
  useOutcomeLogging({
    visible,
    lead,
    outcomeStatus: resultType,
    outcomeForm: {
      oneLeg,
      result: resultType,
      downPaymentMethod: primaryDownMethod,
      balancePaymentMethod: primaryBalanceMethod,
      originalContractPrice: contractNum || undefined,
      lastPriceQuoted: contractNum || undefined,
      reason: resultType === 'demo' ? demoReason : undefined,
      reasonExplanation: resultType === 'demo' ? reasonExplanation : undefined,
    },
  });

  // Entered line items, grouped by category (sorted) so the Job Summary reads the
  // same as the rollout quote card — category pills + per-row schema icons.
  const items = useMemo(
    () =>
      (Object.values(entries).filter((e) => e && e.inputValue > 0) as CalculatorEntry[]).sort((a, b) =>
        String(a.categoryId).localeCompare(String(b.categoryId)),
      ),
    [entries]
  );

  // categoryId → { label, style }; icon/color are schema-driven (Iconify → Ionicons).
  const categoryMeta = useMemo(() => buildCategoryMeta(verticals), [verticals]);

  // Full package → the Calculator block shows the icon + ⓘ instead of the derived
  // `G+VMax+Versa+S+FWrap` name. The contents card is an IN-SHEET overlay, never a
  // nested <Modal>: stacking native modals is unreliable on both platforms.
  const packageInfo = useMemo(() => describeFullPackage(entries, verticals), [entries, verticals]);
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const [showPackageInfo, setShowPackageInfo] = useState(false);

  // Count of entered items per category → the "Gutters (3)" pills, in entry order.
  const categoryChips = useMemo(() => {
    const counts: Record<string, number> = {};
    const order: string[] = [];
    Object.values(entries).forEach((e) => {
      if (e && e.inputValue > 0 && e.categoryId) {
        if (counts[e.categoryId] === undefined) order.push(e.categoryId);
        counts[e.categoryId] = (counts[e.categoryId] || 0) + 1;
      }
    });
    return order.map((id) => ({ id, count: counts[id] }));
  }, [entries]);

  // ── pricing-row editing ──────────────────────────────────────────────────

  const updateRow = useCallback((pid: string, patch: Partial<PaymentRow>) => {
    setRows((prev) => prev.map((r) => (r.pid === pid ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((pid: string) => {
    setRows((prev) => prev.filter((r) => r.pid !== pid));
  }, []);

  const addRow = useCallback((kind: 'down' | 'bal') => {
    setRows((prev) => {
      const next = [...prev];
      // A new line goes AFTER the last row of its own half so the two groups stay
      // contiguous — `rows` is one flat list and the groups render from filters.
      let insertAt = next.length;
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].kind === kind) {
          insertAt = i + 1;
          break;
        }
      }
      next.splice(insertAt, 0, { pid: newPaymentId(), kind, amount: '', method: '' });
      return next;
    });
  }, []);

  /**
   * Re-open the auto (remainder) row when money comes unassigned again.
   *
   * The rep can dismiss the auto row once it is holding $0, but lowering a down
   * payment afterwards would leave the gap invisible. Rather than restoring a
   * deleted row, the LAST balance row without a lender decision takes the auto
   * flag back — which is where the remainder belongs anyway.
   */
  useEffect(() => {
    if (!isSale || contractNum <= 0) return;
    const hasAuto = rows.some((r) => r.auto);
    const gap = contractNum - assignedTotal(rows, contractNum);
    if (hasAuto || gap <= EPS) return;
    const candidates = rows.filter((r) => r.kind === 'bal' && !r.decision);
    const target = candidates[candidates.length - 1];
    if (!target) return;
    // Only reclaim a row the rep has not typed into — never overwrite an amount.
    if (parseFloat(target.amount || '0') > 0) return;
    updateRow(target.pid, { auto: true });
  }, [rows, contractNum, isSale, updateRow]);

  const needsRowId = useMemo(() => needsAttentionRowId(rows, banners), [rows, banners]);

  // ── gate into funding ────────────────────────────────────────────────────

  const fundedRows = useMemo(
    () => rows.filter((r) => effectiveRowAmount(r, rows, contractNum) > 0),
    [rows, contractNum]
  );
  const totalAssigned = useMemo(() => assignedTotal(rows, contractNum), [rows, contractNum]);
  const missingMethod = fundedRows.some((r) => !r.method);
  const overAssigned = totalAssigned > contractNum + EPS;
  const underAssigned = contractNum > 0 && totalAssigned < contractNum - EPS;
  const saleReady = contractNum > 0 && fundedRows.length > 0 && !missingMethod && !overAssigned;

  /**
   * Confirm — save the pricing rows, then move to Funding.
   *
   * The `PUT` is the save for the whole screen: `payments` is the COMPLETE list,
   * so a row the rep deleted is deleted server-side too. Only advance on success —
   * the funding screen renders the server's record, so opening it after a failed
   * save would show the rep the previous state under the new price.
   */
  const goFunding = useCallback(async () => {
    if (contractNum <= 0) {
      FlashMessage.error('Contract price', 'Enter the contract price before confirming.');
      return;
    }
    if (missingMethod) {
      FlashMessage.error('Payment method', 'Every payment line with an amount needs a payment method.');
      return;
    }
    if (overAssigned) {
      FlashMessage.error(
        'Over-assigned',
        `Payments add up to $${totalAssigned.toLocaleString()}, which is more than the $${contractNum.toLocaleString()} contract.`
      );
      return;
    }
    const res = await funding.savePayments(
      Math.round(contractNum),
      toUpsertRows(rows, contractNum, pricing.plans)
    );
    if (res.ok) setScreen('funding');
  }, [contractNum, missingMethod, overAssigned, totalAssigned, rows, pricing.plans, funding]);

  /** Back / "Edit payments" — fold every lender decision onto the pricing rows. */
  const goResult = useCallback(() => {
    const applied = applyDecisionsToRows(rows, payments, contractNum);
    setRows(applied.rows);
    setBanners(applied.banners);
    if (applied.banners.length) setPriceUnlocked(true);
    funding.clearServerBlockers();
    setScreen('result');
  }, [rows, payments, contractNum, funding]);

  // ── funding actions ──────────────────────────────────────────────────────

  const covered = useMemo(() => coverageOK(payments, contractNum), [payments, contractNum]);
  /**
   * The live checklist. The SERVER's list replaces it the moment a submit is
   * refused (spec §5.12) — that one is authoritative and already ordered — but
   * showing the local mirror beforehand means the rep works the list instead of
   * discovering it by tapping a button that says no.
   */
  const localBlockers = useMemo(() => fundingBlockers(payments, contractNum), [payments, contractNum]);
  const blockers = funding.serverBlockers ?? localBlockers;
  /** ⚠️ Read from the record: the server refuses `bankDecline` without a logged decline. */
  const declineHappened = useMemo(() => hasDecline(funding.record), [funding.record]);
  const attempts = useMemo(() => attemptLog(funding.record), [funding.record]);
  /** The most recent status check across every row. */
  const lastSyncedAt = useMemo(() => {
    const stamps = payments.map((p) => p.syncedAt).filter(Boolean) as string[];
    if (!stamps.length) return null;
    return formatStamp(stamps.sort().slice(-1)[0]);
  }, [payments]);

  // A rep who reassigns a declined amount can end up with no live decline; the
  // job must not stay resulted as a Bank Decline in that case.
  useEffect(() => {
    if (!declineHappened && resultChoice === 'bank_decline') setResultChoice('sale');
  }, [declineHappened, resultChoice]);

  /**
   * Open the send sheet and fetch the hosted-page url.
   *
   * ⚠️ `POST …/link` marks NOTHING — merely opening the sheet must not tick Link
   * Sent (spec §5.4). It is idempotent, so backing out and reopening returns the
   * same page rather than minting a second live link.
   */
  const openSendSheet = useCallback(
    async (pid: string) => {
      setLinkTarget(pid);
      setLinkUrl('');
      setIsLoadingLink(true);
      const res = await funding.fetchLink(pid);
      setLinkUrl(res.ok ? res.data?.url || '' : '');
      setIsLoadingLink(false);
    },
    [funding]
  );

  /** The rep confirmed a send happened. Resolves false if the server did not deliver. */
  const handleSendLink = useCallback(
    async (channel: FundingChannel, destination?: string): Promise<boolean> => {
      if (!linkTarget) return false;
      const res = await funding.markLinkSent(linkTarget, channel, destination);
      return res.ok;
    },
    [funding, linkTarget]
  );

  /**
   * Bank Decline / back to Sale.
   *
   * ⚠️ Only mirrored locally once the SERVER accepts it — it refuses the switch
   * without a logged lender decline, and refuses to undo one after submission.
   */
  const handleSetResult = useCallback(
    async (next: 'sale' | 'bank_decline') => {
      const res = await funding.setResult(next === 'bank_decline' ? 'bankDecline' : 'sale');
      if (res.ok) setResultChoice(next);
    },
    [funding]
  );

  const linkPayment = useMemo(() => payments.find((p) => p.pid === linkTarget) || null, [payments, linkTarget]);

  // ── submit ───────────────────────────────────────────────────────────────

  // Web `isFormValid` (result-lead-modal.js): a Demo needs a reason AND a last
  // price quoted > 0. The Sale gate now lives in `saleReady` — every funded line
  // needs a method, which subsumes the old "balance method required" rule and also
  // covers a paid-in-full deal that has no balance line at all.
  const demoDisabled =
    !demoReason || (demoReason === 'Other (Explain)' && !reasonExplanation.trim()) || !(contractNum > 0);
  // The server is the real gate; this only keeps the rep from tapping into a
  // rejection it can already see coming. A Bank Decline submits with no checks.
  const submitDisabled = funding.isSubmitting || (!bankDeclined && localBlockers.length > 0);

  /**
   * Finish.
   *
   * A **demo** has nothing to fund, so it hands off immediately. A **sale** must
   * submit the funding first and only proceeds if the server accepts — a refusal
   * comes back as the itemised `blockers` list, which is rendered in place of the
   * local one rather than dropping the rep into the job builder on an unfunded job.
   */
  const handleBuild = useCallback(async () => {
    const isDemo = resultType === 'demo';

    if (!isDemo) {
      const res = await funding.submit();
      if (!res.ok) return;
    }

    onConfirm?.({
      resultType,
      oneLeg,
      contractPrice: isDemo ? undefined : contractNum || undefined,
      // Demo persists the last price quoted (web parity) — the read-only value shown
      // in the demo branch; previously dropped so the demo outcome saved an empty price.
      lastPriceQuoted: isDemo ? contractNum || undefined : undefined,
      downPayment: isDemo ? undefined : downTotal || undefined,
      balance: isDemo ? undefined : balanceTotal,
      downPaymentMethod: primaryDownMethod || undefined,
      balancePaymentMethod: primaryBalanceMethod || undefined,
      demoReason: isDemo ? demoReason : undefined,
      reasonExplanation: isDemo && demoReason === 'Other (Explain)' ? reasonExplanation : undefined,
      versatile,
      pineapple,
      ...(isDemo
        ? {}
        : {
            bankDecline: bankDeclined,
            // The record as the server holds it after the submit landed.
            payments,
            fundingAttempts: funding.record?.attemptHistory || [],
          }),
    });
  }, [
    resultType, oneLeg, contractNum, downTotal, balanceTotal, primaryDownMethod, primaryBalanceMethod,
    demoReason, reasonExplanation, versatile, pineapple, bankDeclined, payments, funding, onConfirm,
  ]);

  // ── price lock ───────────────────────────────────────────────────────────

  const priceEditable = isRehashed || priceUnlocked;
  /** Money a lender has already committed to — the floor the price cannot go under. */
  const lockedTotal = useMemo(
    () => rows.filter((r) => r.decision).reduce((n, r) => n + effectiveRowAmount(r, rows, contractNum), 0),
    [rows, contractNum]
  );
  const priceBelowLocked = priceUnlocked && contractNum < lockedTotal;

  // ── render ───────────────────────────────────────────────────────────────

  const onFunding = screen === 'funding';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16 }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose}>
            <BlurView
              style={StyleSheet.absoluteFill}
              blurType={isDark ? 'dark' : 'light'}
              blurAmount={MODAL_BLUR_AMOUNT}
              reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
            />
            <View style={MODAL_SCRIM} pointerEvents="none" />
          </TouchableOpacity>
          {/* No MODAL_CARD_SHADOW here: `overflow: 'hidden'` (needed to clip the
              green header to the radius) sets clipsToBounds on iOS, which would
              clip the shadow away. The scrim above carries the separation. */}
          <View style={{ backgroundColor: '#fff', borderRadius: 16, maxHeight: '85%', overflow: 'hidden' }}>
            {/* Header — one bar for both screens; the back chevron only exists on Funding. */}
            <View style={{ paddingHorizontal: 20, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#4CBB17' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                {onFunding && (
                  <TouchableOpacity onPress={goResult} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 10 }}>
                    <Ionicons name="chevron-back" size={22} color="#fff" />
                  </TouchableOpacity>
                )}
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>{onFunding ? 'Funding' : 'Result Lead'}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ paddingHorizontal: 20, paddingTop: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {onFunding ? (
                /* Every callback is an ENDPOINT — nothing here ticks a step
                   locally; the screen redraws from the record each one returns. */
                <FundingView
                  payments={payments}
                  contractTotal={contractNum}
                  covered={covered}
                  bankDeclined={bankDeclined}
                  log={attempts}
                  lastSyncedAt={lastSyncedAt}
                  syncingAll={funding.syncingAll}
                  busyPid={funding.busyPid}
                  mockDisabled={funding.mockDisabled}
                  onSyncAll={funding.syncAll}
                  onSyncOne={funding.syncPayment}
                  onSendLink={openSendSheet}
                  onMarkCollected={funding.markCheckCollected}
                  onChargeCard={funding.chargeCard}
                  onActivate={funding.activateLoan}
                  onSimulate={funding.mockProvider}
                  onEditPayments={goResult}
                  onResultAsBankDecline={() => handleSetResult('bank_decline')}
                  onUndoBankDecline={() => handleSetResult('sale')}
                />
              ) : (
                <>
                  <SelectField
                    label="One Leg"
                    value={oneLeg}
                    placeholder="Select One Leg"
                    options={ONE_LEG_OPTIONS.map((o) => ({ value: o, label: o }))}
                    onSelect={setOneLeg}
                  />

                  {/* A DEMO keeps the original Demo/Sale switch — nothing has been
                      funded, so there is nothing to protect. A SALE is locked: once
                      the rep is pricing a deal the only other honest outcome is the
                      one a lender forces, so Bank Decline appears only after one. */}
                  {isSale ? (
                    <>
                      <SelectField
                        label="Result"
                        value={resultChoice}
                        placeholder="Sale"
                        disabled={!declineHappened}
                        error={bankDeclined}
                        options={[
                          { value: 'sale', label: 'Sale' },
                          { value: 'bank_decline', label: 'Bank Decline' },
                        ]}
                        onSelect={(v) => setResultChoice(v as 'sale' | 'bank_decline')}
                      />
                      {!declineHappened && (
                        <Text style={{ fontSize: 11.5, fontWeight: '600', color: FUND.MUTED, marginTop: -14, marginBottom: 18, marginHorizontal: 4 }}>
                          Locked to Sale unless a lender declines.
                        </Text>
                      )}
                    </>
                  ) : (
                    <SelectField
                      label="Result"
                      value={resultType}
                      placeholder="Select Result"
                      capitalize
                      options={[{ value: 'demo', label: 'Demo' }, { value: 'sale', label: 'Sale' }]}
                      onSelect={(v) => setResultType(v as 'sale' | 'demo')}
                    />
                  )}

                  {resultType === 'demo' && (
                    <>
                      <SelectField
                        label="Reason for Demo"
                        value={demoReason}
                        placeholder="Select Reason for Demo"
                        error={!demoReason}
                        options={DEMO_REASONS.map((r) => ({ value: r, label: r }))}
                        onSelect={setDemoReason}
                      />
                      {demoReason === 'Other (Explain)' && (
                        <View style={{ marginBottom: 20, position: 'relative' }}>
                          <FloatingLabel text="Explain Reason" error={!reasonExplanation.trim()} />
                          <View style={{ borderWidth: 1, borderColor: '#919EAB33', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 80, backgroundColor: '#fff' }}>
                            <TextInput
                              style={{ fontSize: 13, fontWeight: '600', color: '#1C252E', padding: 0, textAlignVertical: 'top' }}
                              value={reasonExplanation}
                              onChangeText={setReasonExplanation}
                              placeholder="Enter details..."
                              placeholderTextColor="#919EAB"
                              multiline
                              numberOfLines={3}
                            />
                          </View>
                        </View>
                      )}
                      <MoneyField label="Last Price Quoted" value={contractPrice} editable={false} />
                    </>
                  )}

                  {isSale && (
                    /* PRICING — the contract price and everything paying it, in one
                       recessed panel so the split reads as a single figure broken up
                       rather than three unrelated fields. */
                    <View style={{ backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 22, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6, marginBottom: 22 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL, paddingHorizontal: 4, paddingBottom: 14 }}>
                        Pricing
                      </Text>

                      {/* Web parity (result-lead-modal.js `disabled={!isRehashed}`): the
                          contract price is locked to what the rollout quoted. A rehash
                          may overwrite it — and so may a rep whose lender decision has
                          just changed what this job can fund. */}
                      <MoneyField
                        label="Original Contract Price"
                        value={contractPrice}
                        editable={priceEditable}
                        onChange={priceEditable ? setContractPrice : undefined}
                        labelBg={FUND.PANEL}
                        trailing={
                          priceUnlocked ? (
                            <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: FUND.AMBER_BG }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: FUND.AMBER_TEXT }}>Editable</Text>
                            </View>
                          ) : null
                        }
                      />
                      {priceUnlocked && (
                        <Text style={{ fontSize: 11.5, fontWeight: '700', lineHeight: 16, marginTop: -12, marginBottom: 16, marginHorizontal: 4, color: priceBelowLocked ? FUND.RED_TEXT : FUND.AMBER_TEXT }}>
                          {priceBelowLocked
                            ? `Contract price is below the $${lockedTotal.toLocaleString()} already approved and locked. Void that application before going lower.`
                            : PRICE_UNLOCK_HINT}
                        </Text>
                      )}

                      <PaymentRowsGroup
                        title="Down Payment"
                        rows={downRows}
                        allRows={rows}
                        price={contractNum}
                        plans={pricing.plans}
                        // Financing carries a balance, never a deposit — the Down
                        // Payment picker is cash/card only (see `useDealPricing`).
                        options={pricing.outcomeDownPaymentMethods}
                        needsRowId={needsRowId}
                        canAdd={MULTI_METHOD_ENABLED}
                        onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                        onChangeMethod={(id, key) => updateRow(id, { method: key })}
                        onRemove={removeRow}
                        onAdd={() => addRow('down')}
                      />

                      {banners.map((b) => (
                        <View key={b.id} style={{ backgroundColor: b.tone === 'bad' ? FUND.RED_BG : FUND.AMBER_BG, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', lineHeight: 17, color: b.tone === 'bad' ? FUND.RED_TEXT : FUND.AMBER_TEXT }}>
                            {b.text}
                          </Text>
                        </View>
                      ))}

                      <PaymentRowsGroup
                        title="Balance"
                        rows={balRows}
                        allRows={rows}
                        price={contractNum}
                        plans={pricing.plans}
                        categories={pricing.categories}
                        needsRowId={needsRowId}
                        canAdd={MULTI_METHOD_ENABLED}
                        onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                        onChangeMethod={(id, key) => updateRow(id, { method: key })}
                        onRemove={removeRow}
                        onAdd={() => addRow('bal')}
                      />

                      {overAssigned ? (
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.RED_TEXT, marginHorizontal: 4, marginBottom: 12, lineHeight: 16 }}>
                          Payments add up to ${totalAssigned.toLocaleString()} — ${(totalAssigned - contractNum).toLocaleString()} more than the contract price.
                        </Text>
                      ) : underAssigned ? (
                        /* Only reachable once the rep has dismissed the auto row and
                           filled every remaining line, so there is nothing left to
                           absorb the gap. Not blocking — funding lists it as a blocker
                           too — but it should not first surface a screen later. */
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.AMBER_TEXT, marginHorizontal: 4, marginBottom: 12, lineHeight: 16 }}>
                          ${(contractNum - totalAssigned).toLocaleString()} of the contract is not assigned to a payment method yet.
                        </Text>
                      ) : null}
                    </View>
                  )}

                  {!!calculatorTitle && (
                    <View style={{ marginBottom: 20, padding: 12, backgroundColor: '#F4F6F8', borderRadius: 8 }}>
                      <Text style={{ fontSize: 11, color: '#919EAB' }}>Calculator</Text>
                      {/* A full package shows the icon + ⓘ here too, so this block matches the
                          tab, the quote card and the Sale/Demo chooser the rep came through.
                          Derived from the same `entries` the Job Summary below lists, so the
                          two halves of this sheet can never describe different jobs. */}
                      <FullPackageTitle
                        {...packageInfo}
                        title={calculatorTitle}
                        size={13}
                        weight="600"
                        color="#1C252E"
                        iconColor="#16A34A"
                        onInfo={(rect) => { setPackageAnchor(rect); setShowPackageInfo(true); }}
                      />
                    </View>
                  )}

                  {/* Job Summary */}
                  <View style={{ backgroundColor: '#F7F6FD', borderRadius: 16, padding: 16, marginTop: 4, marginBottom: 8, borderWidth: 1, borderColor: '#E8E6F8' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                          <Ionicons name="clipboard" size={16} color="#4CBB17" />
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C252E' }}>Job Summary</Text>
                      </View>
                      <View style={{ backgroundColor: '#E5D9FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: '#6B46C1' }}>{items.length} Item{items.length === 1 ? '' : 's'}</Text>
                      </View>
                    </View>
                    {items.length === 0 ? (
                      <Text style={{ fontSize: 12, color: '#94A3B8', fontWeight: '600', paddingVertical: 8 }}>No items</Text>
                    ) : (
                      <>
                        {/* Category pills (schema-driven icon + color) */}
                        {categoryChips.length > 0 && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                            {categoryChips.map(({ id: catId, count }) => {
                              const meta = categoryMeta[catId] || { label: catId, style: styleForKey(catId) };
                              return (
                                <View key={catId} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: meta.style.bg }}>
                                  <Ionicons name={meta.style.icon} size={11} color={meta.style.color} style={{ marginRight: 4 }} />
                                  <Text style={{ fontSize: 11, fontWeight: '900', color: meta.style.color }}>{meta.label} ({count})</Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                        <View style={{ gap: 8 }}>
                          {items.map((item, i) => {
                            const meta = categoryMeta[item.categoryId] || { label: item.categoryId, style: styleForKey(item.categoryId) };
                            return (
                              <View key={item.fieldId || i} style={{ backgroundColor: '#fff', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: meta.style.bg, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                                  <Ionicons name={meta.style.icon} size={14} color={meta.style.color} />
                                </View>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1C252E', flex: 1 }}>
                                  {item.inputValue}{unitSuffix(item)} {labelWithSection(item.label, item.sectionId, sectionLabelMap)}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>

                  {/* Versatile / Pineapple */}
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                    <TouchableOpacity onPress={() => setVersatile((v) => !v)} style={{ flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFAB00', opacity: versatile ? 1 : 0.55 }}>
                      <Text style={{ fontWeight: '700', fontSize: 11, color: '#212B36' }}>Versatile</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setPineapple((v) => !v)} style={{ flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFAB00', opacity: pineapple ? 1 : 0.55 }}>
                      <Text style={{ fontWeight: '700', fontSize: 11, color: '#212B36' }}>Pineapple</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>

            {/* Footer */}
            <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#919EAB14' }}>
              {onFunding ? (
                <>
                  {bankDeclined ? (
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.MUTED, lineHeight: 17, marginBottom: 11 }}>
                      <Text style={{ color: FUND.SUBTEXT }}>No funding to satisfy.</Text>
                      {'\n'}The job is closing as a bank decline.
                    </Text>
                  ) : blockers.length > 0 ? (
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.MUTED, lineHeight: 17, marginBottom: 11 }}>
                      <Text style={{ color: FUND.SUBTEXT }}>Before you can submit:</Text>
                      {blockers.map((b) => `\n• ${b}`).join('')}
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.GREEN_TEXT, lineHeight: 17, marginBottom: 11 }}>
                      ✓ Every payment is as far as you can take it. Ready to submit.
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={goResult}
                    style={{ height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.6, borderColor: FUND.BORDER, marginBottom: 10 }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '700', color: FUND.SUBTEXT }}>Edit payments</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={submitDisabled}
                    onPress={handleBuild}
                    style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: submitDisabled ? '#E9EBEE' : '#4CBB17' }}
                  >
                    <Text style={{ color: submitDisabled ? '#A8AEB6' : '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 }}>
                      {bankDeclined ? 'Submit Bank Decline' : 'Submit Funding'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : isSale ? (
                <TouchableOpacity
                  disabled={!saleReady}
                  onPress={goFunding}
                  style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: saleReady ? '#4CBB17' : '#919EAB' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 }}>Confirm</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={demoDisabled}
                  onPress={handleBuild}
                  style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: demoDisabled ? '#919EAB' : '#4CBB17' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 }}>Build Job</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Share sheet — an in-sheet overlay, not a nested Modal (see SendLinkModal).
                It reports the send; the STEP comes back on the record, never from here. */}
            {!!linkPayment && (
              <SendLinkModal
                payment={linkPayment}
                link={linkUrl}
                isLoadingLink={isLoadingLink}
                isSending={funding.busyPid === linkPayment.pid}
                onSend={handleSendLink}
                onClose={() => {
                  setLinkTarget(null);
                  setLinkUrl('');
                }}
              />
            )}
          </View>

          {/* Last child of this sheet's root so it covers the card. In-sheet, not a
              nested <Modal> — see `packageInfo` above. */}
          {showPackageInfo && (
            <FullPackageInfoOverlay anchorRect={packageAnchor} onClose={() => setShowPackageInfo(false)} />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
