/**
 * Rules for the "How would <homeowner> like a copy of the signed agreement?" prompt
 * (REVUIUX-391). Pure and RN-free so it can be unit-tested under jest — the prompt
 * component itself imports React Native and cannot be loaded there.
 *
 * The answer is stored ON THE LEAD (`PUT /pdf-reports/v1/agreement/:leadId/delivery-preference`)
 * and the backend reads it at send time from both the in-person and the remote path, so the
 * app never re-sends it at signing time.
 *
 * Field rules are the SAME ones the Send Remotely sheet uses (`utils/remote-signer-contact`),
 * so the two surfaces can never disagree about whether a number or address is deliverable.
 */
import { signerEmailError, signerPhoneDigits, signerPhoneError } from './remote-signer-contact';

/** `'text'` is what the rep sees; the server stores it as `sms`. */
export type DeliveryChannel = 'email' | 'text';

export interface DeliveryPreferenceForm {
  channel: DeliveryChannel;
  /** Local display phone, e.g. "(555) 123-4567". */
  phone: string;
  email: string;
}

/** Format the local 10-digit part as (XXX) XXX-XXXX — no `+1`, the field shows a static one. */
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
  // `both` is not offered by this screen — treat it as the email default.
  if (c === 'email' || c === 'both') return 'email';
  return null;
};

/**
 * Starting state of the prompt from the `GET …/delivery-preference` body.
 *
 * ⚠️ A stored answer wins: reopening the prompt on a second Generate Agreement must show
 * the rep's earlier correction, not the lead's original contact. `prefill` already echoes
 * the stored contacts once an answer exists, so it is always the source of the two fields.
 * `fallback` (the lead's own customerDetails) is used only when the GET failed or came back
 * empty.
 */
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

/** The one message that blocks Send for the chosen channel, or `''`. */
export const deliveryFormError = (form: DeliveryPreferenceForm): string => {
  if (form.channel === 'text') {
    if (!signerPhoneDigits(form.phone)) return 'A phone number is required to send the copy by text.';
    return signerPhoneError(form.phone);
  }
  if (!String(form.email ?? '').trim()) return 'An email address is required to send the copy by email.';
  return signerEmailError(form.email);
};

export const canSaveDelivery = (form: DeliveryPreferenceForm): boolean => !deliveryFormError(form);

/**
 * Body for the PUT. Both contacts go up whichever channel was picked — the unused one is
 * the server's fallback and costs nothing to store — BUT only when it is itself deliverable:
 * the server 400s on a partial number or a malformed address even for the channel not chosen.
 */
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

/** First name for the question; the neutral "the homeowner" when the lead has none. */
export const deliveryRecipientName = (...candidates: any[]): string => {
  for (const c of candidates) {
    const first = String(c ?? '').trim().split(/\s+/)[0];
    if (first) return first;
  }
  return 'the homeowner';
};
