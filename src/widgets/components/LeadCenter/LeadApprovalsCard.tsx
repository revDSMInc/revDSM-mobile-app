import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { useLeadApprovals } from '../../../hooks/useLeadApprovals';
import { useRefundApprovers } from '../../../screens/DynamicDealCenter/hooks/useRefundApprovers';
import { FundingService } from '../../../services/api/FundingService';
import {
  approvalIdOf,
  approverNameOf,
  describeApproval,
  isApprovalAssigned,
  refundWaitingOn,
  refundsOnJob,
  waitingLabel,
} from '../../../screens/DynamicDealCenter/utils/funding';
import type { FundingPayment } from '../../../screens/DynamicDealCenter/utils/funding';

const ROSE = { BG: '#FFF1F2', BORDER: '#FDA4AF', LINE: '#FBCFE8', TEXT: '#9F1239', STRONG: '#BE123C' };

interface Props {
  leadId?: string;
  companyId?: string;
  payments?: FundingPayment[];
  enabled?: boolean;
}

export function LeadApprovalsCard({ leadId, companyId, payments, enabled = true }: Props) {
  const feed = useLeadApprovals(leadId, enabled, companyId);
  const hasApprovals = feed.approvals.length > 0;

  const fundingQuery = useQuery({
    queryKey: ['leadApprovalsFunding', leadId || 'none'],
    queryFn: async () => (await FundingService.getFunding(leadId!, companyId))?.data,
    enabled: enabled && !!leadId && hasApprovals && !payments,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const rows: FundingPayment[] =
    payments || (fundingQuery.data as any)?.data?.payments || (fundingQuery.data as any)?.payments || [];

  const approverFeed = useRefundApprovers(enabled && hasApprovals, companyId);
  const namesById = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of approverFeed.approvers) if (a?.id) map[String(a.id)] = a.name;
    return map;
  }, [approverFeed.approvers]);

  const awaitingRelease = refundsOnJob(rows).filter(
    ({ refund }) => refund.state === 'customerSigned' || refund.state === 'issuing'
  );

  if (!feed.outstanding.length && !awaitingRelease.length) return null;

  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: ROSE.BORDER,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="shield-check-outline" size={17} color={ROSE.STRONG} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '800', color: ROSE.TEXT }}>
          Approvals ({feed.outstanding.length + awaitingRelease.length})
        </Text>
        {feed.isLoading && <ActivityIndicator size="small" color={ROSE.STRONG} />}
      </View>

      {/* ── still with an approver ─────────────────────────────────────────────── */}
      {feed.outstanding.map((approval, i) => {
        const id = approvalIdOf(approval);
        const reminder = feed.reminderFor(approval);
        const who = approverNameOf(approval, namesById);
        const waiting = waitingLabel(reminder, who);
        const sending = feed.sendingId === id;
        const canRemind = reminder?.canRemind === true && !!id;

        return (
          <View
            key={id || `approval-${i}`}
            style={{
              backgroundColor: ROSE.BG,
              borderRadius: 12,
              padding: 12,
              marginBottom: i === feed.outstanding.length - 1 && !awaitingRelease.length ? 0 : 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: ROSE.TEXT }} numberOfLines={1}>
                {describeApproval(approval, rows)}
              </Text>
              <View style={{ backgroundColor: '#FFAB00', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#1C252E' }}>AWAITING APPROVAL</Text>
              </View>
            </View>

            {/* ⚠️ THREE states, not two. The row carries `assignedToUserId` and no name,
                so "no name" does NOT mean "nobody has it" — saying so on a request that
                is assigned is worse than saying nothing at all. */}
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: ROSE.TEXT, lineHeight: 16, marginTop: 5 }}>
              {who ? `With ${who}.` : isApprovalAssigned(approval) ? 'Sent for approval.' : 'Not assigned to anybody yet.'}
              {waiting ? ` ${waiting}.` : ''}
            </Text>

            {canRemind ? (
              <TouchableOpacity
                onPress={() => feed.remind(id)}
                disabled={sending}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  minHeight: 40,
                  marginTop: 10,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: ROSE.BORDER,
                  backgroundColor: '#fff',
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={ROSE.STRONG} />
                ) : (
                  <Icon name="bell-ring-outline" size={15} color={ROSE.STRONG} />
                )}
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: ROSE.STRONG }}>
                  {sending ? 'Sending…' : 'Remind approver'}
                </Text>
              </TouchableOpacity>
            ) : (
              !!reminder?.blockedReason && (
                <Text style={{ fontSize: 11, fontWeight: '600', color: ROSE.TEXT, lineHeight: 15, marginTop: 8 }}>
                  {reminder.blockedReason}
                </Text>
              )
            )}
          </View>
        );
      })}

      {/* ── approved, signed, and the money still has not moved ────────────────── */}
      {awaitingRelease.map(({ refund }, i) => (
        <View
          key={refund.rid || `release-${i}`}
          style={{
            backgroundColor: '#FFFBEB',
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: '#FDE68A',
            padding: 12,
            marginTop: i === 0 && feed.outstanding.length ? 8 : 0,
            marginBottom: i === awaitingRelease.length - 1 ? 0 : 8,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: '#92400E' }} numberOfLines={1}>
              Refund · ${Math.round(Number(refund.amount) || 0).toLocaleString()}
            </Text>
            <View style={{ backgroundColor: '#F59E0B', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>AWAITING RELEASE</Text>
            </View>
          </View>
          {/**
           * ⚠️ A STATUS, not an action — and there is deliberately no button here.
           * Issuing a refund is **Command Center only** (*"Only managers who have access
           * to command center can issue a refund"*), the app ships no `issueRefund`, and
           * the reminder endpoint only chases a PENDING approver, so a decided request
           * answers `canRemind: false`. A button that could only 409 would be worse than
           * none — see `isRemovableRow` for the same rule.
           */}
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#92400E', lineHeight: 16, marginTop: 5 }}>
            Approved and signed. {refundWaitingOn(refund.state)}.
          </Text>
        </View>
      ))}
    </View>
  );
}
