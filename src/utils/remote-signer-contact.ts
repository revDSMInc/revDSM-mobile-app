import { validateEmail } from './validation';

export interface SignerContact {
  phone?: string;
  email?: string;
}

export const signerPhoneDigits = (value: any): string =>
  String(value ?? '')
    .replace(/[^0-9]/g, '')
    .replace(/^1/, '')
    .slice(-10);

export const signerPhoneError = (value: any): string => {
  const digits = signerPhoneDigits(value);
  if (!digits) return '';
  return digits.length === 10 ? '' : 'Enter a complete 10-digit phone number.';
};

export const signerEmailError = (value: any): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return validateEmail(trimmed) ? '' : 'Enter a valid email address.';
};

export const signerHasContact = (s: SignerContact): boolean =>
  signerPhoneDigits(s?.phone).length > 0 || String(s?.email ?? '').trim().length > 0;

export const signerContactError = (s: SignerContact): string => {
  if (!signerHasContact(s)) return 'Add a phone or email to send this signer a link.';
  return signerPhoneError(s?.phone) || signerEmailError(s?.email);
};

export const canSendToSigners = (signers: SignerContact[]): boolean =>
  Array.isArray(signers) && signers.length > 0 && signers.every((s) => !signerContactError(s));

export const signerEditError = (field: 'phone' | 'email', value: any): string => {
  if (field === 'phone') {
    const digits = signerPhoneDigits(value);
    if (!digits) return 'Enter a phone number.';
    return digits.length === 10 ? '' : 'Enter a complete 10-digit phone number.';
  }
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Enter an email address.';
  return validateEmail(trimmed) ? '' : 'Enter a valid email address.';
};
