import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FUND } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { planBelowMin, belowMinMsg, type DealPlan, type PayCategory } from '../../hooks/useDealPricing';
import { effectiveRowAmount, type PaymentRow } from '../../utils/funding';

/**
 * The **Down Payment** / **Balance** groups on the Result Lead pricing panel.
 *
 * A sale is no longer one method per half of the contract — the rep can split
 * either half across as many instruments as the homeowner needs. Each line is an
 * amount against a payment method, and the Balance group carries one **auto** row
 * that always holds whatever is left of the contract price, so the two halves can
 * never silently stop adding up to the deal.
 *
 * A row that a lender has already answered is a **fact, not an input**: it locks,
 * shows the approved amount, and is stamped Approved / Declined. Its money is
 * settled and re-typing it would misstate what the lender agreed to.
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
   * Gates the ✕ as well as the Add button: with Add disabled, a removed row could
   * not be brought back.
   */
  canAdd?: boolean;
  onChangeAmount: (id: string, text: string) => void;
  onChangeMethod: (id: string, key: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  /**
   * Rendered inside the group, below Add — the Upfront group puts its
   * `CoverageBar` and its "no balance to finance" note here. A slot rather than
   * two more props, so a caller can put anything under its own rows without this
   * component learning what upfront means.
   */
  footer?: React.ReactNode;
}

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
  onChangeAmount,
  onChangeMethod,
  onRemove,
  onAdd,
  footer,
}: Props) {
  const [openRowId, setOpenRowId] = useState<string | null>(null);

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

      {rows.map((row) => {
        const locked = !!row.decision;
        const needs = row.pid === needsRowId;
        const amount = effectiveRowAmount(row, allRows, price);
        const label = plans[row.method]?.label;
        const isOpen = openRowId === row.pid;
        const readOnlyAmount = locked || !!row.auto;

        // The auto row can only be dismissed once it has nothing left to hold;
        // removing it while money is unassigned would hide the shortfall. And with
        // `canAdd` off there is no way back, so nothing is removable at all.
        const removable = canAdd && !locked && (!row.auto || amount === 0);

        const fieldBorder = needs ? FUND.AMBER : FUND.BORDER;
        const fieldBg = needs ? FUND.AMBER_BG : locked || row.auto ? FUND.FILL : '#fff';

        return (
          <View key={row.pid} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/* amount */}
              <View style={{ flexBasis: '34%', flexGrow: 0, flexShrink: 0, flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: fieldBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: fieldBg }}>
                <Text style={{ fontSize: 18, fontWeight: readOnlyAmount ? '400' : '700', color: readOnlyAmount ? FUND.MUTED : FUND.TEXT, marginRight: 3 }}>$</Text>
                {readOnlyAmount ? (
                  <Text style={{ flex: 1, fontSize: 18, fontWeight: locked ? '700' : '400', color: locked ? FUND.TEXT : FUND.MUTED }} numberOfLines={1}>
                    {amount.toLocaleString()}
                  </Text>
                ) : (
                  <TextInput
                    style={{ flex: 1, fontSize: 18, fontWeight: '700', color: FUND.TEXT, padding: 0 }}
                    value={row.amount}
                    onChangeText={(t) => onChangeAmount(row.pid, t.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    placeholderTextColor={FUND.MUTED}
                    keyboardType="numeric"
                  />
                )}
              </View>

              {/* method */}
              <TouchableOpacity
                activeOpacity={locked ? 1 : 0.8}
                disabled={locked}
                onPress={() => setOpenRowId(isOpen ? null : row.pid)}
                style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderWidth: 1.6, borderColor: isOpen ? FUND.TEXT : fieldBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 14, backgroundColor: fieldBg }}
              >
                <Text style={{ flex: 1, fontSize: 13, fontWeight: label ? '700' : '600', color: label ? FUND.TEXT : FUND.MUTED }} numberOfLines={1}>
                  {label || 'Select Payment Method'}
                </Text>
                {locked && row.decision ? (
                  <StatusPill decision={row.decision} />
                ) : (
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={FUND.MUTED} />
                )}
              </TouchableOpacity>

              {/* remove */}
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
            {isOpen && !locked && (
              <View style={{ borderWidth: 1.6, borderColor: FUND.TEXT, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, backgroundColor: '#fff', overflow: 'hidden' }}>
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
                      // Gate against THIS line's amount: a plan's minimum applies to
                      // the money it actually carries, not to the whole contract.
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
            )}
          </View>
        );
      })}

      {/* Greyed rather than hidden when `canAdd` is off: a control that vanishes
          reads as a bug where a dimmed one reads as "not here". */}
      <TouchableOpacity
        onPress={onAdd}
        disabled={!canAdd}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 2, alignSelf: 'flex-start', opacity: canAdd ? 1 : 0.45 }}
      >
        <View style={{ width: 21, height: 21, borderRadius: 11, backgroundColor: canAdd ? FUND.LAV_PILL : FUND.FILL, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: canAdd ? FUND.LAV_TEXT : FUND.MUTED, lineHeight: 17 }}>+</Text>
        </View>
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: canAdd ? FUND.LAV_TEXT : FUND.MUTED }}>Add payment method</Text>
      </TouchableOpacity>

      {footer}
    </View>
  );
}
