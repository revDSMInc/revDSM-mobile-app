import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, LinearTransition, FadeOut } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';

/**
 * One program branch card in the Investment Center (web parity: `program-card.js`).
 * It renders the SAME breakdown as the rollout's In-Home Pre-Order / 1-Year Program
 * boxes (Total → Sr+Vet → [Discount] → Grand Total → down payment → monthly) so the
 * numbers the customer sees here match exactly what the rep confirmed in the rollout.
 *
 * The In-Home Pre-Order card is `highlighted` and, when opted into, fires the real
 * Result Lead handoff. The 1-Year Program card is visual-only: opting into it just
 * "crosses off" In-Home. Selecting one program `crossedOff`s the other.
 */

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

export interface ProgramRow {
  label: string;
  value: string;
  /** render the value in green (a discount line) */
  green?: boolean;
}

/** One financing plan in the In-Home "Monthly" shortlist (web `shortlistPlans`). */
export interface ShortlistPlan {
  key: string;
  monthly: number;
  /** compact terms label, e.g. "GS1599, 9.99% APR, 180M" */
  terms: string;
}

/**
 * Right-swipe "Delete" action for a Monthly-Options plan row (mirrors the dynamic
 * rollout's `SwipeDeleteAction`). Narrower to fit the compact program card.
 */
function PlanSwipeDelete({ drag, onDelete }: { drag: any; onDelete: () => void }) {
  const styleAnimation = useAnimatedStyle(() => ({ transform: [{ translateX: drag.value + 64 }] }));
  return (
    <View style={{ width: 64, marginLeft: 6, marginBottom: 8 }}>
      <Animated.View style={styleAnimation}>
        <TouchableOpacity
          onPress={onDelete}
          style={{ backgroundColor: '#FF5630', height: '100%', borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}
        >
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11 }}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

interface Props {
  title: string;
  highlighted?: boolean;
  /** Show the dark "PRICE LOCK" pill above the title (the 1-Year program, web parity). */
  priceLock?: boolean;
  rows: ProgramRow[];
  /** Reserve breakdown-row height for this many rows (pads short cards with
   *  invisible rows) so cards with different row counts keep the same height above
   *  the Grand Total — aligning the Add-Down-Payment button across both cards. */
  reserveRows?: number;
  grandTotal: number;
  monthly?: number;
  planLabel?: string;
  downPayment?: number;
  /** Optional editable down-payment control — replaces the read-only line. */
  downPaymentSlot?: React.ReactNode;
  /** In-Home (highlighted) card only: render the interactive "Monthly" shortlist —
   *  a selectable $/mo list the rep builds (add/select/swipe-to-delete) — instead
   *  of the single read-only monthly the 1-Year card shows. */
  planInteractive?: boolean;
  shortlistPlans?: ShortlistPlan[];
  selectedPlanKey?: string;
  onSelectPlan?: (key: string) => void;
  onRemovePlan?: (key: string) => void;
  onAddPlan?: () => void;
  /** Basic (non-financing) method badges shown next to Grand Total, e.g. CK/CC/AMEX. */
  badges?: { key: string; label: string }[];
  selectedBadgeKey?: string;
  onSelectBadge?: (key: string) => void;
  selected?: boolean;
  crossedOff?: boolean;
  optInLabel: string;
  onOptIn: () => void;
  onRevert: () => void;
  readOnly?: boolean;
}

function Row({ label, value, green }: ProgramRow) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8' }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 11, fontWeight: '900', color: green ? '#16a34a' : '#1C252E' }}>{value}</Text>
    </View>
  );
}

export function ProgramCard({
  title, highlighted = false, priceLock = false, rows, reserveRows, grandTotal, monthly, planLabel, downPayment, downPaymentSlot,
  planInteractive = false, shortlistPlans, selectedPlanKey, onSelectPlan, onRemovePlan, onAddPlan,
  badges, selectedBadgeKey, onSelectBadge,
  selected = false, crossedOff = false, optInLabel, onOptIn, onRevert,
  readOnly = false,
}: Props) {
  const accent = highlighted ? '#4CBB17' : '#334155';
  return (
    <View style={{ flex: 1, borderRadius: 16, borderWidth: selected ? 2 : 1.5, borderColor: selected ? accent : '#E2E8F0', overflow: 'visible', backgroundColor: crossedOff ? '#F1F5F9' : '#fff', position: 'relative' }}>
      {/* PRICE LOCK badge — floats above the card's top edge (web parity: the
          non-highlighted 1-Year program). The outer card is overflow:visible so the
          pill can poke above; the header + content live in the clip layer below. */}
      {priceLock && (
        <View style={{ position: 'absolute', top: -12, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#16324F', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Ionicons name="lock-closed" size={10} color="#fff" />
            <Text style={{ fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>PRICE LOCK</Text>
          </View>
        </View>
      )}

      {/* Clip layer — rounds the colored header to the card radius (web parity). */}
      <View style={{ borderRadius: 14.5, overflow: 'hidden', opacity: crossedOff ? 0.45 : 1 }}>
        {/* Header bar — light-gray + dark title (1-Year) / green + white (In-Home),
            matching the reference (was a dark-navy 1-Year header). */}
        <View style={{ backgroundColor: highlighted ? '#4CBB17' : '#EEF1F4', paddingVertical: 13, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: highlighted ? '#fff' : '#1C252E', letterSpacing: 0.5, textAlign: 'center', textTransform: 'uppercase' }} numberOfLines={2}>{title}</Text>
        </View>

        <View style={{ padding: 12 }}>
        {/* Breakdown rows — Total / Sr+Vet / [Discount]. Invisible placeholder rows
            pad the block up to `reserveRows` so a card with fewer rows keeps the same
            height here, aligning the Grand Total / Add-Down-Payment / monthly across
            both program cards. */}
        {rows.map((r, i) => <Row key={i} {...r} />)}
        {reserveRows != null && reserveRows > rows.length &&
          Array.from({ length: reserveRows - rows.length }).map((_, i) => (
            <View key={`ph-${i}`} style={{ opacity: 0 }} pointerEvents="none">
              <Row label="placeholder" value="$0" />
            </View>
          ))}

        <View style={{ height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 }} />

        {/* Grand Total + basic method badges (CK/CC/AMEX) to the right */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexShrink: 0 }}>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>Grand Total</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: highlighted ? '#15803D' : '#1C252E', marginTop: 1 }}>{fmt(grandTotal)}</Text>
          </View>
          {!!badges?.length && (
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, marginLeft: 8, paddingTop: 2 }}>
              {badges.map((b) => {
                const sel = selectedBadgeKey === b.key;
                return (
                  <TouchableOpacity
                    key={b.key}
                    disabled={readOnly}
                    onPress={() => onSelectBadge?.(b.key)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5, borderColor: sel ? '#4CBB17' : '#E2E8F0', backgroundColor: sel ? '#4CBB170D' : '#fff' }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '900', color: sel ? '#15803D' : '#94A3B8' }}>{b.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {downPaymentSlot ? (
          <View style={{ marginTop: 8 }}>{downPaymentSlot}</View>
        ) : (downPayment ?? 0) > 0 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#16a34a' }}>Down Payment</Text>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#16a34a' }}>-{fmt(downPayment!)}</Text>
          </View>
        ) : null}

        {planInteractive ? (
          // In-Home: an interactive "Monthly" shortlist (web parity). The rep adds
          // financing plans the customer picks from; each is selectable (radio →
          // check) and swipe-left deletes it. Empty until the first plan is added.
          <View style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 9, fontWeight: '900', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>Monthly</Text>
            {!shortlistPlans || shortlistPlans.length === 0 ? (
              <Text style={{ fontSize: 10, color: '#94A3B8', marginBottom: 8, lineHeight: 14 }}>No plan selected — add one below.</Text>
            ) : (
              shortlistPlans.map((opt) => {
                const isSel = selectedPlanKey === opt.key;
                const content = (
                  <TouchableOpacity
                    onPress={() => onSelectPlan?.(opt.key)}
                    disabled={readOnly}
                    activeOpacity={readOnly ? 1 : 0.9}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: isSel ? 2 : 1, borderColor: isSel ? '#4CBB17' : '#E2E8F0', backgroundColor: isSel ? '#4CBB170D' : '#fff', marginBottom: 8 }}
                  >
                    {/* Amount on top, full plan label stacked below it — so a long
                        label (e.g. "GS2521, 0% APR, 18M") shows in full instead of
                        truncating with "…" beside the amount. */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 14, fontWeight: '900', color: isSel ? '#15803D' : '#1C252E' }}>
                        {opt.monthly > 0 ? fmt(opt.monthly) : '—'}
                        <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8' }}>/mo</Text>
                      </Text>
                      {!!opt.terms && (
                        <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8', marginTop: 2 }}>{opt.terms}</Text>
                      )}
                    </View>
                    <Ionicons name={isSel ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={isSel ? '#4CBB17' : '#CBD5E1'} />
                  </TouchableOpacity>
                );

                if (readOnly) {
                  return <View key={opt.key}>{content}</View>;
                }

                return (
                  <Animated.View key={opt.key} layout={LinearTransition} exiting={FadeOut}>
                    <Swipeable
                      renderRightActions={(_prog, drag) => <PlanSwipeDelete drag={drag} onDelete={() => onRemovePlan?.(opt.key)} />}
                      rightThreshold={36}
                      onSwipeableWillOpen={() => onRemovePlan?.(opt.key)}
                    >
                      {content}
                    </Swipeable>
                  </Animated.View>
                );
              })
            )}
            {!readOnly && (
              <TouchableOpacity
                onPress={onAddPlan}
                style={{ paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#4CBB17', backgroundColor: '#4CBB170D', alignItems: 'center', marginTop: 2 }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#15803D' }}>+ Add Plan</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (monthly ?? 0) > 0 ? (
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#60A5FA' }}>{fmt(monthly!)}/mo</Text>
            {!!planLabel && (
              <Text style={{ fontSize: 8, color: '#94A3B8', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{planLabel}</Text>
            )}
          </View>
        ) : null}

        <TouchableOpacity
          disabled={readOnly}
          onPress={onOptIn}
          style={{
            marginTop: 12,
            paddingVertical: 10,
            borderRadius: 12,
            alignItems: 'center',
            backgroundColor: selected ? accent : (highlighted ? '#4CBB17' : '#EEF2F6'),
            flexDirection: 'row',
            justifyContent: 'center',
            gap: (readOnly && selected) ? 2 : 4,
            paddingHorizontal: 4,
          }}
        >
          {readOnly && selected && (
            <Ionicons name="checkmark" size={12} color="#fff" />
          )}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{
              fontSize: (readOnly && selected) ? 10 : 12,
              fontWeight: '900',
              color: selected || highlighted ? '#fff' : '#334155',
            }}
          >
            {readOnly && selected ? 'Job Builder Submitted' : (selected ? 'Selected' : optInLabel)}
          </Text>
        </TouchableOpacity>
        </View>
      </View>

      {/* Crossed-off overlay (the other program was chosen) */}
      {crossedOff && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 2, backgroundColor: '#94A3B8' }} />
          {!readOnly && (
            <TouchableOpacity onPress={onRevert} style={{ backgroundColor: '#fff', borderRadius: 20, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CBD5E1' }}>
              <Ionicons name="close" size={18} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
