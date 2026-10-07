import { logEvent } from '../../services/api/LoggerService';

const MODULE = 'job_builder';

export interface RemoteSignerInfo {
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
