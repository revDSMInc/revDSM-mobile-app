export function isZeroAllowedNumberField(field: any): boolean {
  if (!field || field.type !== 'number') return false;
  const hay = `${field.key || ''} ${field.label || field.title || ''}`.toLowerCase();
  return /miter/.test(hay) || /end\s*-?\s*cap/.test(hay);
}

export function isRequiredNumberValueMissing(value: any) {
  return value === undefined || value === null || value === '' || value === 0 || value === '0';
}

export function isRequiredFieldValueMissing(field: any, value: any) {
  if (field?.type === 'number') {
    if (isZeroAllowedNumberField(field)) {
      return value === undefined || value === null || value === '';
    }
    return isRequiredNumberValueMissing(value);
  }
  return value === undefined || value === null || value === '';
}
