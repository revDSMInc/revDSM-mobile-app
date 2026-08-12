import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { FUND } from './funding-theme';
import { shortMethod, type Decision, type FundingPayment } from '../../utils/funding';

/**
 * **Scenario Simulator** — stands in for the lender API.
 *
 * There is no funding backend yet, so nothing would ever come back for a loan
 * application and the rep could never get past *Approved*. This panel is where the
 * outcome is staged: pick one, then Sync to receive it, so the two halves of the
 * round trip stay distinct rather than a chip silently mutating the deal.
 *
 * ⚠️ **DELETE THIS COMPONENT when the real status endpoint lands** — along with
 * `FundingPayment.queued` and the queue branch in `syncPayments`. It is deliberately
 * labelled in plain sight so it can never be mistaken for a real lender control.
 *
 * Only loans appear: a check is collected by hand and a card is confirmed by the
 * processor on Sync, so neither has an outcome to choose.
 */

interface Props {
  payments: FundingPayment[];
  onQueue: (id: string, decision: Decision) => void;
}

const CHIPS: { value: Decision; label: string; tone: 'ok' | 'warn' | 'bad' }[] = [
  { value: 'full', label: 'Approve full', tone: 'ok' },
  { value: 'short', label: 'Approve partial', tone: 'warn' },
  { value: 'declined', label: 'Decline', tone: 'bad' },
];

const TONES = {
  ok: { border: FUND.GREEN, bg: '#F0FBEC', text: FUND.GREEN_TEXT },
  warn: { border: FUND.AMBER, bg: FUND.AMBER_BG, text: FUND.AMBER_TEXT },
  bad: { border: FUND.RED, bg: FUND.RED_BG, text: FUND.RED_TEXT },
} as const;

export function ScenarioSimulator({ payments, onQueue }: Props) {
  const banks = payments.filter((p) => p.type === 'bank');
  if (!banks.length) return null;

  return (
    <View style={{ borderWidth: 1.6, borderStyle: 'dashed', borderColor: '#C9CED6', borderRadius: 16, padding: 14, marginTop: 8, backgroundColor: '#FBFCFD' }}>
      <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#7B838D', marginBottom: 4 }}>
        Scenario simulator
      </Text>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: FUND.MUTED, lineHeight: 17, marginBottom: 12 }}>
        Stands in for the lender API. Pick an outcome, then hit Sync at the top to receive it.
      </Text>

      {banks.map((p) => (
        <View key={p.id} style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#3A4048', marginBottom: 7 }}>
            ${p.amount.toLocaleString()} · {shortMethod(p.methodLabel)}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CHIPS.map(({ value, label, tone }) => {
              const on = p.queued === value;
              const c = TONES[tone];
              return (
                <TouchableOpacity
                  key={value}
                  activeOpacity={0.8}
                  onPress={() => onQueue(p.id, value)}
                  style={{
                    borderWidth: 1.4,
                    borderRadius: 18,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderColor: on ? c.border : FUND.BORDER,
                    backgroundColor: on ? c.bg : '#fff',
                  }}
                >
                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? c.text : FUND.SUBTEXT }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Nothing can come back for an application that was never sent — say so
              rather than letting the rep queue an outcome that silently never lands. */}
          {!!p.queued && (
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.LAV_TEXT, marginTop: 8 }}>
              {p.linkSent ? 'Queued — hit Sync on that card' : 'Send the link first, then Sync'}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
