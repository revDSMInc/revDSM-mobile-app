import React from 'react';
import { StepRail, type RailStep } from './StepRail';
import { FLOW, ownerOf, stateOf, type FundingPayment } from '../../utils/funding';

/**
 * The progress rail on a funding card — one dot per step of the payment's own life
 * cycle (check → Collected → Deposited; card → Link Sent → Card on File → Charged;
 * bank → Link Sent → Approved → Activated → Funded).
 *
 * ⚠️ The DRAWING lives in `StepRail`, which the refund's approval rail also uses.
 * This file is only the translation from a payment to that rail: which steps it has,
 * what state each is in, and the two payment-specific captions below. Keeping the two
 * rails on one renderer is what stops a finished step meaning two different things on
 * a screen that shows both at once.
 */
export function FundingStepper({ payment, covered }: { payment: FundingPayment; covered: boolean }) {
  const labels = FLOW[payment.type] || [];
  const st = stateOf(payment, covered);
  const owner = ownerOf(payment);

  const steps: RailStep[] = labels.map((label, i) => {
    const state = st[i] || 'next';
    // Step 2 of a bank flow shows what was actually approved, which is the one
    // number the rep is asked about at the table.
    const approvedSub = i === 1 && payment.type === 'bank' && payment.approvedAmt != null;
    return {
      label: i === 1 && payment.type === 'bank' && payment.decision === 'declined' ? 'Declined' : label,
      state,
      sub: approvedSub ? `$${(payment.approvedAmt || 0).toLocaleString()}` : undefined,
      // Named only on a step the rep does not perform, so a dashed dot reads as
      // "somebody else posts this" rather than as an unfinished task.
      caption: state === 'locked' ? owner : undefined,
    };
  });

  return <StepRail steps={steps} />;
}
