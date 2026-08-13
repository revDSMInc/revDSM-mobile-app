import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FUND } from './funding-theme';
import { PaymentFundingCard } from './PaymentFundingCard';
import { ScenarioSimulator } from './ScenarioSimulator';
import type { AttemptLogEntry, Decision, FundingPayment, PayMode } from '../../utils/funding';

/**
 * The **Funding** screen — the second half of the Result Lead sheet.
 *
 * The pricing screen answers "who is paying what"; this one answers "how far has
 * each of those payments actually got". One card per payment, grouped into money
 * that collects NOW (the down payment) and money that settles AFTER INSTALL (the
 * balance), because those two have completely different expectations of the rep.
 *
 * An **upfront** contract has no such split — it is all collected now — so it
 * renders as one Upfront section instead of the two. ⚠️ Its payments arrive from
 * the server as `kind: 'down'` (see `PaymentKind`), so the grouping is driven by
 * `payMode` rather than by the rows: nothing about a single payment distinguishes
 * "the down payment on a financed job" from "the whole contract paid at once".
 *
 * Purely presentational, and everything it draws comes from the funding record the
 * server last returned — ⚠️ **no step is ever advanced locally** (spec rule 3).
 * Every action is a callback into `useFunding`.
 */

interface Props {
  payments: FundingPayment[];
  /** Split (Down Payment + Balance) or Upfront — decides the section headings. */
  payMode: PayMode;
  contractTotal: number;
  covered: boolean;
  /** Result switched to Bank Decline — nothing collects, but the attempts stay on record. */
  bankDeclined: boolean;
  log: AttemptLogEntry[];
  /** ISO timestamp of the most recent sync across all rows, already formatted. */
  lastSyncedAt: string | null;
  syncingAll: boolean;
  /** The pid whose own action is in flight. */
  busyPid: string | null;
  /** The server is not in mock mode, so the simulator can't stand in for a lender. */
  mockDisabled: boolean;
  onSyncAll: () => void;
  onSyncOne: (pid: string) => void;
  onSendLink: (pid: string) => void;
  onMarkCollected: (pid: string) => void;
  onChargeCard: (pid: string) => void;
  onActivate: (pid: string) => void;
  /** TEST ONLY — `POST …/mock-provider`; the rep still has to Sync (spec §10). */
  onSimulate: (pid: string, action: 'cardOnFile' | Decision, approvedAmt?: number) => void;
  onEditPayments: () => void;
  onResultAsBankDecline: () => void;
  onUndoBankDecline: () => void;
}

function SectionLabel({ text, hint, first }: { text: string; hint: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: 4, marginBottom: 10, marginTop: first ? 0 : 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#8A9490' }}>{text}</Text>
      <Text style={{ fontSize: 12, fontWeight: '600', color: FUND.MUTED }}>{hint}</Text>
    </View>
  );
}

export function FundingView({
  payments,
  payMode,
  contractTotal,
  covered,
  bankDeclined,
  log,
  lastSyncedAt,
  syncingAll,
  busyPid,
  mockDisabled,
  onSyncAll,
  onSyncOne,
  onSendLink,
  onMarkCollected,
  onChargeCard,
  onActivate,
  onSimulate,
  onEditPayments,
  onResultAsBankDecline,
  onUndoBankDecline,
}: Props) {
  const upfront = payMode === 'upfront';
  const down = payments.filter((p) => p.kind === 'down');
  const balance = payments.filter((p) => p.kind === 'bal');

  const renderCard = (p: FundingPayment) => (
    <PaymentFundingCard
      key={p.pid}
      payment={p}
      covered={covered}
      bankDeclined={bankDeclined}
      isBusy={busyPid === p.pid || syncingAll}
      onSendLink={() => onSendLink(p.pid)}
      onMarkCollected={() => onMarkCollected(p.pid)}
      onChargeCard={() => onChargeCard(p.pid)}
      onActivate={() => onActivate(p.pid)}
      onSync={() => onSyncOne(p.pid)}
      onEditPayments={onEditPayments}
      onResultAsBankDecline={onResultAsBankDecline}
    />
  );

  return (
    <View>
      {/* status-check header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: FUND.MUTED }}>
          {lastSyncedAt ? `All synced ${lastSyncedAt}` : 'Not synced yet'}
        </Text>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onSyncAll}
          disabled={syncingAll}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: syncingAll ? 0.6 : 1, backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
        >
          {syncingAll ? <ActivityIndicator size="small" color="#5B6B60" /> : <Ionicons name="refresh" size={14} color="#5B6B60" />}
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#5B6B60' }}>Sync all</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 18, padding: 16, marginBottom: 20 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL }}>Contract Total</Text>
        <Text style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.4, color: FUND.TEXT }}>${contractTotal.toLocaleString()}</Text>
      </View>

      {bankDeclined && (
        <View style={{ backgroundColor: FUND.RED_BG, borderRadius: 14, padding: 14, marginBottom: 18 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', lineHeight: 19, color: FUND.RED_TEXT }}>
            Resulted as <Text style={{ fontWeight: '900' }}>Bank Decline</Text>. Nothing collects on this job. The lender
            attempts below stay on the record.
          </Text>
          <TouchableOpacity onPress={onUndoBankDecline} style={{ marginTop: 9 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', textDecorationLine: 'underline', color: FUND.RED_TEXT }}>
              Undo — go back to Sale
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {payments.length === 0 ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <Ionicons name="card-outline" size={32} color={FUND.BORDER} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED, marginTop: 10, textAlign: 'center' }}>
            No payment methods entered
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: FUND.MUTED, marginTop: 4, textAlign: 'center', lineHeight: 17 }}>
            Go back and assign the contract to at least one method.
          </Text>
        </View>
      ) : (
        <>
          {down.length > 0 && (
            <>
              {/* Upfront replaces the split entirely — there is no balance to head. */}
              <SectionLabel
                text={upfront ? 'Upfront' : 'Down Payment'}
                hint={upfront ? 'Paid in full now' : 'Collect now'}
                first
              />
              {down.map(renderCard)}
            </>
          )}
          {balance.length > 0 && (
            <>
              <SectionLabel text="Balance" hint="Funds after install" />
              {balance.map(renderCard)}
            </>
          )}
        </>
      )}

      {log.length > 0 && (
        <View style={{ marginTop: 22, paddingTop: 16, borderTopWidth: 1, borderTopColor: FUND.BORDER }}>
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#8A9490', marginBottom: 4 }}>
            Attempt history
          </Text>
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: FUND.MUTED, lineHeight: 17, marginBottom: 11 }}>
            Kept on the job whether or not the amount was reassigned.
          </Text>
          {log.map((l, i) => {
            const partial = l.outcome === 'Partial';
            const declined = l.outcome === 'Declined';
            // A Full attempt is a normal event, not an exception — it gets a neutral
            // rail so the two that DO need the rep's attention still stand out.
            const rail = declined ? FUND.RED : partial ? FUND.AMBER : FUND.GREEN;
            const badge = declined
              ? { bg: FUND.RED_BG, fg: FUND.RED_TEXT }
              : partial
                ? { bg: FUND.AMBER_BG, fg: FUND.AMBER_TEXT }
                : { bg: FUND.GREEN_BG, fg: FUND.GREEN_TEXT };
            return (
              <View
                key={`${l.method}-${l.at}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#fff', borderWidth: 1.4, borderColor: FUND.BORDER, borderLeftWidth: 4, borderLeftColor: rail, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#3A4048' }} numberOfLines={1}>{l.method}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: FUND.MUTED, marginTop: 3 }}>
                    ${l.amt.toLocaleString()} requested
                    {partial ? ` · $${l.approved.toLocaleString()} approved` : ''}
                    {l.at ? ` · ${l.at}` : ''}
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: badge.bg }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: badge.fg }}>
                    {l.outcome}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ⚠️ TEST ONLY — stands in for the lender/processor; remove with the real
          integration. Sits last (mockup `#simPanel` follows `#fundBody`) so it never
          reads as part of the payment record above it. */}
      <ScenarioSimulator payments={payments} busyPid={busyPid} disabled={mockDisabled} onSimulate={onSimulate} />
    </View>
  );
}
