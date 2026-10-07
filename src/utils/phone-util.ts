export const formatUSPhoneNumber = (text: string): string => {
  const cleaned = text.replace(/\D/g, '');

  if (!cleaned) return '';

  let digits = cleaned;
  if (cleaned.startsWith('1')) {
    digits = cleaned.substring(1);
  }

  const truncated = digits.substring(0, 10);

  const length = truncated.length;

  let formatted = '+1 ';

  if (length === 0) {
    return '+1 ';
  }

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

export const formatLocalUSPhone = (text: string): string => {
  const digits = String(text || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (!local) return '';
  if (local.length <= 3) return local;
  if (local.length <= 6) return `${local.slice(0, 3)}-${local.slice(3)}`;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
};

export const toE164USPhone = (text: string): string => {
  const digits = String(text || '').replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return `+1${local}`;
};

export const getRawPhoneNumber = (formattedText: string): string => {
  const cleaned = formattedText.replace(/\D/g, '');
  if (!cleaned.startsWith('1') && cleaned.length > 0) {
    return '1' + cleaned;
  }
  return cleaned;
};
