import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
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
  /** Basic (non-financing) method badges shown next to Grand Total, e.g. CK/CC/AMEX. */
  badges?: { key: string; label: string }[];
  selectedBadgeKey?: string;
  onSelectBadge?: (key: string) => void;
  selected?: boolean;
  crossedOff?: boolean;
  optInLabel: string;
  onOptIn: () => void;
  onRevert: () => void;
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
  badges, selectedBadgeKey, onSelectBadge,
  selected = false, crossedOff = false, optInLabel, onOptIn, onRevert,
}: Props) {
  const accent = highlighted ? '#4CBB17' : '#334155';
  return (
    <View style={{ flex: 1, borderRadius: 16, borderWidth: selected ? 2 : 1.5, borderColor: selected ? accent : '#E2E8F0', overflow: 'visible', backgroundColor: '#fff', position: 'relative' }}>
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
      <View style={{ borderRadius: 14.5, overflow: 'hidden' }}>
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

        {(monthly ?? 0) > 0 && (
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#60A5FA' }}>{fmt(monthly!)}/mo</Text>
            {!!planLabel && (
              <Text style={{ fontSize: 8, color: '#94A3B8', textAlign: 'center', marginTop: 2 }} numberOfLines={2}>{planLabel}</Text>
            )}
          </View>
        )}

        <TouchableOpacity
          onPress={onOptIn}
          style={{ marginTop: 12, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: selected ? accent : (highlighted ? '#4CBB17' : '#EEF2F6') }}
        >
          <Text style={{ fontSize: 12, fontWeight: '900', color: selected || highlighted ? '#fff' : '#334155' }}>
            {selected ? 'Selected' : optInLabel}
          </Text>
        </TouchableOpacity>
        </View>
      </View>

      {/* Crossed-off overlay (the other program was chosen) */}
      {crossedOff && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, backgroundColor: 'rgba(241,245,249,0.88)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 2, backgroundColor: '#94A3B8' }} />
          <TouchableOpacity onPress={onRevert} style={{ backgroundColor: '#fff', borderRadius: 20, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CBD5E1' }}>
            <Ionicons name="close" size={18} color="#64748B" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
