export function isRequiredNumberValueMissing(value: any) {
  return value === undefined || value === null || value === '' || value === 0 || value === '0';
}

export function isRequiredFieldValueMissing(field: any, value: any) {
  if (field?.type === 'number') {
    return isRequiredNumberValueMissing(value);
  }
  return value === undefined || value === null || value === '';
}
