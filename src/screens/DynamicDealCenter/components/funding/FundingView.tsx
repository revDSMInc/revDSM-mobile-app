import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FUND } from './funding-theme';
import { PaymentFundingCard } from './PaymentFundingCard';
import { ScenarioSimulator } from './ScenarioSimulator';
import type { AttemptLogEntry, Decision, FundingPayment } from '../../utils/funding';

/**
 * The **Funding** screen — the second half of the Result Lead sheet.
 *
 * The pricing screen answers "who is paying what"; this one answers "how far has
 * each of those payments actually got". One card per payment, grouped into money
 * that collects NOW (the down payment) and money that settles AFTER INSTALL (the
 * balance), because those two have completely different expectations of the rep.
 *
 * Purely presentational — every rule lives in `utils/funding.ts` and every action
 * is a callback. The owner (`ResultJobModal`) holds the payment state.
 */

interface Props {
  payments: FundingPayment[];
  contractTotal: number;
  covered: boolean;
  /** Result switched to Bank Decline — nothing collects, but the attempts stay on record. */
  bankDeclined: boolean;
  log: AttemptLogEntry[];
  lastSyncedAt: string | null;
  syncingAll: boolean;
  syncingId: string | null;
  onSyncAll: () => void;
  onSyncOne: (id: string) => void;
  onSendLink: (id: string) => void;
  onMarkCollected: (id: string) => void;
  onChargeCard: (id: string) => void;
  onActivate: (id: string) => void;
  /** Scenario Simulator — stage the outcome the next Sync will deliver. */
  onQueueOutcome: (id: string, decision: Decision) => void;
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
  contractTotal,
  covered,
  bankDeclined,
  log,
  lastSyncedAt,
  syncingAll,
  syncingId,
  onSyncAll,
  onSyncOne,
  onSendLink,
  onMarkCollected,
  onChargeCard,
  onActivate,
  onQueueOutcome,
  onEditPayments,
  onResultAsBankDecline,
  onUndoBankDecline,
}: Props) {
  const down = payments.filter((p) => p.kind === 'down');
  const balance = payments.filter((p) => p.kind === 'bal');

  const renderCard = (p: FundingPayment) => (
    <PaymentFundingCard
      key={p.id}
      payment={p}
      covered={covered}
      bankDeclined={bankDeclined}
      isSyncing={syncingId === p.id || syncingAll}
      onSendLink={() => onSendLink(p.id)}
      onMarkCollected={() => onMarkCollected(p.id)}
      onChargeCard={() => onChargeCard(p.id)}
      onActivate={() => onActivate(p.id)}
      onSync={() => onSyncOne(p.id)}
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
          style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
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
              <SectionLabel text="Down Payment" hint="Collect now" first />
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
            return (
              <View
                key={`${l.method}-${l.at}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: '#fff', borderWidth: 1.4, borderColor: FUND.BORDER, borderLeftWidth: 4, borderLeftColor: partial ? FUND.AMBER : FUND.RED, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#3A4048' }} numberOfLines={1}>{l.method}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: FUND.MUTED, marginTop: 3 }}>
                    ${l.amt.toLocaleString()} requested
                    {partial ? ` · $${l.approved.toLocaleString()} approved` : ''} · {l.at}
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: partial ? FUND.AMBER_BG : FUND.RED_BG }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: partial ? FUND.AMBER_TEXT : FUND.RED_TEXT }}>
                    {l.outcome}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ⚠️ Stands in for the lender API — remove with the real status endpoint.
          Sits last (mockup `#simPanel` follows `#fundBody`) so it never reads as
          part of the payment record above it. */}
      <ScenarioSimulator payments={payments} onQueue={onQueueOutcome} />
    </View>
  );
}
