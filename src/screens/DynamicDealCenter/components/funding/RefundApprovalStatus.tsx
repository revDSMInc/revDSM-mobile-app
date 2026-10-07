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

const ROSE = {
  BG: '#FFF1F2',
  BORDER: '#FDA4AF',
  LINE: '#FBCFE8',
  TEXT: '#9F1239',
  STRONG: '#BE123C',
} as const;

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
      return { bg: '#FEF3C7', fg: '#92400E', label };
  }
}

interface RailProps {
  amount: number;
  refund?: FundingRefund | null;
  reminder?: FundingApprovalReminder | null;
  approverName?: string;
  onRemind?: () => void;
  reminding?: boolean;
}

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
        !!reminder.blockedReason && (
          <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 15, color: ROSE.TEXT }}>
            {reminder.blockedReason}
          </Text>
        )
      )}
    </View>
  );
}

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
  selectedName?: string;
  isLoading?: boolean;
  isConfigured: boolean;
  isError?: boolean;
  onRetry?: () => void;
  locked?: boolean;
  onPress: () => void;
}

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
