import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { NumPadScrollView } from '../../../widgets/common/NumPadScrollView';
import { useNumPadActive } from '../../../widgets/common/keyboard/NumPad';
import { View, Text, TextInput, TouchableOpacity, Modal, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
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
import { NUMERIC_KEYBOARD } from '../../../utils/keyboard-type';
import { useAuth } from '../../../hooks/useAuth';
import { useIsOnline } from '../../../hooks/useIsOnline';
import { isOnline } from '../../../services/connectivity';
import {
  ensureOfflineWorkForLead,
  saveOfflineFunding,
  saveOfflineFundingCollected,
  saveOfflineFundingSubmit,
} from '../../../services/offlineLeadStore';
import {
  logFundingEditPayments,
  logFundingLinkCopied,
  logFundingCheckCollected,
  logFundingOpened,
  logFundingPaymentsSaved,
  logFundingSubmitted,
  type FundingSource,
} from '../../../utils/activity-log/funding-log';
import {
  logResultLeadBuildJob,
  logResultLeadConfirmed,
  logResultLeadMethodSelected,
  logResultLeadOpened,
  logResultLeadRowAdded,
  logResultLeadRowRemoved,
  logResultLeadStructureChanged,
} from '../../../utils/activity-log/result-lead-log';
import { RESULT_LEAD_MODULE } from '../../../constants/activity-log.constants';
import { FS, FUND, PS } from './funding/funding-theme';
import { ModalFlashHost } from '../../../widgets/common/ModalFlashHost';
import { PaymentRowsGroup } from './funding/PaymentRowsGroup';
import { FundingView } from './funding/FundingView';
import { SendLinkModal } from './funding/SendLinkModal';
import { DropdownChoice } from './funding/DropdownChoice';
import { CoverageBar } from './funding/CoverageBar';
import { BlockerList } from './funding/BlockerList';
import { useFunding } from '../hooks/useFunding';
import { LeadService } from '../../../services/api/leads';
import type {
  FundingChannel,
  FundingPaymentRow,
  FundingRecord,
  PaymentAllocation,
} from '../../../services/api/FundingService';
import {
  applyDecisionsToRows,
  assignedTotal,
  attemptLog,
  confirmBlockers,
  coverageOK,
  effectiveRowAmount,
  formatStamp,
  fundingBlockers,
  hasDecline,
  hydrateRowsFromRecord,
  inferPayMode,
  inferNoDownPayment,
  payStructureOf,
  MULTI_METHOD_ENABLED,
  needsAttentionRowId,
  newPaymentId,
  offlineFundingRecord,
  paymentAllocations,
  structureHint,
  structureLocked,
  swapRowMethod,
  toUpsertRows,
  type DecisionBanner,
  type PaymentKind,
  type PaymentRow,
  type PayMode,
  type PayStructure,
  fundingBelongsToCalculator,
} from '../utils/funding';

const ONE_LEG_OPTIONS = ['No', 'MR', 'MRS'];

const DEMO_REASONS = [
  "Can't Afford", "Didn't Like", 'DIY', 'Lowes Demo', 'Lowes Pending Sale',
  'Lowes Rehash', 'Moving', 'No Job', 'No Need / Want', 'No Snap Decision',
  'Other Projects', 'Rental Property', 'Rushed - No Time', 'Shop Around',
  'Talk to Spouse', 'Think About It', 'Too Much Money', 'Would Not Commit',
  'Other (Explain)',
];

const EPS = 0.01;

const PRICE_UNLOCK_HINT =
  'Unlocked because a lender decision changed what this job can fund. Lower the price if you are rewriting the deal.';

interface ResultJobModalProps {
  visible?: boolean;
  lead?: any;
  calculatorTitle?: string;
  calculatorId?: string;
  startOnFunding?: boolean;
  fundingSource?: FundingSource;
  resultType?: 'sale' | 'demo' | null;
  initialPrice?: number;
  initialPaymentMethod?: string;
  initialDownPayment?: number;
  entries?: Record<string, CalculatorEntry>;
  verticals?: CalculatorSchema[];
  sectionLabelMap?: Record<string, string>;
  isLowesLead?: boolean;
  pricing: DealPricing;
  onClose?: () => void;
  onConfirm?: (data: {
    resultType: 'sale' | 'demo';
    oneLeg?: string;
    contractPrice?: number;
    lastPriceQuoted?: number;
    downPayment?: number;
    balance?: number;
    downPaymentMethod?: string;
    balancePaymentMethod?: string;
    downPayments?: PaymentAllocation[];
    balancePayments?: PaymentAllocation[];
    demoReason?: string;
    reasonExplanation?: string;
    versatile?: boolean;
    pineapple?: boolean;
    bankDecline?: boolean;
    payments?: FundingPaymentRow[];
    fundingAttempts?: FundingRecord['attemptHistory'];
  }) => void;
}

/**
 * Centres the card in the modal - until the number pad is up. The pad is mounted in-flow by the patched
 * `Modal` (index.js) and shrinks this column, and a card centred in what is left floats with a white band
 * above AND below it (ticket: space between the keyboard and the outer box). With the pad up the card
 * sits on the pad instead. ⚠️ Must be rendered INSIDE the `<Modal>`: `useNumPadActive` reads the nearest
 * provider, and the modal has its own (a hook in `ResultJobModal` itself would read the app root's).
 */
function PadAwareCenter({ children }: { children: React.ReactNode }) {
  const padUp = useNumPadActive();
  return (
    <View style={{ flex: 1, justifyContent: padUp ? 'flex-end' : 'center', paddingHorizontal: 16, paddingBottom: padUp ? 8 : 0 }}>
      {children}
    </View>
  );
}

function FloatingLabel({ text, error, bg = '#fff' }: { text: string; error?: boolean; bg?: string }) {
  return (
    <Text style={{ position: 'absolute', top: -8, left: 12, zIndex: 10, paddingHorizontal: 4, backgroundColor: bg, fontSize: FS.MICRO, fontFamily: PS.semibold, letterSpacing: 0.5, color: error ? '#EF4444' : '#000' }}>
      {text}
    </Text>
  );
}

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
        style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 10, minHeight: 44, borderColor: error ? '#EF4444' : open ? '#1C252E' : '#919EAB33', backgroundColor: disabled ? '#F4F6F8' : '#fff' }}
      >
        <Text style={{ flex: 1, fontSize: FS.BODY, fontFamily: PS.semibold, color: selected ? (disabled ? '#919EAB' : '#1C252E') : '#919EAB', textTransform: capitalize ? 'capitalize' : 'none' }}>
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
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: isSel ? '#1C252E' : '#637381', textTransform: capitalize ? 'capitalize' : 'none' }}>{o.label}</Text>
                {isSel && <Ionicons name="checkmark" size={16} color="#1C252E" />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

function MoneyField({ label, value, onChange, editable = true, labelBg, trailing }: {
  label: string; value: string; onChange?: (v: string) => void; editable?: boolean;
  labelBg?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 20, position: 'relative' }}>
      {/* Title above the box, exactly like the payment rows' "Amount" label. */}
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, minHeight: 46, backgroundColor: editable ? '#fff' : FUND.FILL }}>
        <Text style={{ fontSize: FS.LEAD, fontFamily: PS.bold, marginRight: 3, color: editable ? '#1C252E' : '#919EAB' }}>$</Text>
        <TextInput
          style={{ flex: 1, fontSize: FS.LEAD, fontFamily: PS.bold, color: editable ? '#1C252E' : '#919EAB', padding: 0 }}
          value={value}
          editable={editable}
          onChangeText={(t) => onChange?.(t.replace(/[^0-9.]/g, ''))}
          placeholder="0.00"
          placeholderTextColor="#919EAB"
          keyboardType={NUMERIC_KEYBOARD}
          returnKeyType="done"
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
  calculatorId,
  startOnFunding,
  fundingSource,
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
  const { user } = useAuth();
  const online = useIsOnline();
  const isRehashed = lead?.isRehashed === true;
  const [oneLeg, setOneLeg] = useState('No');
  const [resultType, setResultType] = useState<'sale' | 'demo'>(initialResultType || 'sale');
  const [demoReason, setDemoReason] = useState('');
  const [reasonExplanation, setReasonExplanation] = useState('');
  const [contractPrice, setContractPrice] = useState('');
  const [versatile, setVersatile] = useState(false);
  const [pineapple, setPineapple] = useState(false);

  const leadLogId = lead?._id || lead?.leadId || lead?.id;
  const funding = useFunding(leadLogId, lead?.companyId || user?.companyId, {
    userId: user?._id || user?.id,
    calculatorId,
    calculatorTitle,
    source: fundingSource,
    customerId: lead?.customerDetails?._id || lead?.customerDetails?.id || undefined,
  });

  const logCtx = useMemo(
    () => ({
      userId: user?._id || user?.id,
      leadId: leadLogId,
      calculatorId,
      calculatorTitle,
      source: fundingSource,
    }),
    [user?._id, user?.id, leadLogId, calculatorId, calculatorTitle, fundingSource]
  );

  const [screen, setScreen] = useState<'result' | 'funding'>('result');
  const [payMode, setPayMode] = useState<PayMode>('split');
  const [noDown, setNoDown] = useState(true);
  const [structureNudge, setStructureNudge] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [banners, setBanners] = useState<DecisionBanner[]>([]);
  const [priceUnlocked, setPriceUnlocked] = useState(false);
  const [resultChoice, setResultChoice] = useState<'sale' | 'bank_decline'>('sale');
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Offline there is no server record, so the Funding screen is fed from the rows the rep
  // just entered. Cleared whenever the modal reopens, with the rest of the state.
  const [offlineRecord, setOfflineRecord] = useState<FundingRecord | null>(null);
  const [offlineWorkId, setOfflineWorkId] = useState<string | null>(null);

  const isSale = resultType === 'sale';
  const payments = offlineRecord?.payments ?? funding.payments;
  const bankDeclined = isSale && resultChoice === 'bank_decline';

  const seedDownMethod = useCallback(
    (key?: string) => (key && pricing.outcomeDownPaymentMethods.some((o) => o.value === key) ? key : ''),
    [pricing.outcomeDownPaymentMethods]
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    setResultType(initialResultType || 'sale');
    setDemoReason('');
    setReasonExplanation('');
    setScreen('result');
    setPayMode('split');
    setNoDown(!(initialDownPayment && initialDownPayment > 0));
    setStructureNudge(false);
    setBanners([]);
    setPriceUnlocked(false);
    setResultChoice('sale');
    setLinkTarget(null);
    setLinkUrl('');
    setSaveError(null);
    setOfflineRecord(null);
    setOfflineWorkId(null);
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
      { pid: newPaymentId(), kind: 'bal', amount: '', method: initialPaymentMethod || '', auto: true },
    ];
    setRows(freshRows);

    if ((initialResultType || 'sale') !== 'sale') return;

    funding.load().then((record) => {
      if (cancelled || !record) return;
      // ⚠️ The record is lead-wide; ownership is the SERVER's `record.calculatorId`. Another
      // calculator's rows are not ours — we are re-scoping, and the next save moves (or 409s).
      if (!fundingBelongsToCalculator(record.calculatorId, calculatorId)) return;
      const saved = hydrateRowsFromRecord(record, pricing.plans);
      if (saved.length) {
        setRows(saved);
        setPayMode(inferPayMode(record));
        setNoDown(inferNoDownPayment(record));
      }
      if (record.contractPrice > 0) setContractPrice(String(record.contractPrice));
      if (record.result === 'bankDecline') setResultChoice('bank_decline');
      if (startOnFunding && saved.length) {
        wentToFundingRef.current = true;
        setScreen('funding');
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialResultType, initialPrice, initialPaymentMethod, initialDownPayment, seedDownMethod]);

  const contractNum = parseFloat(contractPrice) || 0;

  const activeRows = useMemo(
    () => rows.filter((r) => (payMode === 'upfront' ? r.kind === 'up' : r.kind !== 'up')),
    [rows, payMode]
  );

  const upRows = useMemo(() => activeRows.filter((r) => r.kind === 'up'), [activeRows]);
  const downRows = useMemo(() => activeRows.filter((r) => r.kind === 'down'), [activeRows]);
  const balRows = useMemo(() => activeRows.filter((r) => r.kind === 'bal'), [activeRows]);
  const collectNowRows = useMemo(() => activeRows.filter((r) => r.kind !== 'bal'), [activeRows]);

  const downTotal = useMemo(
    () => collectNowRows.reduce((n, r) => n + effectiveRowAmount(r, activeRows, contractNum), 0),
    [collectNowRows, activeRows, contractNum]
  );
  const balanceTotal = useMemo(
    () => balRows.reduce((n, r) => n + effectiveRowAmount(r, activeRows, contractNum), 0),
    [balRows, activeRows, contractNum]
  );

  const primaryDownMethod = useMemo(
    () => collectNowRows.find((r) => r.method && effectiveRowAmount(r, activeRows, contractNum) > 0)?.method || '',
    [collectNowRows, activeRows, contractNum]
  );
  const primaryBalanceMethod = useMemo(
    () => balRows.find((r) => r.method && effectiveRowAmount(r, activeRows, contractNum) > 0)?.method || '',
    [balRows, activeRows, contractNum]
  );

  const allocations = useMemo(
    () => paymentAllocations(activeRows, contractNum, pricing.plans),
    [activeRows, contractNum, pricing.plans]
  );

  useOutcomeLogging({
    visible,
    lead,
    source: fundingSource,
    moduleType: RESULT_LEAD_MODULE,
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

  const items = useMemo(
    () =>
      (Object.values(entries).filter((e) => e && e.inputValue > 0) as CalculatorEntry[]).sort((a, b) =>
        String(a.categoryId).localeCompare(String(b.categoryId)),
      ),
    [entries]
  );

  const categoryMeta = useMemo(() => buildCategoryMeta(verticals), [verticals]);

  const packageInfo = useMemo(() => describeFullPackage(entries, verticals), [entries, verticals]);
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const [showPackageInfo, setShowPackageInfo] = useState(false);

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

  const wentToFundingRef = useRef(false);
  const openLoggedRef = useRef(false);

  useEffect(() => {
    const onPricing = visible && screen === 'result';
    if (!onPricing) {
      openLoggedRef.current = false;
      if (!visible) wentToFundingRef.current = false;
      return;
    }
    if (openLoggedRef.current) return;
    openLoggedRef.current = true;
    logResultLeadOpened({
      ...logCtx,
      resultType,
      payMode,
      contractPrice: Math.round(contractNum) || undefined,
      reopened: wentToFundingRef.current || undefined,
    });
  }, [visible, screen, resultType, payMode, contractNum, logCtx]);

  const updateRow = useCallback((pid: string, patch: Partial<PaymentRow>) => {
    setRows((prev) => prev.map((r) => (r.pid === pid ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback(
    (pid: string) => {
      const gone = rows.find((r) => r.pid === pid);
      if (gone) {
        logResultLeadRowRemoved({
          ...logCtx,
          kind: gone.kind,
          amount: effectiveRowAmount(gone, activeRows, contractNum),
          method: gone.method || undefined,
          methodLabel: pricing.plans[gone.method]?.label || gone.methodLabel,
        });
      }
      setRows((prev) => prev.filter((r) => r.pid !== pid));
    },
    [rows, activeRows, contractNum, pricing.plans, logCtx]
  );

  const addRow = useCallback(
    (kind: PaymentKind) => {
      logResultLeadRowAdded({
        ...logCtx,
        kind,
        rowCount: activeRows.filter((r) => r.kind === kind).length + 1,
      });
      setRows((prev) => {
        const next = [...prev];
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
    },
    [activeRows, logCtx]
  );

  const selectRowMethod = useCallback(
    (pid: string, key: string) => {
      const row = rows.find((r) => r.pid === pid);
      if (row && key && key !== row.method) {
        logResultLeadMethodSelected({
          ...logCtx,
          kind: row.kind,
          method: key,
          methodLabel: pricing.plans[key]?.label,
          amount: effectiveRowAmount(row, activeRows, contractNum),
        });
      }
      setRows((prev) => swapRowMethod(prev, pid, key, pricing.plans));
    },
    [rows, activeRows, contractNum, pricing.plans, logCtx]
  );

  const switchPayMode = useCallback(
    (next: PayMode, allowed: boolean) => {
      if (next === payMode) return;
      if (!allowed) {
        setStructureNudge(true);
        return;
      }
      setStructureNudge(false);
      logResultLeadStructureChanged({ ...logCtx, from: payMode, to: next });
      setRows((prev) => {
        const wantUpfront = next === 'upfront';
        const already = prev.some((r) => (wantUpfront ? r.kind === 'up' : r.kind !== 'up'));
        if (already) return prev;
        return wantUpfront
          ? // Upfront means the whole contract now, so it opens holding all of it.
            [...prev, { pid: newPaymentId(), kind: 'up', amount: contractNum > 0 ? String(Math.round(contractNum)) : '', method: '' }]
          : [
              ...prev,
              { pid: newPaymentId(), kind: 'down', amount: '', method: '' },
              { pid: newPaymentId(), kind: 'bal', amount: '', method: '', auto: true },
            ];
      });
      setPayMode(next);
    },
    [payMode, contractNum, logCtx]
  );

  const selectStructure = useCallback(
    (next: PayStructure, allowed: boolean) => {
      if (next === payStructureOf(payMode, noDown)) return;
      if (!allowed) {
        setStructureNudge(true);
        return;
      }
      if (next === 'upfront') {
        setNoDown(false);
        switchPayMode('upfront', true);
        return;
      }
      if (payMode === 'upfront') switchPayMode('split', true);
      setStructureNudge(false);
      if (next === 'none') setRows((prev) => prev.map((r) => (r.kind === 'down' ? { ...r, amount: '' } : r)));
      // Picking "Down Payment" opens its first line straight away — no extra tap on
      // "Add payment method". Inserted before the balance row so the order stays down -> bal.
      if (next === 'split') {
        setRows((prev) => {
          if (prev.some((r) => r.kind === 'down')) return prev;
          const at = prev.findIndex((r) => r.kind === 'bal');
          const row = { pid: newPaymentId(), kind: 'down' as const, amount: '', method: '' };
          return at < 0 ? [...prev, row] : [...prev.slice(0, at), row, ...prev.slice(at)];
        });
      }
      setNoDown(next === 'none');
    },
    [payMode, noDown, switchPayMode]
  );

  useEffect(() => {
    if (!isSale || contractNum <= 0 || payMode === 'upfront') return;
    const hasAuto = activeRows.some((r) => r.auto);
    const gap = contractNum - assignedTotal(activeRows, contractNum);
    if (hasAuto || gap <= EPS) return;
    const candidates = activeRows.filter((r) => r.kind === 'bal' && !r.decision);
    const target = candidates[candidates.length - 1];
    if (!target) return;
    if (parseFloat(target.amount || '0') > 0) return;
    updateRow(target.pid, { auto: true });
  }, [activeRows, contractNum, isSale, payMode, updateRow]);

  const needsRowId = useMemo(() => needsAttentionRowId(activeRows, banners, payMode), [activeRows, banners, payMode]);

  const structureIsLocked = useMemo(() => structureLocked(payments), [payments]);

  const decisionBanners = banners.map((b) => (
    <View key={b.id} style={{ backgroundColor: b.tone === 'bad' ? FUND.RED_BG : FUND.AMBER_BG, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 }}>
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, lineHeight: 17, color: b.tone === 'bad' ? FUND.RED_TEXT : FUND.AMBER_TEXT }}>
        {b.text}
      </Text>
    </View>
  ));

  useEffect(() => {
    setSaveError(null);
  }, [rows, contractPrice, payMode]);

  const totalAssigned = useMemo(() => assignedTotal(activeRows, contractNum), [activeRows, contractNum]);
  const resultBlockers = useMemo(
    () => confirmBlockers(activeRows, contractNum, payMode, { plans: pricing.plans, online }),
    [activeRows, contractNum, payMode, pricing.plans, online]
  );
  const saleReady = resultBlockers.length === 0;

  const goFunding = useCallback(async () => {
    if (resultBlockers.length) {
      FlashMessage.error('Not ready to confirm', resultBlockers[0]);
      return;
    }
    const upsert = toUpsertRows(activeRows, contractNum, pricing.plans);

    if (!isOnline()) {
      const work = ensureOfflineWorkForLead(lead || { _id: leadLogId });
      if (!work?.clientId) {
        setSaveError('This sale could not be saved on the device. Reconnect and confirm again.');
        return;
      }
      saveOfflineFunding(work.clientId, {
        contractPrice: Math.round(contractNum),
        payments: upsert,
        payMode,
        ...(calculatorId ? { calculatorId: String(calculatorId) } : {}),
      });
      logResultLeadConfirmed({
        ...logCtx,
        contractPrice: Math.round(contractNum),
        payMode,
        paymentCount: upsert.length,
        payments: upsert.map((r) => ({ kind: r.kind, method: r.method, amount: r.amount })),
      });
      // Online this is logged by `funding.savePayments`; the offline save skips that hook.
      logFundingPaymentsSaved({
        ...logCtx,
        contractPrice: Math.round(contractNum),
        payMode,
        payments: upsert.map((r) => ({ kind: r.kind, method: r.method, amount: r.amount })),
        ok: true,
      });
      setSaveError(null);
      // The rep gets the SAME Funding step as online. It used to jump straight to Build Job,
      // so the split they had just entered was never shown back and Submit Funding never ran.
      // Every row here is a check - `confirmBlockers` refuses a card or loan with no signal.
      setOfflineWorkId(work.clientId);
      setOfflineRecord(
        offlineFundingRecord(String(leadLogId || work.clientId), contractNum, upsert, payMode)
      );
      logFundingOpened({
        ...logCtx,
        contractPrice: Math.round(contractNum),
        paymentCount: upsert.length,
        payMode,
      });
      wentToFundingRef.current = true;
      setScreen('funding');
      return;
    }
    logResultLeadConfirmed({
      ...logCtx,
      contractPrice: Math.round(contractNum),
      payMode,
      paymentCount: upsert.length,
      payments: upsert.map((r) => ({ kind: r.kind, method: r.method, amount: r.amount })),
    });
    const res = await funding.savePayments(Math.round(contractNum), upsert, payMode);
    if (!res.ok) {
      setSaveError(res.error?.message || 'The payments could not be saved.');
      return;
    }
    setSaveError(null);
    logFundingOpened({
      ...logCtx,
      contractPrice: Math.round(contractNum),
      paymentCount: upsert.length,
      payMode,
    });

    if (leadLogId) {
      LeadService.updateLeadTimelineProgress(leadLogId, {
        salesProcess: 'completed',
        leadResulted: 'completed',
      }).catch((e: any) =>
        console.warn('[ResultJobModal] timeline progress (confirm) failed:', e?.message || e)
      );
    }
    wentToFundingRef.current = true;
    setScreen('funding');
  }, [resultBlockers, contractNum, activeRows, pricing.plans, payMode, noDown, funding, logCtx, leadLogId, lead, calculatorId]);

  const goResult = useCallback(() => {
    const applied = applyDecisionsToRows(activeRows, payments, contractNum, payMode);
    logFundingEditPayments({ ...logCtx, reassigning: applied.banners.length > 0 });
    const inactive = rows.filter((r) => !activeRows.includes(r));
    setRows([...applied.rows, ...inactive]);
    setBanners(applied.banners);
    if (applied.banners.length) setPriceUnlocked(true);
    funding.clearServerBlockers();
    setOfflineRecord(null);
    setStructureNudge(false);
    setScreen('result');
  }, [rows, activeRows, payments, contractNum, payMode, funding, logCtx]);

  const covered = useMemo(() => coverageOK(payments, contractNum), [payments, contractNum]);
  const localBlockers = useMemo(
    () => fundingBlockers(payments, contractNum, { setupBlocked: !!funding.paymentsSetupError }),
    [payments, contractNum, funding.paymentsSetupError]
  );
  const blockers = funding.serverBlockers ?? localBlockers;
  const declineHappened = useMemo(() => hasDecline(funding.record), [funding.record]);
  const attempts = useMemo(() => attemptLog(funding.record), [funding.record]);
  const lastSyncedAt = useMemo(() => {
    const stamps = payments.map((p) => p.syncedAt).filter(Boolean) as string[];
    if (!stamps.length) return null;
    return formatStamp(stamps.sort().slice(-1)[0]);
  }, [payments]);

  useEffect(() => {
    if (!declineHappened && resultChoice === 'bank_decline') setResultChoice('sale');
  }, [declineHappened, resultChoice]);

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

  const handleSendLink = useCallback(
    async (channel: FundingChannel, destination?: string): Promise<boolean> => {
      if (!linkTarget) return false;
      const res = await funding.markLinkSent(linkTarget, channel, destination);
      if (res.ok && res.data?.reissued) {
        const fresh = await funding.fetchLink(linkTarget);
        setLinkUrl(fresh.ok ? fresh.data?.url || '' : '');
      }
      return res.ok;
    },
    [funding, linkTarget]
  );

  // Taking a check in hand is a real-world act, not a server one - it has to work at a door
  // with no signal. The row is ticked on the device record and the POST is queued against the
  // same pid the save carries.
  const handleMarkCollected = useCallback(
    (pid: string) => {
      if (isOnline()) return funding.markCheckCollected(pid);
      if (offlineWorkId) saveOfflineFundingCollected(offlineWorkId, pid);
      // Online this is logged by `funding.markCheckCollected`; the offline tick skips that hook.
      const row = offlineRecord?.payments.find((p) => p.pid === pid);
      logFundingCheckCollected({
        ...logCtx,
        payment: row
          ? { pid: row.pid, method: row.method, type: row.type, kind: row.kind, amount: row.amount }
          : { pid },
        ok: true,
      });
      setOfflineRecord((prev) =>
        prev
          ? { ...prev, payments: prev.payments.map((p) => (p.pid === pid ? { ...p, collected: true } : p)) }
          : prev
      );
      return undefined;
    },
    [funding, offlineWorkId, offlineRecord, logCtx]
  );

  const handleSetResult = useCallback(
    async (next: 'sale' | 'bank_decline') => {
      const res = await funding.setResult(next === 'bank_decline' ? 'bankDecline' : 'sale');
      if (res.ok) setResultChoice(next);
    },
    [funding]
  );

  const linkPayment = useMemo(() => payments.find((p) => p.pid === linkTarget) || null, [payments, linkTarget]);

  const demoDisabled =
    !demoReason || (demoReason === 'Other (Explain)' && !reasonExplanation.trim()) || !(contractNum > 0);
  const submitDisabled = funding.isSubmitting || (!bankDeclined && localBlockers.length > 0);

  const handleBuild = useCallback(async () => {
    const isDemo = resultType === 'demo';

    if (!isDemo) {
      if (isOnline()) {
        const res = await funding.submit();
        if (!res.ok) return;
      } else {
        // Queued, not dropped: the save already sits behind the `funding` step, and this
        // submits it once that lands. Without it the deal reached the office unsubmitted.
        if (offlineWorkId) saveOfflineFundingSubmit(offlineWorkId);
        // Online this is logged by `funding.submit`; the queued submit skips that hook.
        logFundingSubmitted({
          ...logCtx,
          contractPrice: Math.round(contractNum) || 0,
          paymentCount: offlineRecord?.payments.length ?? 0,
          bankDecline: offlineRecord?.result === 'bankDecline',
          ok: true,
        });
        logResultLeadBuildJob({
          ...logCtx,
          resultType,
          contractPrice: Math.round(contractNum) || undefined,
        });
        FlashMessage.info(
          'Saved on this device',
          'The funding uploads automatically when you have signal.'
        );
      }
    } else {
      logResultLeadBuildJob({
        ...logCtx,
        resultType,
        contractPrice: Math.round(contractNum) || undefined,
        reason: demoReason || undefined,
      });
    }

    onConfirm?.({
      resultType,
      oneLeg,
      contractPrice: isDemo ? undefined : contractNum || undefined,
      lastPriceQuoted: isDemo ? contractNum || undefined : undefined,
      downPayment: isDemo ? undefined : downTotal || undefined,
      balance: isDemo ? undefined : balanceTotal,
      downPaymentMethod: primaryDownMethod || undefined,
      balancePaymentMethod: primaryBalanceMethod || undefined,
      downPayments: isDemo ? undefined : allocations.downPayments,
      balancePayments: isDemo ? undefined : allocations.balancePayments,
      demoReason: isDemo ? demoReason : undefined,
      reasonExplanation: isDemo && demoReason === 'Other (Explain)' ? reasonExplanation : undefined,
      versatile,
      pineapple,
      ...(isDemo
        ? {}
        : {
            bankDecline: bankDeclined,
            payments,
            fundingAttempts: funding.record?.attemptHistory || [],
          }),
    });
  }, [
    resultType, oneLeg, contractNum, downTotal, balanceTotal, primaryDownMethod, primaryBalanceMethod,
    allocations, demoReason, reasonExplanation, versatile, pineapple, bankDeclined, payments, funding, onConfirm,
    logCtx, offlineWorkId, offlineRecord,
  ]);

  const priceEditable = isRehashed || priceUnlocked;
  const lockedTotal = useMemo(
    () => activeRows.filter((r) => r.decision).reduce((n, r) => n + effectiveRowAmount(r, activeRows, contractNum), 0),
    [activeRows, contractNum]
  );
  const priceBelowLocked = priceUnlocked && contractNum < lockedTotal;

  const onFunding = screen === 'funding';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <PadAwareCenter>
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
                <Text style={{ fontSize: FS.LEAD, fontFamily: PS.semibold, color: '#fff' }}>{onFunding ? 'Funding' : 'Result Lead'}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <NumPadScrollView style={{ paddingHorizontal: 20, paddingTop: 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {onFunding ? (
                <FundingView
                  payments={payments}
                  payMode={payMode}
                  contractTotal={contractNum}
                  covered={covered}
                  bankDeclined={bankDeclined}
                  log={attempts}
                  lastSyncedAt={lastSyncedAt}
                  syncingAll={funding.syncingAll}
                  busyPid={funding.busyPid}
                  paymentsSetupError={funding.paymentsSetupError}
                  onSyncAll={funding.syncAll}
                  onSyncOne={funding.syncPayment}
                  onSendLink={openSendSheet}
                  onMarkCollected={handleMarkCollected}
                  onChargeCard={funding.chargeCard}
                  onActivate={funding.activateLoan}
                  onRecordDecision={funding.recordDecision}
                  onReactivate={funding.reactivateLoan}
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
                        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: -14, marginBottom: 18, marginHorizontal: 4 }}>
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
                              style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: '#1C252E', padding: 0, textAlignVertical: 'top' }}
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
                    <View style={{ backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 22, paddingHorizontal: 8, paddingTop: 20, paddingBottom: 16, marginBottom: 22 }}>
                      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL, paddingHorizontal: 4, paddingBottom: 14 }}>
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
                              <Text style={{ fontSize: FS.MICRO, fontFamily: PS.extrabold, letterSpacing: 0.4, textTransform: 'uppercase', color: FUND.AMBER_TEXT }}>Editable</Text>
                            </View>
                          ) : null
                        }
                      />
                      {priceUnlocked && (
                        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, lineHeight: 16, marginTop: -12, marginBottom: 16, marginHorizontal: 4, color: priceBelowLocked ? FUND.RED_TEXT : FUND.AMBER_TEXT }}>
                          {priceBelowLocked
                            ? `Contract price is below the $${lockedTotal.toLocaleString()} already approved and locked. Void that application before going lower.`
                            : PRICE_UNLOCK_HINT}
                        </Text>
                      )}

                      {/* How the contract is being paid. Locked once a payment has
                          started — see `switchPayMode`. */}
                      <DropdownChoice<PayStructure>
                        label="How is this being paid?"
                        value={payStructureOf(payMode, noDown)}
                        onSelect={selectStructure}
                        hint={structureHint(payMode, structureIsLocked, structureNudge, noDown)}
                        hintTone={structureIsLocked ? 'warn' : 'muted'}
                        options={[
                          { value: 'none', title: 'No Down Payment', disabled: structureIsLocked },
                          { value: 'split', title: 'Down Payment', disabled: structureIsLocked },
                          { value: 'upfront', title: 'Paid in Full Upfront', disabled: structureIsLocked },
                        ]}
                      />

                      {payMode === 'upfront' ? (
                        <>
                          {decisionBanners}
                          <PaymentRowsGroup
                            title="Upfront"
                            total={downTotal}
                            rows={upRows}
                            allRows={activeRows}
                            price={contractNum}
                            plans={pricing.plans}
                            options={pricing.outcomeDownPaymentMethods}
                            needsRowId={needsRowId}
                            canAdd={MULTI_METHOD_ENABLED}
                            onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                            onChangeMethod={selectRowMethod}
                            onRemove={removeRow}
                            onAdd={() => addRow('up')}
                            footer={
                              <>
                                {/* Upfront has no remainder row to hide a gap in, so
                                    this is the only running total the rep gets. */}
                                <CoverageBar assigned={totalAssigned} target={contractNum} />
                                <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 16, marginTop: 9, marginHorizontal: 4, color: FUND.MUTED }}>
                                  Paid in full at the table, so there is no balance to finance. Lender plans are not offered here.
                                </Text>
                              </>
                            }
                          />
                        </>
                      ) : (
                        <>
                          {!noDown && (
                          <PaymentRowsGroup
                            title="Down Payment"
                            total={downTotal}
                            rows={downRows}
                            allRows={activeRows}
                            price={contractNum}
                            plans={pricing.plans}
                            options={pricing.outcomeDownPaymentMethods}
                            needsRowId={needsRowId}
                            canAdd={MULTI_METHOD_ENABLED}
                            onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                            onChangeMethod={selectRowMethod}
                            onRemove={removeRow}
                            onAdd={() => addRow('down')}
                          />
                          )}

                          {decisionBanners}

                          <PaymentRowsGroup
                            title="Balance"
                            total={balanceTotal}
                            rows={balRows}
                            allRows={activeRows}
                            price={contractNum}
                            plans={pricing.plans}
                            categories={pricing.categories}
                            needsRowId={needsRowId}
                            canAdd={MULTI_METHOD_ENABLED}
                            onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                            onChangeMethod={selectRowMethod}
                            onRemove={removeRow}
                            onAdd={() => addRow('bal')}
                          />
                        </>
                      )}
                    </View>
                  )}

                  {!!calculatorTitle && (
                    <View style={{ marginBottom: 20, padding: 12, backgroundColor: '#F4F6F8', borderRadius: 8 }}>
                      <Text style={{ fontSize: FS.TINY, fontFamily: PS.regular, color: '#919EAB' }}>Calculator</Text>
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
                        <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#1C252E' }}>Job Summary</Text>
                      </View>
                      <View style={{ backgroundColor: '#E5D9FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, color: '#6B46C1' }}>{items.length} Item{items.length === 1 ? '' : 's'}</Text>
                      </View>
                    </View>
                    {items.length === 0 ? (
                      <Text style={{ fontSize: FS.SMALL, color: '#94A3B8', fontFamily: PS.semibold, paddingVertical: 8 }}>No items</Text>
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
                                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.black, color: meta.style.color }}>{meta.label} ({count})</Text>
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
                                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: '#1C252E', flex: 1 }}>
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
                      <Text style={{ fontFamily: PS.bold, fontSize: FS.TINY, color: '#212B36' }}>Versatile</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setPineapple((v) => !v)} style={{ flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFAB00', opacity: pineapple ? 1 : 0.55 }}>
                      <Text style={{ fontFamily: PS.bold, fontSize: FS.TINY, color: '#212B36' }}>Pineapple</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </NumPadScrollView>

            {/* Footer */}
            <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#919EAB14' }}>
              {onFunding ? (
                <>
                  <BlockerList
                    items={blockers}
                    readyText="✓ Every payment is as far as you can take it. Ready to submit."
                    override={
                      bankDeclined
                        ? { title: 'No funding to satisfy.', body: 'The job is closing as a bank decline.' }
                        : undefined
                    }
                  />
                  <TouchableOpacity
                    onPress={goResult}
                    style={{ height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.6, borderColor: FUND.BORDER, marginBottom: 10 }}
                  >
                    <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: FUND.SUBTEXT }}>Edit payments</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={submitDisabled}
                    onPress={handleBuild}
                    style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: submitDisabled ? '#E9EBEE' : '#4CBB17' }}
                  >
                    <Text style={{ color: submitDisabled ? '#A8AEB6' : '#fff', fontFamily: PS.bold, fontSize: FS.BODY_LG, letterSpacing: 0.5 }}>
                      {bankDeclined ? 'Submit Bank Decline' : 'Submit Funding'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : isSale ? (
                <>
                  {/* The server's own refusal, in the same place as the local
                      blockers — one column of reasons the button will not go. */}
                  {!!saveError && (
                    <View style={{ backgroundColor: FUND.RED_BG, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 11 }}>
                      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, lineHeight: 17, color: FUND.RED_TEXT }}>
                        {saveError}
                      </Text>
                    </View>
                  )}
                  {/* Same control as the Submit footer — the reasons are visible
                      before the tap, not discovered by it. */}
                  <BlockerList items={resultBlockers} title="Before you can confirm:" />
                  <TouchableOpacity
                    disabled={!saleReady}
                    onPress={() => goFunding()}
                    style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: saleReady ? '#4CBB17' : '#E9EBEE' }}
                  >
                    <Text style={{ color: saleReady ? '#fff' : '#A8AEB6', fontFamily: PS.bold, fontSize: FS.BODY_LG, letterSpacing: 0.5 }}>
                      Confirm
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  disabled={demoDisabled}
                  onPress={handleBuild}
                  style={{ height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: demoDisabled ? '#919EAB' : '#4CBB17' }}
                >
                  <Text style={{ color: '#fff', fontFamily: PS.bold, fontSize: FS.BODY_LG, letterSpacing: 0.5 }}>Build Job</Text>
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
                blockedReason={funding.paymentsSetupError}
                onSend={handleSendLink}
                onCopyLink={() =>
                  logFundingLinkCopied({
                    ...logCtx,
                    payment: {
                      pid: linkPayment.pid,
                      method: linkPayment.method,
                      type: linkPayment.type,
                      kind: linkPayment.kind,
                      amount: linkPayment.amount,
                    },
                  })
                }
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
        </PadAwareCenter>

        {/* Every banner this sheet raises — its own, and the ones `useFunding` raises
            from inside an endpoint call — lands here rather than on the app-root
            instance, which is OUTSIDE this Modal's view tree and therefore behind it.
            Last child, so it draws over the card. */}
        <ModalFlashHost active={visible} />
      </KeyboardAvoidingView>
    </Modal>
  );
}
