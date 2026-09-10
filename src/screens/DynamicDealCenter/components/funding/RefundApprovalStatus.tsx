import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, PS } from './funding-theme';
import { StepRail, type RailStep } from './StepRail';
import {
  REFUND_APPROVAL_STEPS,
  REFUND_REASON_LABELS,
  REFUND_STATE_LABELS,
  refundApprovalNote,
  refundApprovalStates,
  refundStateTone,
  waitingLabel,
} from '../../utils/funding';
import type { FundingApprovalReminder, FundingRefund } from '../../../../services/api/FundingService';

/**
 * The refund's approval status — the bar the rep reads to answer "where has my
 * money-back request got to, and who is holding it".
 *
 * ⚠️ **A refund is the one thing on this screen a third party decides**, and it is
 * decided twice: an approver unlocks the customer's signature, and only then does a
 * manager release the funds. So the rail runs Raised → Approved → Customer Signs →
 * Refunded and "Approved" sits SECOND of four. Any shorter reading of it — a
 * two-step approved/not, or a rail that ends on approval — tells the rep the money
 * has gone back when it has not.
 *
 * The rail itself is `StepRail`, the same renderer the payment cards use, so a
 * finished step looks identical whether it is a charged card or a signed refund.
 *
 * ⚠️ The rose palette here is deliberately the SAME set of hexes the refund blocks in
 * `DynamicDealEditScreen` already use — this component is dropped inside them, and a
 * second rose would read as a nested, unrelated card.
 */

const ROSE = {
  BG: '#FFF1F2',
  BORDER: '#FDA4AF',
  LINE: '#FBCFE8',
  TEXT: '#9F1239',
  STRONG: '#BE123C',
} as const;

/** The state chip's colours. Mirrors `refundStateTone`, which owns the rule. */
function chipColors(refund?: FundingRefund | null): { bg: string; fg: string; label: string } {
  if (!refund?.state) return { bg: '#E2E8F0', fg: '#475569', label: 'Not raised yet' };
  const label = REFUND_STATE_LABELS[refund.state] || refund.state;
  switch (refundStateTone(refund.state)) {
    case 'ok':
      return { bg: '#DCFCE7', fg: '#15803D', label };
    case 'bad':
      return { bg: '#FEE2E2', fg: '#B91C1C', label };
    case 'muted':
      return { bg: '#E2E8F0', fg: '#475569', label };
    default:
      // ⚠️ Amber, and this is the one that matters: an approved request waiting on
      // the customer is the NORMAL resting state. Green would say the money is back.
      return { bg: '#FEF3C7', fg: '#92400E', label };
  }
}

interface RailProps {
  /**
   * What goes back. The rep's own arithmetic before a request exists, the SERVER's
   * figure after — the two are the same number until the rep re-prices again, and
   * the one the approver was actually sent is the one that counts.
   */
  amount: number;
  refund?: FundingRefund | null;
  /**
   * The reminder window, straight off the approval row (REVDSM-1160). Omitted where
   * there is nothing to chase, so the block renders nothing rather than guessing.
   */
  reminder?: FundingApprovalReminder | null;
  /** Who is being waited on — the "on Sam Patel" half of the waiting line. */
  approverName?: string;
  /** Omit and the wait is still REPORTED, just not actionable — the right degradation. */
  onRemind?: () => void;
  reminding?: boolean;
}

/**
 * The status block without card chrome, for dropping into a refund card that already
 * exists. `RefundApprovalCard` is the same thing with its own border.
 */
export function RefundStatusRail({ amount, refund, reminder, approverName, onRemind, reminding }: RailProps) {
  const chip = chipColors(refund);
  const states = refundApprovalStates(refund);
  const steps: RailStep[] = REFUND_APPROVAL_STEPS.map((label, i) => ({ label, state: states[i] || 'next' }));
  const sent = Number(refund?.amount) || 0;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ backgroundColor: chip.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: FS.MICRO, fontFamily: PS.extrabold, letterSpacing: 0.5, textTransform: 'uppercase', color: chip.fg }}>
            {chip.label}
          </Text>
        </View>
        {/* Method and reason ride beside the chip rather than on rows of their own:
            once the request is out they are facts about it, not fields. */}
        {!!refund && (
          <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, color: ROSE.TEXT }} numberOfLines={1}>
            {refund.method === 'card' ? 'Back to the card' : 'Cheque in the post'}
            {refund.reason ? ' · ' + (REFUND_REASON_LABELS[refund.reason] || refund.reason) : ''}
          </Text>
        )}
      </View>

      <StepRail steps={steps} />

      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, lineHeight: 16, color: ROSE.TEXT, marginTop: 12 }}>
        {refundApprovalNote(refund)}
      </Text>

      {/* ⚠️ Said out loud when the two disagree. A rep who re-prices after the request
          has gone out would otherwise read the new figure as the one being approved. */}
      {sent > 0 && Math.round(sent) !== Math.round(amount) && (
        <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, color: ROSE.STRONG, marginTop: 6 }}>
          Sent for approval at ${Math.round(sent).toLocaleString()}
        </Text>
      )}

      <RefundReminderBlock
        refund={refund}
        reminder={reminder}
        approverName={approverName}
        onRemind={onRemind}
        reminding={reminding}
      />
    </View>
  );
}

/**
 * "Waiting 3 days on Sam Patel" + **Remind approver** (REVDSM-1160).
 *
 * ⚠️ **Only while the request is `pendingApproval`.** The server's `canRemind` already
 * refuses a decided request — there is nobody left to chase — but rendering its
 * `blockedReason` under an APPROVED refund would put "This request is already
 * approved" on a card whose rail says exactly that one line above.
 *
 * ⚠️ **`canRemind` and `blockedReason` are the SERVER's, and are never recomputed
 * here.** The window is two backend constants (48 h, then one reminder a day) and 48
 * is the backend's own assumption pending Lance's confirmation — serving it is
 * precisely what lets it change with no app release. A device that did its own
 * arithmetic would offer a button the endpoint then refuses.
 *
 * A row carrying no `reminder` at all renders nothing: a deployment predating this
 * feature must not show a button whose endpoint 404s.
 */
function RefundReminderBlock({
  refund,
  reminder,
  approverName,
  onRemind,
  reminding,
}: {
  refund?: FundingRefund | null;
  reminder?: FundingApprovalReminder | null;
  approverName?: string;
  onRemind?: () => void;
  reminding?: boolean;
}) {
  if (!reminder || refund?.state !== 'pendingApproval') return null;

  const waiting = waitingLabel(reminder, approverName);
  const canRemind = reminder.canRemind === true && !!onRemind;

  return (
    <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: ROSE.LINE, paddingTop: 10 }}>
      {/* Why a rep would chase, above the control that does it. */}
      {!!waiting && (
        <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, color: ROSE.TEXT, marginBottom: 8 }}>
          {waiting}
        </Text>
      )}

      {canRemind ? (
        <TouchableOpacity
          /**
           * ⚠️ Called through an arrow, NEVER passed straight in. `onPress` hands its
           * handler a `GestureResponderEvent`, and the hook's `remind(note?)` takes an
           * optional first argument — so `onPress={onRemind}` would post the touch
           * event to the API as the reminder's `note`. The prop type `() => void`
           * hides that from tsc.
           */
          onPress={() => onRemind?.()}
          disabled={reminding}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            minHeight: 40,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: ROSE.BORDER,
            backgroundColor: '#FFFFFF',
            paddingHorizontal: 12,
            opacity: reminding ? 0.6 : 1,
          }}
        >
          {reminding ? (
            <ActivityIndicator size="small" color={ROSE.STRONG} />
          ) : (
            <Ionicons name="notifications-outline" size={15} color={ROSE.STRONG} />
          )}
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: ROSE.STRONG }}>
            {reminding ? 'Sending…' : 'Remind approver'}
          </Text>
        </TouchableOpacity>
      ) : (
        // ⚠️ The server's own wording, verbatim — it names the window ("You can send a
        // reminder once this has been waiting 2 days."), which no client-side string can.
        !!reminder.blockedReason && (
          <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 15, color: ROSE.TEXT }}>
            {reminder.blockedReason}
          </Text>
        )
      )}
    </View>
  );
}

/** The same block with its own card, for a screen that has no refund card already. */
export function RefundApprovalCard({ amount, refund, reminder, approverName, onRemind, reminding }: RailProps) {
  const sent = Number(refund?.amount) || 0;
  const shown = sent > 0 ? sent : amount;
  return (
    <View style={{ backgroundColor: ROSE.BG, borderWidth: 1.5, borderColor: ROSE.BORDER, borderRadius: 14, padding: 14, marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 0.4, color: ROSE.TEXT }}>REFUND TO CUSTOMER</Text>
        <Text style={{ fontSize: FS.DISPLAY, fontFamily: PS.bold, color: ROSE.STRONG }}>
          −${Math.round(shown).toLocaleString()}
        </Text>
      </View>
      <RefundStatusRail
        amount={shown}
        refund={refund}
        reminder={reminder}
        approverName={approverName}
        onRemind={onRemind}
        reminding={reminding}
      />
    </View>
  );
}

interface ApproverRowProps {
  label?: string;
  /** The chosen approver's name, or empty for the placeholder. */
  selectedName?: string;
  isLoading?: boolean;
  /** `false` means nobody in the company may approve, so the request would 409. */
  isConfigured: boolean;
  /**
   * The list could not be READ. ⚠️ A completely different thing from
   * `isConfigured: false`, and it must not borrow that message: one says "ask your
   * admin to set approvers up", the other says "the app could not reach the server".
   * Telling a rep to chase their admin over a dropped request sends them somewhere
   * nobody can help them.
   */
  isError?: boolean;
  onRetry?: () => void;
  /**
   * The request is out with this person and they have not answered.
   *
   * ⚠️ The approver is then FIXED. Re-picking here would only change a local field —
   * the request the approver is looking at is already filed against them server-side,
   * and moving it needs `POST /approvals/:id/reassign`, which is `pending`-only and
   * is not wired. A picker that silently changed nothing would be worse than one that
   * says why it is closed.
   */
  locked?: boolean;
  onPress: () => void;
}

/**
 * "Send for approval to" — the one control that decides who this refund lands on.
 *
 * ⚠️ Its own component because it is rendered TWICE: on the pricing step, where the
 * rep has just dropped the price and is being told a refund follows, and again on
 * Review beside "Send Addendum To". Both drive the same `approverId`, so a second
 * implementation would be two controls able to disagree about who was chosen.
 */
export function RefundApproverRow({
  label = 'Send for approval to',
  selectedName,
  isLoading,
  isConfigured,
  isError,
  onRetry,
  locked,
  onPress,
}: ApproverRowProps) {
  const disabled = locked || !isConfigured;
  const placeholder = locked
    ? 'Out for approval'
    : isLoading
      ? 'Loading approvers…'
      : isError
        ? 'Could not load approvers'
        : isConfigured
          ? 'Choose an approver'
          : 'No approvers configured';

  return (
    <View>
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: ROSE.TEXT, marginTop: 14, marginBottom: 5 }}>{label}</Text>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        disabled={disabled}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, borderWidth: 1.5, borderColor: ROSE.LINE, backgroundColor: locked ? '#FFF7F8' : '#fff', borderRadius: 10, paddingHorizontal: 12, opacity: disabled ? 0.7 : 1 }}
      >
        <Text
          style={{ flex: 1, fontSize: FS.BODY_LG, fontFamily: PS.bold, color: selectedName ? '#0F172A' : '#9CA3AF' }}
          numberOfLines={1}
        >
          {selectedName || placeholder}
        </Text>
        {isLoading ? (
          <ActivityIndicator size="small" color="#9CA3AF" />
        ) : (
          <Ionicons name={locked ? 'lock-closed' : 'chevron-down'} size={15} color="#9CA3AF" />
        )}
      </TouchableOpacity>

      {/* ⚠️ Locked, and the reason said out loud. A greyed control with no explanation
          reads as a bug — and this one is a rule: the request is already filed against
          this person, so the rep waits for their answer rather than quietly re-pointing
          a field the server has never heard about. */}
      {locked && (
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: ROSE.TEXT, marginTop: 6, lineHeight: 16 }}>
          This refund is already with {selectedName || 'the approver'}. It cannot be sent to anyone else
          until they approve or decline it.
        </Text>
      )}

      {/* The read failed — the rep's move is to retry, not to call their admin. */}
      {!locked && isError && (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <Text style={{ flex: 1, fontSize: FS.SMALL, fontFamily: PS.bold, color: ROSE.STRONG, lineHeight: 16 }}>
            Could not load the list of approvers.
          </Text>
          {!!onRetry && (
            <TouchableOpacity onPress={onRetry} style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 10 }}>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, color: ROSE.STRONG, textDecorationLine: 'underline' }}>
                Try again
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ⚠️ Only once the server has actually SAID there is nobody. It names the one
          person who can clear it — a rep cannot fix this from here, and a generic
          failure would have them retrying until they call support. */}
      {!locked && !isConfigured && !isLoading && !isError && (
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: ROSE.STRONG, marginTop: 6, lineHeight: 16 }}>
          Nobody in your company is set up to approve refunds. Ask your admin to add refund
          approvers in the portal — the request cannot be sent until they do.
        </Text>
      )}
    </View>
  );
}
