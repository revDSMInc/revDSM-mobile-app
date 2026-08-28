import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding-theme';
import { FundingStepper } from './FundingStepper';
import {
  FLOW,
  applicationClosedNote,
  canResendLink,
  canSync,
  doneFor,
  formatStamp,
  isApplicationClosed,
  lastSendNote,
  openShort,
  ownerOf,
  type FundingPayment,
} from '../../utils/funding';

/**
 * One payment's funding card: the amount and method it represents, its progress
 * rail, and **only the actions the rep can actually take right now**.
 *
 * Every button here is a step the rep performs at the table. Anything posted by a
 * bank, a processor or the install crew is rendered as a locked step plus a note
 * saying so — see `FundingStepper`. That split is the whole point of the screen:
 * a rep should be able to look at a card and know whether they are finished.
 *
 * ⚠️ Nothing here advances a step locally. Each action calls its endpoint and the
 * screen redraws from the record that comes back (spec rule 3), which is why every
 * button is disabled while `isBusy` — a second tap would race the first response.
 */

interface Props {
  payment: FundingPayment;
  /**
   * How this payment is named — `$500 Check`, or `$500 Check (1 of 2)` once the
   * job carries repeated identical lines. Passed in rather than derived here
   * because the ordinal is only meaningful against the WHOLE record, and it has to
   * agree with the footer's blocker list, which numbers the same way.
   */
  title?: string;
  /** Is the whole contract covered? Decides whether a partial approval still blocks. */
  covered: boolean;
  /** Result is Bank Decline — the job is closing, so lender actions stop being offered. */
  bankDeclined: boolean;
  /**
   * The company's gateway can't accept payments (`charges_enabled`). Links cannot
   * be created OR marked sent, so the send is withdrawn rather than left live to
   * fail — the reason is stated once, company-wide, in `FundingView`.
   */
  linkBlocked?: boolean;
  /** An action for THIS payment is in flight. */
  isBusy: boolean;
  onSendLink: () => void;
  onMarkCollected: () => void;
  onChargeCard: () => void;
  onActivate: () => void;
  /** Ask the processor/lender what happened — `POST …/sync`. */
  onSync: () => void;
  /** "Add another payment method" — sends the rep back to the pricing screen. */
  onEditPayments: () => void;
  /** Offered only when a lender declined and the job could close as one. */
  onResultAsBankDecline: () => void;
  /**
   * Re-settle a DRIFTED loan against what the job needs now (`POST …/reactivate`).
   *
   * ⚠️ Omit it and the drift is still REPORTED but not actionable — which is the
   * right degradation, because a rep who cannot see that the lender is committed to
   * a different number will quote the one on screen.
   */
  onReactivate?: () => void;
}

/** Full-width action. `alt` is the outlined secondary used for recovery paths. */
function ActionButton({ label, onPress, alt, tone, busy, disabled }: {
  label: string; onPress: () => void; alt?: boolean; tone?: 'danger'; busy?: boolean; disabled?: boolean;
}) {
  const danger = tone === 'danger';
  const off = !!disabled || !!busy;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={off}
      style={{
        marginTop: 12,
        borderRadius: 11,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: off ? 0.55 : 1,
        backgroundColor: alt ? '#fff' : FUND.GREEN,
        borderWidth: alt ? 1.6 : 0,
        borderColor: danger ? FUND.RED_BORDER : FUND.BORDER,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={alt ? FUND.SUBTEXT : '#fff'} />
      ) : (
        <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: alt ? (danger ? FUND.RED_TEXT : '#3A4048') : '#fff' }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  const bad = tone === 'bad';
  return (
    <View style={{ marginTop: 12, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: bad ? FUND.RED_BG : FUND.AMBER_BG }}>
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, lineHeight: 18, color: bad ? FUND.RED_TEXT : FUND.AMBER_TEXT }}>{children}</Text>
    </View>
  );
}

export function PaymentFundingCard({
  payment: p,
  title,
  covered,
  bankDeclined,
  linkBlocked,
  isBusy,
  onSendLink,
  onMarkCollected,
  onChargeCard,
  onActivate,
  onSync,
  onEditPayments,
  onResultAsBankDecline,
  onReactivate,
}: Props) {
  const steps = FLOW[p.type] || [];
  /** Where the last send went — see the resend block below. */
  const sendNote = lastSendNote(p);
  const finished = doneFor(p, covered);
  const isOpenShort = openShort(p, covered);
  const shortfall = p.decision === 'short' && p.requested != null ? p.requested - (p.approvedAmt || 0) : 0;
  /**
   * The settled-vs-live gap, or `null` when there is nothing to reconcile.
   *
   * ⚠️ Requires a real `baseline` AND an actual difference: the server sets
   * `drifted` from its own comparison, and a row carrying the flag without a
   * baseline would render "PRIOR $0", which reads as the lender having committed to
   * nothing. Declined rows are excluded because `reactivate` refuses them — offering
   * a button that can only 409 is worse than showing no button.
   */
  const drift =
    p.drifted && p.decision !== 'declined' && Number(p.baseline) > 0 && Number(p.liveUsage) !== Number(p.baseline)
      ? {
          prior: Number(p.baseline),
          live: Number(p.liveUsage),
          diff: Number(p.liveUsage) - Number(p.baseline),
          up: Number(p.liveUsage) > Number(p.baseline),
        }
      : null;
  /** The homeowner closed the hosted page. The row is back at unsent — see `funding.ts`. */
  const closed = isApplicationClosed(p);
  const closedNote = applicationClosedNote(p);
  /**
   * `(1 of 2)` lifted out of the composed title. Only the ordinal is rendered —
   * the amount and the method already have their own places on the card, and
   * repeating the whole sentence would say each of them twice.
   */
  const ordinal = /\((\d+ of \d+)\)\s*$/.exec(title || '')?.[0] || '';

  // Card tint states the verdict before the rep reads a word of it.
  const tint =
    p.decision === 'declined'
      ? { border: FUND.RED_BORDER, bg: FUND.RED_CARD_BG }
      : isOpenShort || closed
        ? { border: FUND.AMBER_BORDER, bg: FUND.AMBER_CARD_BG }
        : finished
          ? { border: FUND.GREEN_BORDER, bg: FUND.GREEN_CARD_BG }
          : { border: FUND.BORDER, bg: '#fff' };

  // A balance payment's LAST step is always somebody else's — say who, so the
  // unchecked dot doesn't read as an outstanding rep task.
  let note = '';
  if (p.type === 'check' && p.kind === 'down' && !finished) {
    note = 'Deposited is posted by the bank. It is not a rep step and never checks off here.';
  } else if (p.kind === 'bal' && !finished) {
    note =
      p.type === 'check'
        ? 'Collected and deposited are handled by the install crew. Neither is a rep step.'
        : `${steps[steps.length - 1]} is posted by the ${ownerOf(p).toLowerCase()} after install. Not a rep step.`;
  }

  return (
    <View style={{ borderWidth: 1.6, borderColor: tint.border, backgroundColor: tint.bg, borderRadius: 16, paddingHorizontal: 14, paddingTop: 15, paddingBottom: 12, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 }}>
          <Text style={{ fontSize: FS.DISPLAY, fontFamily: PS.bold, letterSpacing: -0.4, color: FUND.TEXT }}>
            ${p.amount.toLocaleString()}
          </Text>
          {/* Only the ordinal, and only when there IS one: two `$500 Check` cards
              are otherwise pixel-identical and the rep cannot tell which one a
              blocker sentence is about. */}
          {!!ordinal && (
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, color: FUND.MUTED }}>{ordinal}</Text>
          )}
        </View>
        <View style={{ maxWidth: '58%', backgroundColor: FUND.FILL, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20 }}>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT }} numberOfLines={1}>
            {p.method}
          </Text>
        </View>
      </View>

      <FundingStepper payment={p} covered={covered} />

      {/* ── rep actions ──
          Each is gated on the SERVER's own flag, never on a local guess: only the
          rep's own steps appear, and each disappears the moment the record comes
          back with it done. */}
      {p.type === 'check' && p.kind === 'down' && !p.collected && (
        <ActionButton label="Mark collected" onPress={onMarkCollected} busy={isBusy} />
      )}

      {/* ⚠️ Sits ABOVE the send button so the rep reads why they are sending again
          before the button that does it — the row is back at `linkSent: false`, so
          without this the card is indistinguishable from one never sent. */}
      {!!closedNote && !bankDeclined && <Banner tone="warn">{closedNote}</Banner>}

      {(p.type === 'cc' || p.type === 'bank') && !p.linkSent && !bankDeclined && (
        <ActionButton
          // "Send again" is the honest label once the homeowner has already had one.
          label={
            linkBlocked
              ? 'Payments not set up — can’t send'
              : `${closed ? 'Send a new' : 'Send'} ${p.type === 'bank' ? 'application' : 'payment'} link`
          }
          onPress={onSendLink}
          busy={isBusy}
          // Withdrawn rather than left live to fail: a 409 the rep cannot fix
          // invites retry-until-support. The reason is on the banner above.
          disabled={linkBlocked}
        />
      )}

      {/* ── the link went to the wrong place ──
          Once `linkSent` ticks, the send button above disappears — so a rep who
          mistyped a digit was left on a card that says the link went out with no
          way to correct it (REVDSM-1155 Item A).

          ⚠️ **The destination is shown, not just the button.** `Link Sent` alone
          cannot tell a rep that anything is wrong; reading `Texted to 443-878-4937`
          back to them is what makes the typo visible. A resend button without it
          would just be a second chance to send to the same wrong number.

          ⚠️ Withdrawn once the card is on file / a lender has answered — see
          `canResendLink`. Past that a resend has no legitimate use and the backend
          intends to refuse it; the route for a different card is to remove the row
          in the pricing panel and add a new one. */}
      {canResendLink(p) && !bankDeclined && (
        <View style={{ marginTop: 12, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons
              name={p.sentChannel === 'email' ? 'mail-outline' : p.sentChannel === 'qr' ? 'qr-code-outline' : 'chatbubble-ellipses-outline'}
              size={14}
              color={FUND.SUBTEXT}
            />
            <Text style={{ flex: 1, fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT }} numberOfLines={2}>
              {sendNote}
            </Text>
          </View>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, lineHeight: 16, color: FUND.MUTED, marginTop: 6 }}>
            {p.sentChannel === 'qr'
              ? 'Didn’t go through? Send it to their phone or email instead.'
              : 'Wrong number or address? Fix it and send the same link again.'}
          </Text>
          {/* Outlined, not green: the primary action on this card is still waiting
              for the homeowner, and a filled button here would compete with it. */}
          <ActionButton
            label={linkBlocked ? 'Payments not set up — can’t send' : 'Send again'}
            alt
            onPress={onSendLink}
            busy={isBusy}
            disabled={linkBlocked}
          />
        </View>
      )}

      {/* Card on File is not a rep action — the processor reports it on Sync.
          Charging is: a DOWN-payment card on file that has not been charged. A
          balance card is charged by the processor after install and the endpoint
          refuses it (spec §5.10). */}
      {p.type === 'cc' && p.kind === 'down' && p.step >= 2 && !p.charged && (
        <ActionButton label={`Charge $${p.amount.toLocaleString()}`} onPress={onChargeCard} busy={isBusy} />
      )}

      {/* ── drift ──
          The lender is committed to `baseline`; the job now needs `liveUsage`. An
          addendum that moves the contract price does this every time, so on the
          deal-edit flow it is the normal case, not an edge one.

          ⚠️ Shown as PRIOR → NEW rather than as the new figure alone: until the row
          is re-settled the amount on this card is NOT what the lender agreed to, and
          a single number cannot say that. The button is the only thing that closes
          the gap — `reactivate` is refused on a declined row and 409s when the two
          already match, so it is offered only while both are true here. */}
      {drift && !bankDeclined && (
        <View style={{ marginTop: 12, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F1F5F9', borderRadius: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: onReactivate ? 10 : 0 }}>
            <View>
              <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, letterSpacing: 0.3, color: '#94A3B8' }}>PRIOR</Text>
              <Text style={{ fontSize: FS.LEAD, fontFamily: PS.extrabold, color: FUND.TEXT, marginTop: 2 }}>${drift.prior.toLocaleString()}</Text>
            </View>
            <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.regular, color: '#CBD5E1' }}>→</Text>
            <View>
              <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, letterSpacing: 0.3, color: '#94A3B8' }}>NEW</Text>
              <Text style={{ fontSize: FS.LEAD, fontFamily: PS.extrabold, color: FUND.TEXT, marginTop: 2 }}>${drift.live.toLocaleString()}</Text>
            </View>
            <View style={{ marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: drift.up ? FUND.AMBER_BG : '#E0F2FE' }}>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, color: drift.up ? '#B45309' : '#0369A1' }}>
                {drift.up ? '+' : '−'}${Math.abs(drift.diff).toLocaleString()}
              </Text>
            </View>
          </View>
          {!!onReactivate && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onReactivate}
              disabled={isBusy}
              style={{ borderRadius: 11, paddingVertical: 12, alignItems: 'center', backgroundColor: isBusy ? '#94A3B8' : '#0C2618' }}
            >
              <Text style={{ fontSize: FS.BODY, fontFamily: PS.extrabold, letterSpacing: 0.2, color: '#fff' }}>
                Reactivate loan for ${drift.live.toLocaleString()}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {p.type === 'bank' && !p.activated && (p.decision === 'full' || (p.decision === 'short' && !isOpenShort)) && (
        <ActionButton
          label={`Authorize & activate loan for $${(p.approvedAmt != null ? p.approvedAmt : p.amount).toLocaleString()}`}
          onPress={onActivate}
          busy={isBusy}
        />
      )}

      {p.type === 'bank' && isOpenShort && (
        <>
          <Banner tone="warn">
            Approved for ${(p.approvedAmt || 0).toLocaleString()} of ${(p.requested || p.amount).toLocaleString()} requested. $
            {shortfall.toLocaleString()} needs a different payment method before this can be authorized.
          </Banner>
          <ActionButton label="Add another payment method" onPress={onEditPayments} alt disabled={isBusy} />
        </>
      )}

      {p.type === 'bank' && p.decision === 'declined' && !bankDeclined && (
        <>
          <Banner tone="bad">
            Declined. The full ${p.amount.toLocaleString()} needs a different payment method — or the job gets resulted as a
            bank decline.
          </Banner>
          <ActionButton label="Add another payment method" onPress={onEditPayments} alt disabled={isBusy} />
          <ActionButton label="Result as Bank Decline" onPress={onResultAsBankDecline} alt tone="danger" disabled={isBusy} />
        </>
      )}

      {/* Status check — only while a third party still owes an answer. A check has
          no external system to poll and `sync` refuses it (spec §5.8). */}
      {canSync(p) && !finished && (
        <View style={{ marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.MUTED }}>
            {p.syncedAt ? `Synced ${formatStamp(p.syncedAt)}` : 'Awaiting response'}
          </Text>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={onSync}
            disabled={isBusy}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: isBusy ? 0.55 : 1, backgroundColor: FUND.FILL, borderWidth: 1, borderColor: FUND.BORDER, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7 }}
          >
            {isBusy ? <ActivityIndicator size="small" color={FUND.SUBTEXT} /> : <Ionicons name="refresh" size={13} color={FUND.SUBTEXT} />}
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT }}>Sync</Text>
          </TouchableOpacity>
        </View>
      )}

      {!!finished && (
        <View style={{ marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#D8EECD', flexDirection: 'row', gap: 7 }}>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.GREEN_TEXT }}>✓</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.GREEN_TEXT, lineHeight: 17 }}>All set for now</Text>
            <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: '#5F7A55', lineHeight: 17, marginTop: 2 }}>{finished}</Text>
          </View>
        </View>
      )}

      {!!note && (
        <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: FUND.BORDER }}>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, lineHeight: 17 }}>{note}</Text>
        </View>
      )}
    </View>
  );
}