import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FUND } from './funding-theme';
import { MOCK_PARTIAL_RATE, shortMethod, type Decision, type FundingPayment } from '../../utils/funding';

/**
 * **Scenario Simulator** — drives `POST …/mock-provider` (spec §10).
 *
 * A loan application goes out to a lender that, in development, does not exist.
 * This panel plays the lender: pick an outcome and it is RECORDED against the
 * payment; the rep then hits **Sync** for it to land, exactly as with a real
 * lender. Keeping those two halves separate is deliberate — it means the
 * production code path (`sync` → decision) is the one under test, rather than a
 * chip that writes the decision directly.
 *
 * ⚠️ **Test only.** `mock-provider` answers `404 Mock provider actions are
 * disabled` unless the server runs with `FUNDING_PROVIDER=mock`; when that
 * happens the panel says so rather than failing silently on every tap.
 *
 * ⚠️ **Delete this component when a real lender integration lands.** Decisions
 * will then arrive through `sync` on their own.
 *
 * Checks never appear — they have no provider to simulate and the endpoint refuses
 * them (`422`). **Cards do**, which is a deliberate departure from the mockup: in
 * mock mode a card only reaches *Card on File* via `mock-provider { cardOnFile }`,
 * so without a chip here the card flow simply cannot be walked (spec §10).
 */

type MockAction = 'cardOnFile' | Decision;

interface Props {
  payments: FundingPayment[];
  /** The pid with an action in flight. */
  busyPid: string | null;
  /** The server answered 404 — it is not running in mock mode. */
  disabled: boolean;
  /** `short` carries a suggested `approvedAmt`; the endpoint requires one. */
  onSimulate: (pid: string, action: MockAction, approvedAmt?: number) => void;
}

type Chip = { value: MockAction; label: string; tone: 'ok' | 'warn' | 'bad' };

const BANK_CHIPS: Chip[] = [
  { value: 'full', label: 'Approve full', tone: 'ok' },
  { value: 'short', label: 'Approve partial', tone: 'warn' },
  { value: 'declined', label: 'Decline', tone: 'bad' },
];

/** A card's only mock action — the endpoint rejects anything else with `400`. */
const CARD_CHIPS: Chip[] = [{ value: 'cardOnFile', label: 'Homeowner saved their card', tone: 'ok' }];

const TONES = {
  ok: { border: FUND.GREEN, bg: '#F0FBEC', text: FUND.GREEN_TEXT },
  warn: { border: FUND.AMBER, bg: FUND.AMBER_BG, text: FUND.AMBER_TEXT },
  bad: { border: FUND.RED, bg: FUND.RED_BG, text: FUND.RED_TEXT },
} as const;

/**
 * What a simulated partial approval grants: 60% to the nearest $100.
 *
 * ⚠️ Clamped to at least $1 BELOW the request — the endpoint requires
 * `0 < approvedAmt < requested` and rejects anything else with `422`, which a
 * small amount rounding up to the full figure would otherwise trip.
 */
function suggestedPartial(amount: number): number {
  const rounded = Math.round((amount * MOCK_PARTIAL_RATE) / 100) * 100;
  return Math.max(1, Math.min(rounded, amount - 1));
}

export function ScenarioSimulator({ payments, busyPid, disabled, onSimulate }: Props) {
  const simulatable = payments.filter((p) => p.type === 'bank' || p.type === 'cc');
  if (!simulatable.length) return null;

  return (
    <View style={{ borderWidth: 1.6, borderStyle: 'dashed', borderColor: '#C9CED6', borderRadius: 16, padding: 14, marginTop: 8, backgroundColor: '#FBFCFD' }}>
      <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#7B838D', marginBottom: 4 }}>
        Scenario simulator
      </Text>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: FUND.MUTED, lineHeight: 17, marginBottom: 12 }}>
        {disabled
          ? 'Unavailable — this server is not running in mock mode, so lender outcomes have to come from the real provider.'
          : 'Stands in for the lender API. Pick an outcome, then hit Sync on that card to receive it.'}
      </Text>

      {simulatable.map((p) => {
        const isBank = p.type === 'bank';
        const busy = busyPid === p.pid;
        // Nothing left to simulate once the third party has answered: a decided loan
        // is locked server-side and a vaulted card is already on file, so another
        // mock action would be refused anyway.
        const settled = isBank ? !!p.decision : p.step >= 2 || p.charged;
        const off = disabled || settled || busy;
        return (
          <View key={p.pid} style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#3A4048', marginBottom: 7 }}>
              ${p.amount.toLocaleString()} · {shortMethod(p.method)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {(isBank ? BANK_CHIPS : CARD_CHIPS).map(({ value, label, tone }) => {
                const c = TONES[tone];
                const on = isBank ? p.decision === value : settled;
                return (
                  <TouchableOpacity
                    key={value}
                    activeOpacity={0.8}
                    disabled={off}
                    onPress={() => onSimulate(p.pid, value, value === 'short' ? suggestedPartial(p.amount) : undefined)}
                    style={{
                      borderWidth: 1.4,
                      borderRadius: 18,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      opacity: off && !on ? 0.45 : 1,
                      borderColor: on ? c.border : FUND.BORDER,
                      backgroundColor: on ? c.bg : '#fff',
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? c.text : FUND.SUBTEXT }}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
              {busy && <ActivityIndicator size="small" color={FUND.MUTED} />}
            </View>
            {/* Nothing can come back for an application that was never sent — the
                endpoint returns 409 in that case, so say it up front. */}
            {!disabled && !settled && (
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.LAV_TEXT, marginTop: 8 }}>
                {p.linkSent ? 'Recorded outcomes land when you hit Sync on that card' : 'Send the link first, then Sync'}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
