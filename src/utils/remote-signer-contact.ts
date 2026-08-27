/**
 * Validation for the "Send Agreement Remotely" sheet's recipient fields.
 *
 * Pure and RN-free on purpose, for the same reason `utils/addendum-recipients.ts` and
 * `utils/inspection-photos.ts` exist: `AgreementRemoteSignModal` pulls in React Native
 * and cannot be loaded under jest here — and these rules feed THREE surfaces of that
 * sheet (the compose fields, the Send button's gate, and the pending panel's inline
 * editor). If they drifted, the button and the field below it would disagree about
 * whether the same recipient is reachable.
 *
 * ⚠️ TEN digits, not the ELEVEN Add New Lead and Edit Customer count. Those format
 * through `formatUSPhoneNumber`, which emits its own `+1 ` prefix, so a complete value
 * strips to 11. These fields render a STATIC `+1` label beside the input and hold the
 * LOCAL part only, so counting 11 here would reject every valid number.
 */
import { validateEmail } from './validation';

export interface SignerContact {
  phone?: string;
  email?: string;
}

/** Bare local digits — strip formatting, then a leading US `1`. Mirrors the modal's
 *  own `digitsOnly`, which is what actually goes on the wire. */
export const signerPhoneDigits = (value: any): string =>
  String(value ?? '')
    .replace(/[^0-9]/g, '')
    .replace(/^1/, '')
    .slice(-10);

/**
 * ⚠️ An EMPTY phone is VALID here. A signer needs a phone OR an email, not both, so
 * a blank field is how the rep chooses to reach them by email — only a PARTIAL number
 * is rejected. "At least one channel" is a separate rule (`signerContactError`).
 */
export const signerPhoneError = (value: any): string => {
  const digits = signerPhoneDigits(value);
  if (!digits) return '';
  return digits.length === 10 ? '' : 'Enter a complete 10-digit phone number.';
};

/** Same rule for email: empty is valid, malformed is not. */
export const signerEmailError = (value: any): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return validateEmail(trimmed) ? '' : 'Enter a valid email address.';
};

/** A signer is reachable when at least one channel carries something. */
export const signerHasContact = (s: SignerContact): boolean =>
  signerPhoneDigits(s?.phone).length > 0 || String(s?.email ?? '').trim().length > 0;

/**
 * The one message that blocks this signer, or `''`.
 *
 * Order matters: "no contact at all" outranks a format complaint, because a signer with
 * neither field filled has nothing to correct in either one.
 */
export const signerContactError = (s: SignerContact): string => {
  if (!signerHasContact(s)) return 'Add a phone or email to send this signer a link.';
  return signerPhoneError(s?.phone) || signerEmailError(s?.email);
};

/** The Send button's gate — every signer reachable AND every filled field well-formed. */
export const canSendToSigners = (signers: SignerContact[]): boolean =>
  Array.isArray(signers) && signers.length > 0 && signers.every((s) => !signerContactError(s));

/**
 * The pending panel's inline editor, which edits ONE channel at a time.
 *
 * ⚠️ Here an EMPTY value IS an error, unlike the compose fields above: the editor
 * saves and RESENDS in one action, so it is always answering "where do we send this?"
 * — and that was already the existing behaviour, which only ever checked emptiness.
 */
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
