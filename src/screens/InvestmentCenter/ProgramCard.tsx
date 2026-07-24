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
  rows: ProgramRow[];
  grandTotal: number;
  monthly?: number;
  planLabel?: string;
  downPayment?: number;
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
  title, highlighted = false, rows, grandTotal, monthly, planLabel, downPayment,
  selected = false, crossedOff = false, optInLabel, onOptIn, onRevert,
}: Props) {
  const accent = highlighted ? '#4CBB17' : '#334155';
  return (
    <View style={{ flex: 1, borderRadius: 16, borderWidth: selected ? 2 : 1.5, borderColor: selected ? accent : '#E2E8F0', overflow: 'hidden', backgroundColor: '#fff', position: 'relative' }}>
      {/* Header bar */}
      <View style={{ backgroundColor: highlighted ? '#4CBB17' : '#1E293B', paddingVertical: 9, alignItems: 'center' }}>
        <Text style={{ fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.5, textAlign: 'center' }} numberOfLines={2}>{title}</Text>
      </View>

      <View style={{ padding: 12 }}>
        {/* Breakdown rows — Total / Sr+Vet / [Discount] */}
        {rows.map((r, i) => <Row key={i} {...r} />)}

        <View style={{ height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 }} />

        {/* Grand Total */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>Grand Total</Text>
          <Text style={{ fontSize: 15, fontWeight: '900', color: highlighted ? '#15803D' : '#1C252E' }}>{fmt(grandTotal)}</Text>
        </View>

        {(downPayment ?? 0) > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#16a34a' }}>Down Payment</Text>
            <Text style={{ fontSize: 10, fontWeight: '900', color: '#16a34a' }}>-{fmt(downPayment!)}</Text>
          </View>
        )}

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

      {/* Crossed-off overlay (the other program was chosen) */}
      {crossedOff && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(241,245,249,0.88)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 2, backgroundColor: '#94A3B8' }} />
          <TouchableOpacity onPress={onRevert} style={{ backgroundColor: '#fff', borderRadius: 20, width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#CBD5E1' }}>
            <Ionicons name="close" size={18} color="#64748B" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
