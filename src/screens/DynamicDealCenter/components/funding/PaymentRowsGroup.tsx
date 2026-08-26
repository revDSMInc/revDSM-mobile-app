import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FUND } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { planBelowMin, belowMinMsg, type DealPlan, type PayCategory } from '../../hooks/useDealPricing';
import {
  driftNote,
  effectiveRowAmount,
  isRemovableRow,
  isSettledRow,
  lenderState,
  showsChip,
  type LenderTone,
  type PaymentRow,
} from '../../utils/funding';

/**
 * The **Down Payment** / **Balance** groups on the pricing screen.
 *
 * A sale is no longer one method per half of the contract — the rep can split
 * either half across as many instruments as the homeowner needs. Each line is an
 * amount against a payment method, and the Balance group carries one **auto** row
 * that always holds whatever is left of the contract price, so the two halves can
 * never silently stop adding up to the deal.
 *
 * A row that a lender has already answered is a **fact, not an input**: it locks,
 * shows the approved amount, and is stamped with what the lender said. Its money is
 * settled and re-typing it would misstate what was agreed to.
 *
 * ── two layouts, one component ──────────────────────────────────────────────
 * `panel` (default) is the Result Lead sheet's recessed treatment: a bordered
 * panel with its title notched out of `FUND.PANEL`. `plain` is the My Deals
 * mockup's: a bold heading over free-standing lines, a bordered **Remove** button
 * instead of an ✕, and — the substantive difference — a **lender chip** in place of
 * the method dropdown once a row has a lender position, carrying the status in
 * words and a **Swap** button.
 *
 * ⚠️ The layouts are a prop rather than two components because everything that can
 * be got WRONG here — the auto row's arithmetic, the below-minimum gate, when a row
 * may be removed, what the chip is allowed to claim — is shared. Forking would give
 * two screens two different answers to those, which is precisely the class of bug
 * this module keeps hitting.
 */

interface Props {
  title: string;
  /**
   * Running total for the heading (`Down Payment · $2,500`).
   *
   * ⚠️ Worth the prop rather than being derived here: once a half of the contract
   * is several lines, "does this add up to what we agreed" is no longer answerable
   * by reading one field, and the auto row hides the arithmetic by design.
   */
  total?: number;
  /** Only this group's rows, in display order. */
  rows: PaymentRow[];
  /** All rows across both groups — the auto amount is a whole-contract calculation. */
  allRows: PaymentRow[];
  price: number;
  plans: Record<string, DealPlan>;
  /** Flat option list (Down Payment: cash/card only — financing carries a balance, not a deposit). */
  options?: { label: string; value: string }[];
  /** Grouped option list (Balance: the full provider-grouped catalog). */
  categories?: PayCategory[];
  /** The row the rep must fill to close a gap a lender decision opened. */
  needsRowId?: string | null;
  /**
   * Can the rep add/remove payment lines? See `MULTI_METHOD_ENABLED` — on today.
   * Gates the remove control as well as Add: with Add disabled, a removed row could
   * not be brought back.
   */
  canAdd?: boolean;
  /** `panel` = the Result Lead sheet. `plain` = the My Deals mockup. */
  layout?: 'panel' | 'plain';
  onChangeAmount: (id: string, text: string) => void;
  onChangeMethod: (id: string, key: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  /**
   * Bring an archived plan back onto a row (`POST …/restore`).
   *
   * ⚠️ Symmetric on the server — whatever is current goes onto the shelf in
   * exchange — so the shelf is never empty after a restore and the action can be
   * undone the same way. Omit it and the archived block renders read-only.
   */
  onRestore?: (id: string, archivedId: string) => void;
  /**
   * Rendered inside the group, below Add — the Upfront group puts its
   * `CoverageBar` and its "no balance to finance" note here. A slot rather than
   * two more props, so a caller can put anything under its own rows without this
   * component learning what upfront means.
   */
  footer?: React.ReactNode;
}

/** Panel layout's compact verdict, inside the disabled select. */
function StatusPill({ decision }: { decision: 'full' | 'short' | 'declined' }) {
  const declined = decision === 'declined';
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: declined ? FUND.RED_BG : FUND.GREEN_BG }}>
      <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: declined ? FUND.RED_TEXT : FUND.GREEN_TEXT }}>
        {declined ? 'Declined' : 'Approved'}
      </Text>
    </View>
  );
}

/**
 * The mockup's lender chip palette. Four states, and the neutral one matters as
 * much as the others: a plan nobody has answered for yet must NOT borrow the green
 * of one that was approved.
 */
const CHIP: Record<LenderTone, { border: string; bg: string; name: string; sub: string; dot: string }> = {
  neutral: { border: '#E5E7EB', bg: '#F9FAFB', name: '#111827', sub: '#6B7280', dot: '#D1D5DB' },
  pending: { border: '#FDE68A', bg: '#FFFBEB', name: '#92400E', sub: '#B45309', dot: '#F59E0B' },
  approved: { border: '#BBF0D4', bg: '#F1FDF7', name: '#0F5132', sub: '#4B9E78', dot: '#12A96B' },
  declined: { border: '#FECDD3', bg: '#FFF1F2', name: '#9F1239', sub: '#E11D48', dot: '#E11D48' },
};

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
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const plain = layout === 'plain';

  /** The provider-grouped / flat option list, shared by the select and by Swap. */
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
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => {
              onChangeMethod(row.pid, o.value);
              setOpenRowId(null);
            }}
            style={{ paddingHorizontal: 13, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#EEF0F2', backgroundColor: isSel ? FUND.FILL : 'transparent' }}
          >
            <Text style={{ flex: 1, fontSize: 14, fontWeight: isSel ? '700' : '500', color: isSel ? FUND.TEXT : FUND.SUBTEXT }}>{o.label}</Text>
            {isSel && <Ionicons name="checkmark" size={15} color={FUND.TEXT} />}
          </TouchableOpacity>
        );
      })}

      {categories?.map((cat) => (
        <View key={cat.title || 'basic'}>
          {!!cat.title && (
            <View style={{ paddingHorizontal: 13, paddingVertical: 10, backgroundColor: cat.bg }}>
              <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase', color: cat.text }}>{cat.title}</Text>
            </View>
          )}
          {cat.plans.map((key) => {
            const plan = plans[key];
            if (!plan) return null;
            // Gate against THIS line's amount: a plan's minimum applies to the money
            // it actually carries, not to the whole contract.
            const gateAt = amount > 0 ? amount : price;
            const belowMin = planBelowMin(plans, key, gateAt);
            const isSel = key === row.method;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => {
                  if (belowMin) {
                    FlashMessage.warning('Payment plan', belowMinMsg(plans, key, gateAt));
                    return;
                  }
                  onChangeMethod(row.pid, key);
                  setOpenRowId(null);
                }}
                style={{ paddingHorizontal: 13, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#EEF0F2', opacity: belowMin ? 0.5 : 1, backgroundColor: isSel ? FUND.FILL : 'transparent' }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: isSel ? '700' : '500', color: isSel ? FUND.TEXT : FUND.SUBTEXT }}>{plan.label}</Text>
                  {belowMin && !!plan.minPrice && (
                    <Text style={{ fontSize: 11, fontWeight: '600', color: FUND.MUTED, marginTop: 2 }}>
                      Requires ${plan.minPrice.toLocaleString()}+
                    </Text>
                  )}
                </View>
                {isSel && <Ionicons name="checkmark" size={15} color={FUND.TEXT} />}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );

  const body = rows.map((row) => {
    // ⚠️ SETTLED, not merely "a lender answered". `decision` exists only on financing
    // rows, so this used to leave a CHARGED down payment card — or a collected check —
    // fully editable: Remove and Swap were both offered on money already with the
    // processor, and a swap resets the row server-side. See `isSettledRow`.
    const locked = isSettledRow(row);
    const needs = row.pid === needsRowId;
    const amount = effectiveRowAmount(row, allRows, price);
    const label = plans[row.method]?.label || row.methodLabel;
    const isOpen = openRowId === row.pid;
    const readOnlyAmount = locked || !!row.auto;

    // The auto row can only be dismissed once it has nothing left to hold; removing it
    // while money is unassigned would hide the shortfall. `isRemovableRow` adds the
    // server's own rule on top — it 409s a row with a sent link or a decision.
    const removable = canAdd && isRemovableRow(row) && (!row.auto || amount === 0);

    // The mockup's own split: the REMAINDER row draws the chip (`autoRowHtml`),
    // every other line draws a dropdown (`simpleRowHtml`). A decided row joins it
    // wherever it sits — a lender's verdict does not belong behind a chevron.
    // See `showsChip`; gating this on lender state alone is what dropped Swap.
    const chip = plain && showsChip(row);
    // A financing line nobody has applied for yet is genuinely outstanding, where a
    // check the install crew collects is not — see `lenderState`.
    const lender = chip ? lenderState(row, plans[row.method]?.type === 'financing') : null;
    const tone = lender ? CHIP[lender.tone] : CHIP.neutral;
    const drift = driftNote(row);
    const archived = row.archived || [];

    const fieldBorder = needs ? FUND.AMBER : FUND.BORDER;
    const fieldBg = needs ? FUND.AMBER_BG : locked || row.auto ? FUND.FILL : '#fff';

    // ── amount ───────────────────────────────────────────────────────────────
    const amountCell = (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: plain ? 16 : 18, fontWeight: '700', color: readOnlyAmount ? FUND.MUTED : FUND.TEXT, marginRight: 3 }}>$</Text>
          {readOnlyAmount ? (
            <Text style={{ flex: 1, fontSize: plain ? 16 : 18, fontWeight: '700', color: locked ? FUND.TEXT : plain ? '#6B7280' : FUND.MUTED }} numberOfLines={1}>
              {amount.toLocaleString()}
            </Text>
          ) : (
            <TextInput
              style={{ flex: 1, fontSize: plain ? 16 : 18, fontWeight: '700', color: FUND.TEXT, padding: 0 }}
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
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: '#94A3B8' }}>{drift.prior}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: '800', color: drift.up ? '#B45309' : '#0369A1' }}>{drift.delta}</Text>
          </View>
        )}
      </>
    );

    // ── method ───────────────────────────────────────────────────────────────
    const methodCell = chip ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1.5, borderColor: tone.border, backgroundColor: tone.bg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1, minWidth: 0 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.dot }} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: label ? tone.name : FUND.MUTED }} numberOfLines={1}>
              {label || 'Select payment method'}
            </Text>
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: tone.sub, marginTop: 1 }} numberOfLines={2}>
              {lender?.sub}
            </Text>
          </View>
        </View>
        {/* Swap is how a method is changed on a row that reports a lender position —
            it opens the same catalogue the dropdown does. */}
        {!locked && (
          <TouchableOpacity
            onPress={() => setOpenRowId(isOpen ? null : row.pid)}
            style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1.5, borderColor: FUND.BORDER, backgroundColor: '#fff' }}
          >
            <Ionicons name={isOpen ? 'close' : 'swap-horizontal'} size={13} color="#374151" />
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#374151' }}>{isOpen ? 'Close' : 'Swap'}</Text>
          </TouchableOpacity>
        )}
      </View>
    ) : (
      <TouchableOpacity
        activeOpacity={locked ? 1 : 0.8}
        disabled={locked}
        onPress={() => setOpenRowId(isOpen ? null : row.pid)}
        style={
          plain
            ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, minWidth: 0 }
            : { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderWidth: 1.6, borderColor: isOpen ? FUND.TEXT : fieldBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 14, backgroundColor: fieldBg }
        }
      >
        <Text style={{ flex: 1, fontSize: plain ? 13.5 : 13, fontWeight: label ? (plain ? '600' : '700') : '600', color: label ? '#374151' : FUND.MUTED }} numberOfLines={1}>
          {label || 'Select Payment Method'}
        </Text>
        {locked && row.decision && !plain ? (
          <StatusPill decision={row.decision} />
        ) : (
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={FUND.MUTED} />
        )}
      </TouchableOpacity>
    );

    // ── archived shelf ───────────────────────────────────────────────────────
    const archivedBlock = archived.length > 0 && (
      <View style={{ marginTop: 8, marginBottom: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: FUND.BORDER, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FAFAFA' }}>
        <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: '#9CA3AF', marginBottom: 8 }}>ARCHIVED METHODS</Text>
        {archived.map((a) => (
          <View
            key={a.archivedId}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ECECEE', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 6 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#D1D5DB' }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#6B7280', textDecorationLine: 'line-through' }} numberOfLines={1}>
                  {a.method}
                </Text>
                <Text style={{ fontSize: 10.5, fontWeight: '600', color: '#B0B4BA', marginTop: 1 }} numberOfLines={1}>
                  Archived{a.decision ? ` · ${a.decision === 'declined' ? 'Declined' : 'Approved'}` : ''}
                </Text>
              </View>
            </View>
            {!!onRestore && (
              <TouchableOpacity
                onPress={() => onRestore(row.pid, a.archivedId)}
                // `flexShrink: 0` — the plan name truncates before the button does.
                // Restore is the only way back to an archived plan, so it is the last
                // thing on the row that may be squeezed.
                style={{ flexShrink: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#EFF4FF' }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '800', color: '#2563EB' }}>Restore</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
    );

    // ── the line ─────────────────────────────────────────────────────────────
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
              paddingLeft: 14,
              paddingRight: 10,
              paddingVertical: 10,
              marginBottom: 8,
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
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#374151' }}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
          {isOpen && !locked && renderOptions(row, amount)}
          {archivedBlock}
        </View>
      );
    }

    return (
      <View key={row.pid} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <View style={{ flexBasis: '34%', flexGrow: 0, flexShrink: 0, flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: fieldBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: fieldBg }}>
            <View style={{ flex: 1 }}>{amountCell}</View>
          </View>

          {methodCell}

          <View style={{ width: 22, alignItems: 'center', justifyContent: 'center' }}>
            {removable && (
              <TouchableOpacity onPress={() => onRemove(row.pid)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                <Ionicons name="close" size={17} color={FUND.MUTED} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Options render IN FLOW below the row, matching the sheet's other
            selects — an absolutely-positioned menu inside a ScrollView is
            clipped by the sibling rows on Android. */}
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
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: canAdd ? '#12A96B' : FUND.MUTED }}>+ Add payment method</Text>
      ) : (
        <>
          <View style={{ width: 21, height: 21, borderRadius: 11, backgroundColor: canAdd ? FUND.LAV_PILL : FUND.FILL, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: canAdd ? FUND.LAV_TEXT : FUND.MUTED, lineHeight: 17 }}>+</Text>
          </View>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: canAdd ? FUND.LAV_TEXT : FUND.MUTED }}>Add payment method</Text>
        </>
      )}
    </TouchableOpacity>
  );

  if (plain) {
    return (
      <View style={{ marginTop: 18 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 }}>
          {title}
          {rows.length > 1 && total != null && (
            <Text style={{ fontWeight: '700', color: FUND.SUBTEXT }}>{`  ·  $${Math.round(total).toLocaleString()}`}</Text>
          )}
        </Text>
        {body}
        {addButton}
        {footer}
      </View>
    );
  }

  return (
    <View style={{ position: 'relative', backgroundColor: '#fff', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 16, paddingHorizontal: 14, paddingTop: 20, paddingBottom: 14, marginBottom: 18 }}>
      <Text style={{ position: 'absolute', top: -9, left: 16, paddingHorizontal: 6, backgroundColor: FUND.PANEL, fontSize: 13.5, fontWeight: '700', color: FUND.TEXT, zIndex: 2 }}>
        {title}
        {/* Shown only once the group holds MORE THAN ONE line — with a single row
            the total is the number already in the field beside it, and repeating
            it in the heading reads as a second, different figure. */}
        {rows.length > 1 && total != null && (
          <Text style={{ fontWeight: '700', color: FUND.SUBTEXT }}>{`  ·  $${Math.round(total).toLocaleString()}`}</Text>
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
