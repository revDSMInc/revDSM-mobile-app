/**
 * What a rep may raise as an addendum with no signal, and what must wait.
 *
 * An addendum is a contract amendment the homeowner signs. Most of one is local work - the
 * build changed, the price changed, a note - and that queues safely. Two things do not, and
 * both are refused here rather than half-done.
 *
 * Pure (CLAUDE.md section 6): no React Native import, so the rules are testable.
 */

export type AddendumBlockReason = 'refund' | 'documents';

export interface AddendumOfflineBlock {
  reason: AddendumBlockReason;
  title: string;
  message: string;
}

/**
 * ⚠️ A REFUND needs an approver, and an approver is a person with a connection.
 *
 * Phase 3 of `docs/MY-DEALS-OFFLINE-PLAN.md` adds cheque refunds to the queue. Until then a
 * price drop offline is refused outright: raising the addendum without its refund would send
 * the homeowner paperwork saying they are owed money that nobody has recorded.
 */
const REFUND_BLOCK: AddendumOfflineBlock = {
  reason: 'refund',
  title: 'This change needs a connection',
  message:
    'Lowering the price raises a refund, which has to be approved by someone in the office. Raise this one once you have signal — everything else about the deal can still be edited now.',
};

/**
 * ⚠️ Documents are inlined as base64 `data:` URIs, and base64 must never go into MMKV - it
 * rewrites its whole store on every write, so one document-heavy addendum would tax every
 * unrelated write for the rest of the session. Phase 4.
 */
const DOCUMENT_BLOCK: AddendumOfflineBlock = {
  reason: 'documents',
  title: 'Attachments need a connection',
  message:
    'A new agreement or order sheet is uploaded to the server, so it needs a connection. Submit this addendum without the attachment, or wait until you have signal.',
};

/**
 * ⚠️ A CARD refund reverses the charge through the processor - it can decline, part-settle or
 * error, none of which a device can resolve. A CHEQUE refund is only a RECORD that the office
 * will post one: nothing moves on submit, so it queues like any other write.
 *
 * Not a severity judgement. They are different kinds of operation.
 */
export const refundMethodAvailableOffline = (method: 'card' | 'check' | ''): boolean =>
  // ⚠️ Only an EXPLICIT cheque queues. An unset method must not fall through as "fine" - the
  // refund would be sent as a cheque the rep never chose. `refundBlockers` requires a method
  // before Submit anyway, so this is defence in depth rather than a reachable state.
  method === 'check';

export const CARD_REFUND_OFFLINE_MSG =
  'A card refund goes back through the processor, so it needs a connection. Take it as a cheque, or raise this once you have signal.';

export const addendumOfflineBlock = (opts: {
  online: boolean;
  hasRefund: boolean;
  newDocumentCount: number;
  /** The chosen refund method. Only consulted when `hasRefund`. */
  refundMethod?: 'card' | 'check' | '';
}): AddendumOfflineBlock | null => {
  if (opts.online) return null;
  // ⚠️ A CHEQUE refund is queueable (Phase 3); a card one is not. The old blanket refund block
  // refused both, which cost the rep a sale they could legitimately have closed.
  if (opts.hasRefund && !refundMethodAvailableOffline(opts.refundMethod || '')) {
    return { ...REFUND_BLOCK, message: CARD_REFUND_OFFLINE_MSG };
  }
  if (opts.newDocumentCount > 0) return DOCUMENT_BLOCK;
  return null;
};

/** Can this addendum be queued as-is? The inverse of the block, for a button's enabled state. */
export const canQueueAddendum = (opts: {
  online: boolean;
  hasRefund: boolean;
  newDocumentCount: number;
  refundMethod?: 'card' | 'check' | '';
}): boolean => !opts.online && addendumOfflineBlock(opts) === null;

/**
 * Does this addendum release to the homeowner from the device, or wait for an approver?
 *
 * ⚠️ THE highest-consequence rule in this feature. A refund addendum released early puts the
 * paperwork in front of the homeowner before the approval; if they sign first, the refund
 * machine refuses `pendingApproval -> customerSigned` with a bare return and the signature is
 * silently dropped. The money never moves, and nothing anywhere reports it.
 *
 * Mirrors the online guard `if (draftId && !refundRaised)`.
 */
export const releasesToCustomer = (hasRefund: boolean): boolean => !hasRefund;
