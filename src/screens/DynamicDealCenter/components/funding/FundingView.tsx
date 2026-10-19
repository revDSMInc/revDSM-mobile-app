import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding-theme';
import { PaymentFundingCard } from './PaymentFundingCard';
import { RefundApprovalCard } from './RefundApprovalStatus';
import { canSync, describePayment, groupTotal, type AttemptLogEntry, type Decision, type FundingPayment, type PayMode } from '../../utils/funding';
import type { FundingApprovalReminder, FundingRefund } from '../../../../services/api/FundingService';

interface Props {
  payments: FundingPayment[];
  payMode: PayMode;
  contractTotal: number;
  covered: boolean;
  bankDeclined: boolean;
  log?: AttemptLogEntry[];
  lastSyncedAt: string | null;
  syncingAll: boolean;
  busyPid: string | null;
  paymentsSetupError?: string | null;
  refunds?: { payment: FundingPayment; refund: FundingRefund }[];
  reminderFor?: (refund: FundingRefund) => {
    reminder?: FundingApprovalReminder | null;
    approverName?: string;
    onRemind?: () => void;
    reminding?: boolean;
  } | null;
  onSyncAll: () => void;
  onSyncOne: (pid: string) => void;
  onSendLink: (pid: string) => void;
  onMarkCollected: (pid: string) => void;
  onChargeCard: (pid: string) => void;
  onActivate: (pid: string) => void;
  onReactivate?: (pid: string) => void;
  onRecordDecision?: (pid: string, decision: Decision, approvedAmt?: number) => void;
  offline?: boolean;
  onEditPayments: () => void;
  onResultAsBankDecline: () => void;
  onUndoBankDecline: () => void;
}

function SectionLabel({ text, hint, total, first }: { text: string; hint: string; total: number; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: 4, marginBottom: 10, marginTop: first ? 0 : 8 }}>
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 1.2, textTransform: 'uppercase', color: '#8A9490' }}>
        {text}
        <Text style={{ color: FUND.SUBTEXT }}>{`  ·  $${total.toLocaleString()}`}</Text>
      </Text>
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED }}>{hint}</Text>
    </View>
  );
}

function SetupBanner({ message }: { message: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, backgroundColor: FUND.RED_BG, borderWidth: 1.4, borderColor: FUND.RED_BORDER, borderRadius: 14, padding: 14, marginBottom: 18 }}>
      <Ionicons name="alert-circle" size={18} color={FUND.RED_TEXT} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: FS.BODY, fontFamily: PS.extrabold, color: FUND.RED_TEXT }}>Payments are not set up for your company yet</Text>
        {/* The rep cannot fix this at the table, so it is framed as somebody
            else's job rather than as something to tap again. */}
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, lineHeight: 17, color: FUND.RED_TEXT, marginTop: 4 }}>
          Contact your office — someone with portal access has to finish setup in Stripe. Card and loan links can’t be
          sent until then; checks are unaffected.
        </Text>
        {/* The server's own wording, kept verbatim: it names the exact requirement
            (e.g. `requirements.past_due`) that whoever is called will need. */}
        <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 16, color: FUND.RED_TEXT, marginTop: 6, opacity: 0.85 }}>
          {message}
        </Text>
      </View>
    </View>
  );
}

export function FundingView({
  payments,
  payMode,
  contractTotal,
  covered,
  bankDeclined,
  lastSyncedAt,
  syncingAll,
  busyPid,
  paymentsSetupError,
  refunds,
  reminderFor,
  onSyncAll,
  onSyncOne,
  onSendLink,
  onMarkCollected,
  onChargeCard,
  onActivate,
  onReactivate,
  onRecordDecision,
  offline,
  onEditPayments,
  onResultAsBankDecline,
  onUndoBankDecline,
}: Props) {
  const upfront = payMode === 'upfront';
  // Nothing to poll when every row is a check - that is the whole board offline, where
  // the button would also have no server to ask.
  const anySyncable = !offline && payments.some((p) => canSync(p));
  const down = payments.filter((p) => p.kind === 'down');
  const balance = payments.filter((p) => p.kind === 'bal');

  const renderCard = (p: FundingPayment) => (
    <PaymentFundingCard
      key={p.pid}
      payment={p}
      title={describePayment(p, payments)}
      covered={covered}
      bankDeclined={bankDeclined}
      linkBlocked={!!paymentsSetupError}
      isBusy={busyPid === p.pid || syncingAll}
      onSendLink={() => onSendLink(p.pid)}
      onMarkCollected={() => onMarkCollected(p.pid)}
      onChargeCard={() => onChargeCard(p.pid)}
      onActivate={() => onActivate(p.pid)}
      onReactivate={onReactivate ? () => onReactivate(p.pid) : undefined}
      offline={offline}
      onRecordDecision={onRecordDecision ? (d, amt) => onRecordDecision(p.pid, d, amt) : undefined}
      onSync={() => onSyncOne(p.pid)}
      onEditPayments={onEditPayments}
      onResultAsBankDecline={onResultAsBankDecline}
    />
  );

  return (
    <View>
      {/* status-check header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED }}>
          {!anySyncable ? 'Nothing to check on' : lastSyncedAt ? `All synced ${lastSyncedAt}` : 'Not synced yet'}
        </Text>
        {anySyncable && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={onSyncAll}
            disabled={syncingAll}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: syncingAll ? 0.6 : 1, backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            {syncingAll ? <ActivityIndicator size="small" color="#5B6B60" /> : <Ionicons name="refresh" size={14} color="#5B6B60" />}
            <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: '#5B6B60' }}>Sync all</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 18, padding: 16, marginBottom: 20 }}>
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL }}>Contract Total</Text>
        <Text style={{ fontSize: FS.DISPLAY, fontFamily: PS.bold, letterSpacing: -0.4, color: FUND.TEXT }}>${contractTotal.toLocaleString()}</Text>
      </View>

      {/* Above the payment cards and above the Bank Decline notice: it explains
          why every send below is greyed, so it has to be read first. */}
      {!!paymentsSetupError && <SetupBanner message={paymentsSetupError} />}

      {/* ⚠️ Above the payment cards, not below them. Money going BACK is the
          exception on this screen, and it comes out of one of the rows underneath —
          a rep reading the cards first would reconcile a collected total that the
          refund has already been taken off. */}
      {(refunds || []).map(({ payment, refund }) => (
        <RefundApprovalCard
          key={refund.rid || `${payment.pid}-refund`}
          amount={refund.amount}
          refund={refund}
          {...(reminderFor?.(refund) || {})}
        />
      ))}

      {bankDeclined && (
        <View style={{ backgroundColor: FUND.RED_BG, borderRadius: 14, padding: 14, marginBottom: 18 }}>
          <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, lineHeight: 19, color: FUND.RED_TEXT }}>
            Resulted as <Text style={{ fontFamily: PS.black }}>Bank Decline</Text>. Nothing collects on this job. The lender
            attempts below stay on the record.
          </Text>
          <TouchableOpacity onPress={onUndoBankDecline} style={{ marginTop: 9 }}>
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, textDecorationLine: 'underline', color: FUND.RED_TEXT }}>
              Undo — go back to Sale
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {payments.length === 0 ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <Ionicons name="card-outline" size={32} color={FUND.BORDER} />
          <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED, marginTop: 10, textAlign: 'center' }}>
            No payment methods entered
          </Text>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 4, textAlign: 'center', lineHeight: 17 }}>
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
                total={groupTotal(down)}
                first
              />
              {down.map(renderCard)}
            </>
          )}
          {balance.length > 0 && (
            <>
              <SectionLabel text="Balance" hint="Funds after install" total={groupTotal(balance)} />
              {balance.map(renderCard)}
            </>
          )}
        </>
      )}

    </View>
  );
}
