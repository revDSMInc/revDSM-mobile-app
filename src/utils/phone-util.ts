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
