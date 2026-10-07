import { validateEmail } from './validation';
import { toE164USPhone } from './phone-util';

export const toPhoneDigits = (value: any): string => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits.length > 10 && digits.startsWith('1') ? digits.slice(1) : digits;
};

export const formatRecipientPhone = (raw: any): string => {
  const local = toPhoneDigits(raw).slice(-10);
  if (!local) return '';
  if (local.length <= 3) return `(${local}`;
  if (local.length <= 6) return `(${local.substring(0, 3)}) ${local.substring(3)}`;
  return `(${local.substring(0, 3)}) ${local.substring(3, 6)}-${local.substring(6)}`;
};

export interface PendingAddendum {
  draftId: string;
  createdAt: string;
}

export interface PendingAddendumsSnapshot {
  leadId: string;
  pendingCount: number;
  customer: { phone: string; email: string };
  addendums: PendingAddendum[];
}

const EMPTY_SNAPSHOT: PendingAddendumsSnapshot = {
  leadId: '',
  pendingCount: 0,
  customer: { phone: '', email: '' },
  addendums: [],
};

export const normalizePendingAddendums = (source: any): PendingAddendumsSnapshot => {
  const data = source?.data?.data ?? source?.data ?? source;
  if (!data || typeof data !== 'object') return EMPTY_SNAPSHOT;

  const addendums: PendingAddendum[] = (Array.isArray(data.addendums) ? data.addendums : [])
    .map((a: any) => ({
      draftId: String(a?.draftId || a?._id || a?.id || ''),
      createdAt: String(a?.createdAt || ''),
    }))
    .filter((a: PendingAddendum) => Boolean(a.draftId));

  const rawCount = Number(data.pendingCount);
  return {
    leadId: String(data.leadId || ''),
    pendingCount: Number.isFinite(rawCount)
      ? Math.max(rawCount, addendums.length)
      : addendums.length,
    customer: {
      phone: String(data.customer?.phone || ''),
      email: String(data.customer?.email || ''),
    },
    addendums,
  };
};

export interface AddendumRecipientRow {
  draftId: string;
  number: number;
  createdAt: string;
}

export const pendingRecipientRows = (
  snapshot: PendingAddendumsSnapshot | null | undefined
): AddendumRecipientRow[] =>
  (snapshot?.addendums || []).map((a, idx) => ({
    draftId: a.draftId,
    number: idx + 1,
    createdAt: a.createdAt,
  }));

export const isSnapshotForLead = (
  snapshot: PendingAddendumsSnapshot | null | undefined,
  leadId: string
): boolean =>
  Boolean(leadId) && Boolean(snapshot?.leadId) && String(snapshot?.leadId) === String(leadId);

export const buildResendContact = (contact: {
  phone?: string;
  email?: string;
}): { customerPhone: string; customerEmail?: string } => {
  const customerPhone = toPhoneDigits(contact?.phone);
  const customerEmail = String(contact?.email || '').trim();
  return customerEmail ? { customerPhone, customerEmail } : { customerPhone };
};

export interface ResendResult {
  ok: boolean;
  failed: string[];
  sent: string[];
}

export const describeResendResult = (response: any): ResendResult => {
  const data = response?.data?.data || response?.data;
  const notifications = data?.notifications;
  if (!notifications || typeof notifications !== 'object') {
    return { ok: true, failed: [], sent: [] };
  }
  const sent: string[] = [];
  const failed: string[] = [];
  Object.keys(notifications).forEach((channel) => {
    if (String(notifications[channel]).toLowerCase() === 'sent') sent.push(channel);
    else failed.push(channel);
  });
  return { ok: failed.length === 0, failed, sent };
};

export const channelLabel = (channel: string): string => {
  const c = String(channel).toLowerCase();
  if (c === 'sms') return 'SMS';
  if (c === 'email') return 'email';
  return String(channel);
};

export const buildDraftContactPayload = (
  contact: { phone?: string; email?: string },
  patch?: { phone?: string; email?: string }
): { customerPhone: string; customerEmail: string } => ({
  customerPhone: toE164USPhone(patch?.phone ?? contact?.phone ?? ''),
  customerEmail: String(patch?.email ?? contact?.email ?? '').trim(),
});
export const readLeadPhone = (lead: any): string =>
  String(
    lead?.customerDetails?.phone ||
      lead?.customerDetails?.phoneNumber ||
      lead?.customer?.phone ||
      lead?.phone ||
      ''
  ).trim();

export const readLeadEmail = (lead: any): string =>
  String(
    lead?.customerDetails?.email ||
      lead?.customerDetails?.emailAddress ||
      lead?.customer?.email ||
      lead?.email ||
      ''
  ).trim();

export const readDraftContact = (draft: any): { phone: string; email: string } => ({
  phone: String(draft?.customerPhone || '').trim(),
  email: String(draft?.customerEmail || '').trim(),
});

export const indexDraftsById = (drafts: any[] | null | undefined): Record<string, any> => {
  const out: Record<string, any> = {};
  (Array.isArray(drafts) ? drafts : []).forEach((d) => {
    [d?.draftId, d?._id, d?.id].forEach((id) => {
      if (id) out[String(id)] = d;
    });
  });
  return out;
};

export const resolveRowContact = (
  draft: any,
  snapshotCustomer: { phone?: string; email?: string } | null | undefined,
  lead: any,
  override?: { phone?: string; email?: string }
): { phone: string; email: string } => {
  const d = readDraftContact(draft);
  return {
    phone: override?.phone ?? (d.phone || String(snapshotCustomer?.phone || '') || readLeadPhone(lead)),
    email: override?.email ?? (d.email || String(snapshotCustomer?.email || '') || readLeadEmail(lead)),
  };
};

export const recipientPhoneError = (value: string): string => {
  const digits = toPhoneDigits(value);
  if (!digits) return '';
  return digits.length === 10 ? '' : 'Enter a 10-digit number';
};

export const recipientEmailError = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return validateEmail(trimmed) ? '' : 'Enter a valid email address';
};

export const recipientEditError = (field: 'phone' | 'email', value: string): string =>
  field === 'phone' ? recipientPhoneError(value) : recipientEmailError(value);

export const normalizeContactValue = (field: 'phone' | 'email', value: string): string =>
  field === 'phone' ? toPhoneDigits(value) : String(value || '').trim();

export const resolveContactEditPatch = (
  field: 'phone' | 'email',
  value: string,
  original: string
): { phone?: string; email?: string } | null => {
  const next = normalizeContactValue(field, value);
  if (next === normalizeContactValue(field, original)) return null;
  return field === 'phone' ? { phone: next } : { email: next };
};

export const canRenderRecipientCard = (
  pendingLoading: boolean,
  draftsSettled: boolean,
  rowCount: number
): boolean => !pendingLoading && draftsSettled && rowCount > 0;

export type RecipientAction = 'ignore' | 'invalid' | 'send';

export const resolveResendAction = (
  row: { draftId?: string },
  busyDraftId: string | null
): RecipientAction => {
  if (!row?.draftId) return 'ignore';
  if (busyDraftId) return 'ignore';
  return 'send';
};

export const resolveCancelAction = (
  row: { draftId?: string },
  busyDraftId: string | null
): RecipientAction => resolveResendAction(row, busyDraftId);

export const resolveContactSaveAction = (
  draftId: string,
  field: 'phone' | 'email',
  value: string,
  original: string,
  busyDraftId: string | null
): RecipientAction => {
  if (!draftId) return 'ignore';
  if (busyDraftId) return 'ignore';
  if (recipientEditError(field, value)) return 'invalid';
  if (!resolveContactEditPatch(field, value, original)) return 'ignore';
  return 'send';
};
