import { logEvent } from '../../services/api/LoggerService';

/**
 * Client-side activity logs for the REMOTE agreement signing flow (REVDSM-263) — the
 * homeowner (and each co-buyer) e-signs on their own phone.
 *
 * The backend already records a server-side audit of the remote session, but the portal
 * timeline renders `user-activity-log` rows, so these client logs surface the rep's
 * remote-signing actions there alongside the `agreement_generated` / `agreement_signed` /
 * `agreement_uploaded` events. All use `module_type: 'job_builder'` (the module the portal
 * routes agreement rows from) and the same `fieldName`/`fieldLabel` shape as
 * `DynamicAgreementDialog`'s generate log.
 *
 * Actions (meta.action):
 *   - agreement_sent_remote            — rep sent the agreement for remote signature
 *   - agreement_remote_resent          — rep resent a signer's link
 *   - agreement_remote_recipient_updated — rep corrected a signer's phone/email + resent
 *   - agreement_remote_cancelled       — rep voided the whole remote request
 * Completion is logged as the standard `agreement_signed` (job-builder-logs.ts), NOT here.
 */

// `job_builder` (NOT 'agreement'): the portal renders agreement rows only from
// job_builder logs whose action contains 'agreement' (log-item.js routing). Using
// 'agreement' here means the portal ignores them. Every agreement log — generate,
// upload, sign, and these remote ones — is therefore `module_type: 'job_builder'`.
const MODULE = 'job_builder';

/** A recipient descriptor for the remote-send log (buyer or a co-buyer). */
export interface RemoteSignerInfo {
  /** 'Buyer' | 'Co-Buyer' (human label). */
  role?: string;
  name?: string;
  phone?: string;
  email?: string;
}

const base = (userId: string, leadId?: string, agreementId?: string) => ({
  user_id: userId,
  created_by: userId,
  module_type: MODULE,
  meta: {
    draft: true,
    ...(leadId ? { leadId } : {}),
    ...(agreementId ? { agreementId } : {}),
    fieldName: 'agreement',
    fieldLabel: 'Agreement',
  } as Record<string, any>,
});

const cleanSigner = (s: RemoteSignerInfo) => ({
  role: s.role || '',
  name: s.name || '',
  phone: s.phone || '',
  email: s.email || '',
});

/** Rep sent the agreement out for remote signature. */
export const logAgreementSentRemote = async (opts: {
  userId: string;
  leadId?: string;
  agreementId?: string;
  signers: RemoteSignerInfo[];
}) => {
  if (!opts.userId) return;
  const evt = base(opts.userId, opts.leadId, opts.agreementId);
  evt.meta.signerCount = opts.signers.length;
  evt.meta.recipients = opts.signers.map(cleanSigner);
  evt.meta.action = 'agreement_sent_remote';
  await logEvent('add', evt);
};

/** Rep resent a signer's remote-signing link (rotates their token). */
export const logAgreementRemoteResent = async (opts: {
  userId: string;
  leadId?: string;
  agreementId?: string;
  signer: RemoteSignerInfo;
}) => {
  if (!opts.userId) return;
  const evt = base(opts.userId, opts.leadId, opts.agreementId);
  evt.meta.recipient = cleanSigner(opts.signer);
  evt.meta.action = 'agreement_remote_resent';
  await logEvent('change', evt);
};

/** Rep corrected a signer's phone/email and resent the link. */
export const logAgreementRemoteRecipientUpdated = async (opts: {
  userId: string;
  leadId?: string;
  agreementId?: string;
  signer: RemoteSignerInfo;
  field: 'phone' | 'email';
  newValue: string;
}) => {
  if (!opts.userId) return;
  const evt = base(opts.userId, opts.leadId, opts.agreementId);
  evt.meta.recipient = cleanSigner(opts.signer);
  evt.meta.updatedField = opts.field;
  evt.meta.newValue = opts.newValue;
  evt.meta.action = 'agreement_remote_recipient_updated';
  await logEvent('change', evt);
};

/** Rep cancelled the whole remote request (voids every outstanding link). */
export const logAgreementRemoteCancelled = async (opts: {
  userId: string;
  leadId?: string;
  agreementId?: string;
}) => {
  if (!opts.userId) return;
  const evt = base(opts.userId, opts.leadId, opts.agreementId);
  evt.meta.action = 'agreement_remote_cancelled';
  await logEvent('change', evt);
};

// NOTE: completion is logged as the STANDARD `agreement_signed` (via
// `job-builder-logs.ts#logAgreementSigned`, signMethod:'remote') — that's the action the
// portal's Forever Record renders as the "Signed" row. A remote-specific
// `agreement_signed_remote` action would show only as a generic activity row, so it's
// not used here.
