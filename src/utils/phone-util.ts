/**
 * Formats a string into a US Phone Number format: +1 (XXX) XXX-XXXX
 * Handles stripping non-digits and enforcing the +1 prefix.
 */
export const formatUSPhoneNumber = (text: string): string => {
  // Strip all non-numeric characters
  const cleaned = text.replace(/\D/g, '');

  // If empty, return empty
  if (!cleaned) return '';

  // Handle leading '1' - if it's there, we keep it as the US prefix
  let digits = cleaned;
  if (cleaned.startsWith('1')) {
    digits = cleaned.substring(1);
  }

  // Limit to 10 digits
  const truncated = digits.substring(0, 10);

  // Re-format: +1 (XXX) XXX-XXXX
  const length = truncated.length;

  let formatted = '+1 ';

  if (length === 0) {
    return '+1 ';
  }

  // Area code (XXX)
  if (length <= 3) {
    formatted += `(${truncated}`;
  } else if (length <= 6) {
    formatted += `(${truncated.substring(0, 3)}) ${truncated.substring(3)}`;
  } else {
    formatted += `(${truncated.substring(0, 3)}) ${truncated.substring(3, 6)}-${truncated.substring(
      6
    )}`;
  }

  return formatted;
};

/**
 * The local 10-digit part only, as `XXX-XXX-XXXX` (e.g. `443-878-4937`).
 *
 * For inputs that already render their own static `+1` prefix, so the country code
 * must NOT be repeated in the value. Differs from `formatUSPhoneNumber` above, which
 * emits `+1 (XXX) XXX-XXXX` for standalone fields.
 *
 * A pasted number carrying a country code (`+1 443-878-4937`, `14438784937`) yields
 * more than 10 digits — take the LAST 10 rather than stripping a leading `1`, so a
 * partially-typed number is never mangled mid-entry.
 */
export const formatLocalUSPhone = (text: string): string => {
  const digits = String(text || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (!local) return '';
  if (local.length <= 3) return local;
  if (local.length <= 6) return `${local.slice(0, 3)}-${local.slice(3)}`;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
};

/**
 * Normalize any US phone input — formatted, raw, or already `+1`-prefixed — to E.164
 * (`+1XXXXXXXXXX`) for the API. The app is US-only, so `+1` is always the country code.
 * Returns '' for empty input so callers can skip sending a blank number.
 */
export const toE164USPhone = (text: string): string => {
  const digits = String(text || '').replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return `+1${local}`;
};

/**
 * Strips formatting to get the raw digits for API submission.
 * Usually includes the '1' prefix.
 */
export const getRawPhoneNumber = (formattedText: string): string => {
  const cleaned = formattedText.replace(/\D/g, '');
  if (!cleaned.startsWith('1') && cleaned.length > 0) {
    return '1' + cleaned;
  }
  return cleaned;
};
