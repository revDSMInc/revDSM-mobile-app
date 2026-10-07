export function scopeSignature(entries: Record<string, any> = {}): string {
  return Object.entries(entries)
    .filter(([, e]) => Number(e?.inputValue) > 0)
    .map(([id, e]) => `${id}:${Number(e.inputValue)}`)
    .sort()
    .join('|');
}

export function hasEnteredScope(entries: Record<string, any> = {}): boolean {
  return scopeSignature(entries) !== '';
}
