import { signerEmailError, signerPhoneDigits, signerPhoneError } from './remote-signer-contact';

export type DeliveryChannel = 'email' | 'text';

export interface DeliveryPreferenceForm {
  channel: DeliveryChannel;
  phone: string;
  email: string;
}

export const formatDeliveryPhone = (value: any): string => {
  const digits = signerPhoneDigits(value);
  if (!digits) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const normalizeChannel = (raw: any): DeliveryChannel | null => {
  const c = String(raw ?? '').toLowerCase();
  if (c === 'sms' || c === 'text') return 'text';
  if (c === 'email' || c === 'both') return 'email';
  return null;
};

export const initialDeliveryForm = (
  body: any,
  fallback?: { phone?: any; email?: any }
): DeliveryPreferenceForm => {
  const pref = body?.preference ?? null;
  const prefill = body?.prefill ?? {};
  const phone = formatDeliveryPhone(prefill.phone ?? pref?.phone ?? fallback?.phone);
  const email = String(prefill.email ?? pref?.email ?? fallback?.email ?? '').trim();
  const stored = normalizeChannel(pref?.channel);
  const channel: DeliveryChannel = stored ?? (email || !phone ? 'email' : 'text');
  return { channel, phone, email };
};

export const deliveryFormError = (form: DeliveryPreferenceForm): string => {
  if (form.channel === 'text') {
    if (!signerPhoneDigits(form.phone)) return 'A phone number is required to send the copy by text.';
    return signerPhoneError(form.phone);
  }
  if (!String(form.email ?? '').trim()) return 'An email address is required to send the copy by email.';
  return signerEmailError(form.email);
};

export const canSaveDelivery = (form: DeliveryPreferenceForm): boolean => !deliveryFormError(form);

export const buildDeliveryPayload = (form: DeliveryPreferenceForm) => {
  const payload: { channel: DeliveryChannel; phone?: string; email?: string } = {
    channel: form.channel,
  };
  const phoneDigits = signerPhoneDigits(form.phone);
  if (phoneDigits.length === 10 && !signerPhoneError(form.phone)) payload.phone = phoneDigits;
  const email = String(form.email ?? '').trim();
  if (email && !signerEmailError(email)) payload.email = email;
  return payload;
};

export const deliveryRecipientName = (...candidates: any[]): string => {
  for (const c of candidates) {
    const first = String(c ?? '').trim().split(/\s+/)[0];
    if (first) return first;
  }
  return 'the homeowner';
};
