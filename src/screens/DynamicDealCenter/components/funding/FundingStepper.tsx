import React from 'react';
import { StepRail, type RailStep } from './StepRail';
import { FLOW, ownerOf, stateOf, type FundingPayment } from '../../utils/funding';

export function FundingStepper({ payment, covered }: { payment: FundingPayment; covered: boolean }) {
  const labels = FLOW[payment.type] || [];
  const st = stateOf(payment, covered);
  const owner = ownerOf(payment);

  const steps: RailStep[] = labels.map((label, i) => {
    const state = st[i] || 'next';
    const approvedSub = i === 1 && payment.type === 'bank' && payment.approvedAmt != null;
    return {
      label: i === 1 && payment.type === 'bank' && payment.decision === 'declined' ? 'Declined' : label,
      state,
      sub: approvedSub ? `$${(payment.approvedAmt || 0).toLocaleString()}` : undefined,
      caption: state === 'locked' ? owner : undefined,
    };
  });

  return <StepRail steps={steps} />;
}
