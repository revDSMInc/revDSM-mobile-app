import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { planBelowMin, belowMinMsg, compactPlanLabel, type DealPlan, type PayCategory } from '../../hooks/useDealPricing';
import { useIsOnline } from '../../../../hooks/useIsOnline';
import {
  blockedOfflineMsg,
  driftNote,
  effectiveRowAmount,
  isRemovableRow,
  isMethodLockedRow,
  isSettledRow,
  lockedMethodNote,
  lenderState,
  planBlockedOffline,
  showsChip,
  type LenderTone,
  type PaymentRow,
} from '../../utils/funding';

interface Props {
  title: string;
  total?: number;
  rows: PaymentRow[];
  allRows: PaymentRow[];
  price: number;
  plans: Record<string, DealPlan>;
  options?: { label: string; value: string }[];
  categories?: PayCategory[];
  needsRowId?: string | null;
  canAdd?: boolean;
  layout?: 'panel' | 'plain';
  onChangeAmount: (id: string, text: string) => void;
  onChangeMethod: (id: string, key: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onRestore?: (id: string, archivedId: string) => void;
  footer?: React.ReactNode;
}

function StatusPill({ decision }: { decision: 'full' | 'short' | 'declined' }) {
  const declined = decision === 'declined';
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: declined ? FUND.RED_BG : FUND.GREEN_BG }}>
      <Text style={{ fontSize: FS.MICRO, fontFamily: PS.extrabold, letterSpacing: 0.4, textTransform: 'uppercase', color: declined ? FUND.RED_TEXT : FUND.GREEN_TEXT }}>
        {declined ? 'Declined' : 'Approved'}
      </Text>
    </View>
  );
}

const CHIP: Record<LenderTone, { border: string; bg: string; name: string; sub: string; dot: string }> = {
  neutral: { border: '#E5E7EB', bg: '#F9FAFB', name: '#111827', sub: '#6B7280', dot: '#D1D5DB' },
  pending: { border: '#FDE68A', bg: '#FFFBEB', name: '#92400E', sub: '#B45309', dot: '#F59E0B' },
  approved: { border: '#BBF0D4', bg: '#F1FDF7', name: '#0F5132', sub: '#4B9E78', dot: '#12A96B' },
  declined: { border: '#FECDD3', bg: '#FFF1F2', name: '#9F1239', sub: '#E11D48', dot: '#E11D48' },
};

/** "Check (Bank Fee: 0%)" -> "Check". Fee text is noise on a sale sheet. */
function stripBankFee(label?: string): string {
  return String(label || '').replace(/\s*\(\s*Bank Fee:[^)]*\)/gi, '').trim();
}

/** Investment-Center shorthand: CK / CC / AMEX for basic methods, "GS2511, 0% APR, 6M" for financing. */
function shortMethodLabel(plans: Record<string, DealPlan>, key?: string, fallback?: string, codeOnly = false): string {
  const plan = plans[key || ''];
  if (plan?.type === 'financing') {
    const c = compactPlanLabel(plans, key);
    if (c) return codeOnly ? c.split(',')[0].trim() : c;
  }
  const base = stripBankFee(plan?.label || fallback);
  const k = String(key || '').toLowerCase();
  if (/^check\b/i.test(base) || k === 'check') return 'CK';
  if (/^amex\b/i.test(base) || k === 'amex') return 'AMEX';
  if (/^(mc|visa)/i.test(base)) return 'CC';
  return base;
}

export function PaymentRowsGroup({
  title,
  total,
  rows,
  allRows,
  price,
  plans,
  options,
  categories,
  needsRowId,
  canAdd = true,
  layout = 'panel',
  onChangeAmount,
  onChangeMethod,
  onRemove,
  onAdd,
  onRestore,
  footer,
}: Props) {
  const online = useIsOnline();
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [lockedNoteId, setLockedNoteId] = useState<string | null>(null);
  const openLockedNote = (pid: string) => {
    setOpenRowId(null);
    setLockedNoteId((cur) => (cur === pid ? null : pid));
  };
  const plain = layout === 'plain';

  const renderOptions = (row: PaymentRow, amount: number) => (
    <View
      style={
        plain
          ? { borderWidth: 1.5, borderColor: FUND.TEXT, borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden', marginTop: -4, marginBottom: 8 }
          : { borderWidth: 1.6, borderColor: FUND.TEXT, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: '#fff', overflow: 'hidden' }
      }
    >
      {options?.map((o) => {
        const isSel = o.value === row.method;
        const offBlocked = planBlockedOffline(plans, o.value, online);
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => {
              if (offBlocked) {
                FlashMessage.warning('Needs a connection', blockedOfflineMsg(plans, o.value));
                return;
              }
              onChangeMethod(row.pid, o.value);
              setOpenRowId(null);
            }}
            style={{ paddingHorizontal: 13, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#EEF0F2', opacity: offBlocked ? 0.5 : 1, backgroundColor: isSel ? FUND.FILL : 'transparent' }}
          >
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontSize: FS.BODY_LG, fontFamily: isSel ? PS.bold : PS.medium, color: isSel ? FUND.TEXT : FUND.SUBTEXT }}>{o.label}</Text>
              {offBlocked && (
                <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 2 }}>
                  Needs a connection
                </Text>
              )}
            </View>
            {isSel && <Ionicons name="checkmark" size={15} color={FUND.TEXT} />}
          </TouchableOpacity>
        );
      })}

      {categories?.map((cat) => (
        <View key={cat.title || 'basic'}>
          {!!cat.title && (
            <View style={{ paddingHorizontal: 13, paddingVertical: 10, backgroundColor: cat.bg }}>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 0.3, textTransform: 'uppercase', color: cat.text }}>{cat.title}</Text>
            </View>
          )}
          {cat.plans.map((key) => {
            const plan = plans[key];
            if (!plan) return null;
            const gateAt = amount > 0 ? amount : price;
            const belowMin = planBelowMin(plans, key, gateAt);
            const offBlocked = planBlockedOffline(plans, key, online);
            const dimmed = belowMin || offBlocked;
            const isSel = key === row.method;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => {
                  if (offBlocked) {
                    FlashMessage.warning('Needs a connection', blockedOfflineMsg(plans, key));
                    return;
                  }
                  if (belowMin) {
                    FlashMessage.warning('Payment plan', belowMinMsg(plans, key, gateAt));
                    return;
                  }
                  onChangeMethod(row.pid, key);
                  setOpenRowId(null);
                }}
                style={{ paddingHorizontal: 13, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#EEF0F2', opacity: dimmed ? 0.5 : 1, backgroundColor: isSel ? FUND.FILL : 'transparent' }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: FS.BODY, fontFamily: isSel ? PS.bold : PS.medium, color: isSel ? FUND.TEXT : FUND.SUBTEXT }}>{plan.label}</Text>
                  {offBlocked ? (
                    <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 2 }}>
                      Needs a connection
                    </Text>
                  ) : belowMin && !!plan.minPrice ? (
                    <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 2 }}>
                      Requires ${plan.minPrice.toLocaleString()}+
                    </Text>
                  ) : null}
                </View>
                {isSel && <Ionicons name="checkmark" size={15} color={FUND.TEXT} />}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );

  const body = rows.map((row, rowIndex) => {
    const locked = isMethodLockedRow(row);
    const settled = isSettledRow(row);
    const needs = row.pid === needsRowId;
    const amount = effectiveRowAmount(row, allRows, price);
    // The closed box only has room for the plan CODE ("GS2511"); APR / months live in the option list.
    const label = shortMethodLabel(plans, row.method, row.methodLabel, true);
    const isOpen = openRowId === row.pid;
    const readOnlyAmount = settled || !!row.auto;

    const removable = canAdd && isRemovableRow(row) && (!row.auto || amount === 0);

    const chip = plain && showsChip(row);
    const lender = chip ? lenderState(row, plans[row.method]?.type === 'financing') : null;
    const tone = lender ? CHIP[lender.tone] : CHIP.neutral;
    const drift = driftNote(row);
    const archived = row.archived || [];

    const fieldBorder = needs ? FUND.AMBER : FUND.BORDER;
    const fieldBg = needs ? FUND.AMBER_BG : locked || row.auto ? FUND.FILL : '#fff';

    const amountCell = (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: FS.LEAD, fontFamily: PS.bold, color: readOnlyAmount ? FUND.MUTED : FUND.TEXT, marginRight: 3 }}>$</Text>
          {readOnlyAmount ? (
            <Text style={{ ...(plain ? { flex: 1 } : { flexShrink: 1 }), fontSize: FS.LEAD, fontFamily: PS.bold, color: locked ? FUND.TEXT : plain ? '#6B7280' : FUND.MUTED }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {amount.toLocaleString()}
            </Text>
          ) : (
            <TextInput
              style={{ ...(plain ? { flex: 1 } : { minWidth: 56, width: Math.max(56, (row.amount.length || 1) * 9 + 6), maxWidth: '100%' }), fontSize: FS.LEAD, fontFamily: PS.bold, color: FUND.TEXT, padding: 0 }}
              value={row.amount}
              onChangeText={(t) => onChangeAmount(row.pid, t.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              placeholderTextColor={FUND.MUTED}
              keyboardType="numeric"
            />
          )}
        </View>
        {/* The lender is still committed to `Prior`; the figure above is what the
            job needs after the re-price. Saying so is the whole point — the two
            differing is not an error state, it is a reactivation waiting to happen. */}
        {!!drift && (
          <View style={{ marginTop: 4 }}>
            <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, color: '#94A3B8' }}>{drift.prior}</Text>
            <Text style={{ fontSize: FS.TINY, fontFamily: PS.extrabold, color: drift.up ? '#B45309' : '#0369A1' }}>{drift.delta}</Text>
          </View>
        )}
      </>
    );

    const methodCell = chip ? (
      <TouchableOpacity
        activeOpacity={locked ? 0.8 : 1}
        disabled={!locked}
        onPress={() => openLockedNote(row.pid)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1.5, borderColor: tone.border, backgroundColor: tone.bg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1, minWidth: 0 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.dot }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: label ? tone.name : FUND.MUTED }} numberOfLines={1}>
              {label || 'Select payment method'}
            </Text>
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: tone.sub, marginTop: 1 }} numberOfLines={2}>
              {lender?.sub}
            </Text>
          </View>
        </View>
        {/* Swap is how a method is changed on a row that reports a lender position —
            it opens the same catalogue the dropdown does. ⚠️ Absent once the row is
            locked, which is why the chip itself takes the tap and explains why. */}
        {!locked && (
          <TouchableOpacity
            onPress={() => setOpenRowId(isOpen ? null : row.pid)}
            style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1.5, borderColor: FUND.BORDER, backgroundColor: '#fff' }}
          >
            <Ionicons name={isOpen ? 'close' : 'swap-horizontal'} size={13} color="#374151" />
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: '#374151' }}>{isOpen ? 'Close' : 'Swap'}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    ) : (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => (locked ? openLockedNote(row.pid) : setOpenRowId(isOpen ? null : row.pid))}
        style={
          plain
            ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, minWidth: 0 }
            : { flex: 1, minWidth: 96, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderWidth: 1.6, borderColor: isOpen ? FUND.TEXT : fieldBorder, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: fieldBg }
        }
      >
        <Text style={{ flex: 1, fontSize: FS.BODY, fontFamily: label ? (plain ? PS.semibold : PS.bold) : PS.semibold, color: label ? '#374151' : FUND.MUTED }} numberOfLines={1}>
          {label || 'Select Payment Method'}
        </Text>
        {row.decision && !plain ? (
          <StatusPill decision={row.decision} />
        ) : locked ? (
          <Ionicons name="lock-closed" size={13} color={FUND.MUTED} />
        ) : (
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={FUND.MUTED} />
        )}
      </TouchableOpacity>
    );

    const archivedBlock = archived.length > 0 && (
      <View style={{ marginTop: 8, marginBottom: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: FUND.BORDER, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FAFAFA' }}>
        <Text style={{ fontSize: FS.TINY, fontFamily: PS.extrabold, letterSpacing: 0.4, color: '#9CA3AF', marginBottom: 8 }}>ARCHIVED METHODS</Text>
        {archived.map((a) => (
          <View
            key={a.archivedId}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ECECEE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#D1D5DB' }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: '#6B7280', textDecorationLine: 'line-through' }} numberOfLines={1}>
                  {stripBankFee(a.method)}
                </Text>
                <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: '#B0B4BA', marginTop: 1 }} numberOfLines={1}>
                  Archived{a.decision ? ` · ${a.decision === 'declined' ? 'Declined' : 'Approved'}` : ''}
                </Text>
              </View>
            </View>
            {!!onRestore && (
              <TouchableOpacity
                onPress={() => onRestore(row.pid, a.archivedId)}
                style={{ flexShrink: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#EFF4FF' }}
              >
                <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, color: '#2563EB' }}>Restore</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    );

    const lockedNote = lockedNoteId === row.pid && locked && (
      <View
        style={{
          flexDirection: 'row',
          gap: 7,
          alignItems: 'flex-start',
          marginTop: 6,
          marginBottom: 8,
          borderRadius: 10,
          borderWidth: 1.5,
          borderColor: FUND.AMBER,
          backgroundColor: FUND.AMBER_BG,
          paddingHorizontal: 11,
          paddingVertical: 9,
        }}
      >
        <Ionicons name="lock-closed" size={13} color="#92400E" style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, fontSize: FS.SMALL, fontFamily: PS.semibold, lineHeight: 16, color: '#92400E' }}>
          {lockedMethodNote(row)}
        </Text>
      </View>
    );

    if (plain) {
      return (
        <View key={row.pid}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              borderWidth: 1.5,
              borderColor: needs ? FUND.AMBER : '#E5E7EB',
              borderRadius: 14,
              paddingLeft: 12,
              paddingRight: 9,
              paddingVertical: 8,
              marginBottom: 7,
              backgroundColor: needs ? FUND.AMBER_BG : row.auto || locked ? '#F9FAFB' : '#fff',
            }}
          >
            <View style={{ flexBasis: chip ? '29%' : '36%', flexGrow: 0, flexShrink: 0 }}>{amountCell}</View>
            <View style={{ flex: 1, minWidth: 0 }}>{methodCell}</View>
            {removable && (
              <TouchableOpacity
                onPress={() => onRemove(row.pid)}
                style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1.5, borderColor: '#E5E7EB' }}
              >
                <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: '#374151' }}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          {lockedNote}
          {isOpen && !locked && renderOptions(row, amount)}
          {archivedBlock}
        </View>
      );
    }

    return (
      <View key={row.pid}>
        {/* One line per payment: amount box (sized to its digits, never truncated) ·
            method box (takes the rest) · remove. Rows were stacked into labelled
            cards for a while; reps asked for the compact line back. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <View style={{ flexShrink: 1, minWidth: 84, maxWidth: '55%', minHeight: 46, justifyContent: 'center', borderWidth: 1.6, borderColor: fieldBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: fieldBg }}>
            {amountCell}
          </View>
          {methodCell}
          {removable && (
            <TouchableOpacity onPress={() => onRemove(row.pid)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
              <Ionicons name="close" size={18} color={FUND.MUTED} />
            </TouchableOpacity>
          )}
        </View>

        {/* Options render IN FLOW below the row, matching the sheet's other
            selects — an absolutely-positioned menu inside a ScrollView is
            clipped by the sibling rows on Android. */}
        {lockedNote}
        {isOpen && !locked && renderOptions(row, amount)}
        {archivedBlock}
      </View>
    );
  });

  const addButton = (
    <TouchableOpacity
      onPress={onAdd}
      disabled={!canAdd}
      style={
        plain
          ? { alignSelf: 'flex-start', paddingHorizontal: 2, paddingVertical: 8, opacity: canAdd ? 1 : 0.45 }
          : { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 2, alignSelf: 'flex-start', opacity: canAdd ? 1 : 0.45 }
      }
    >
      {plain ? (
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: canAdd ? '#12A96B' : FUND.MUTED }}>+ Add payment method</Text>
      ) : (
        <>
          <View style={{ width: 19, height: 19, borderRadius: 10, backgroundColor: canAdd ? FUND.LAV_PILL : FUND.FILL, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.extrabold, color: canAdd ? FUND.LAV_TEXT : FUND.MUTED, lineHeight: 17 }}>+</Text>
          </View>
          <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: canAdd ? FUND.LAV_TEXT : FUND.MUTED }}>Add payment method</Text>
        </>
      )}
    </TouchableOpacity>
  );

  if (plain) {
    return (
      <View style={{ marginTop: 18 }}>
        <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#374151', marginBottom: 8 }}>
          {title}
          {rows.length > 1 && total != null && (
            <Text style={{ fontFamily: PS.bold, color: FUND.SUBTEXT }}>{`  ·  $${Math.round(total).toLocaleString()}`}</Text>
          )}
        </Text>
        {body}
        {addButton}
        {footer}
      </View>
    );
  }

  return (
    <View style={{ position: 'relative', backgroundColor: '#fff', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 16, paddingHorizontal: 10, paddingTop: 16, paddingBottom: 11, marginBottom: 14 }}>
      <Text style={{ position: 'absolute', top: -9, left: 16, paddingHorizontal: 6, backgroundColor: FUND.PANEL, fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.TEXT, zIndex: 2 }}>
        {title}
        {/* Shown only once the group holds MORE THAN ONE line — with a single row
            the total is the number already in the field beside it, and repeating
            it in the heading reads as a second, different figure. */}
        {rows.length > 1 && total != null && (
          <Text style={{ fontFamily: PS.bold, color: FUND.SUBTEXT }}>{`  ·  $${Math.round(total).toLocaleString()}`}</Text>
        )}
      </Text>

      {body}

      {/* Greyed rather than hidden when `canAdd` is off: a control that vanishes
          reads as a bug where a dimmed one reads as "not here". */}
      {addButton}

      {footer}
    </View>
  );
}
