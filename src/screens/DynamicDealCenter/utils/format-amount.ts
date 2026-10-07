export function formatAmountInput(raw: string): string {
  const value = String(raw ?? '');
  if (!value) return '';
  const [intPart, ...rest] = value.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest.length ? `${grouped}.${rest.join('.')}` : grouped;
}

export function stripAmount(text: string): string {
  return String(text ?? '').replace(/[^0-9.]/g, '');
}
