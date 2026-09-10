import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding-theme';
import { PaymentFundingCard } from './PaymentFundingCard';
import { RefundApprovalCard } from './RefundApprovalStatus';
import { describePayment, groupTotal, type AttemptLogEntry, type FundingPayment, type PayMode } from '../../utils/funding';
import type { FundingApprovalReminder, FundingRefund } from '../../../../services/api/FundingService';

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
  /**
   * The company's Stripe account cannot accept payments yet (`charges_enabled`).
   *
   * ⚠️ Rendered ONCE at the top, never per card: the condition is company-wide, so
   * a job with three card rows would otherwise meet the same message three times.
   * It also disables every send, because a rep who is only shown an error will
   * retry it until they call support — and only someone with portal access can fix it.
   */
  paymentsSetupError?: string | null;
  /**
   * Refunds raised on this job, newest first, each with the row it comes out of.
   *
   * ⚠️ Optional, and absent on the Result Lead sheet by construction: a sale being
   * priced for the first time has collected nothing to give back. It is the My Deals
   * addendum flow that can owe a refund, so only that mount passes it.
   */
  refunds?: { payment: FundingPayment; refund: FundingRefund }[];
  /**
   * The reminder window for ONE refund (REVDSM-1160), resolved by the host.
   *
   * ⚠️ A resolver rather than four flat props, because a job can carry more than one
   * refund and only the one whose approval was actually read may show the button —
   * flat props would put the first refund's window on every card.
   */
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
  /**
   * Re-settle a drifted loan (`POST …/reactivate`). Optional: without it a drifted
   * row still SAYS so, it just cannot be closed from here.
   */
  onReactivate?: (pid: string) => void;
  onEditPayments: () => void;
  onResultAsBankDecline: () => void;
  onUndoBankDecline: () => void;
}

/**
 * A group heading.
 *
 * The **running total** matters more the more rows there are: once a half of the
 * contract can be split across several lines, "does the down payment add up to
 * what we agreed" stops being answerable by looking at one card. `total` counts
 * what will really arrive (a decided loan's APPROVED amount), same as coverage.
 */
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

/** The company-wide `charges_enabled` gate. Not a per-row failure — see `Props`. */
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
  log,
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
      // `$500 Check (1 of 2)` — computed against ALL payments, not the group, so a
      // card's ordinal matches the blocker sentence in the footer, which is
      // likewise numbered across the whole record.
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
          {lastSyncedAt ? `All synced ${lastSyncedAt}` : 'Not synced yet'}
        </Text>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onSyncAll}
          disabled={syncingAll}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 7, opacity: syncingAll ? 0.6 : 1, backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
        >
          {syncingAll ? <ActivityIndicator size="small" color="#5B6B60" /> : <Ionicons name="refresh" size={14} color="#5B6B60" />}
          <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: '#5B6B60' }}>Sync all</Text>
        </TouchableOpacity>
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

      {log.length > 0 && (
        <View style={{ marginTop: 22, paddingTop: 16, borderTopWidth: 1, borderTopColor: FUND.BORDER }}>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 1.2, textTransform: 'uppercase', color: '#8A9490', marginBottom: 4 }}>
            Attempt history
          </Text>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, lineHeight: 17, marginBottom: 11 }}>
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
                  <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: '#3A4048' }} numberOfLines={1}>{l.method}</Text>
                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 3 }}>
                    ${l.amt.toLocaleString()} requested
                    {partial ? ` · $${l.approved.toLocaleString()} approved` : ''}
                    {l.at ? ` · ${l.at}` : ''}
                  </Text>
                </View>
                <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: badge.bg }}>
                  <Text style={{ fontSize: FS.MICRO, fontFamily: PS.extrabold, letterSpacing: 0.4, textTransform: 'uppercase', color: badge.fg }}>
                    {l.outcome}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* The Scenario Simulator used to sit here. It stood in for a lender that does
          not exist in development, so a tap wrote an invented approval or decline
          onto a real funding record — removed along with its `mock-provider`
          endpoint. Attempt history above is now only ever what a real lender said. */}
    </View>
  );
}
