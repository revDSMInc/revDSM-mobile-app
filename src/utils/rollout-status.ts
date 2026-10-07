export const isPlaceholderCalculatorTitle = (title?: string | null): boolean =>
  /^\d+$/.test(String(title ?? '').trim());

export const rolloutCalculators = <T extends { title?: string | null }>(calculators: T[]): T[] =>
  (calculators || []).filter((c) => !!c && !isPlaceholderCalculatorTitle(c.title));

export const allRolloutsConfirmed = <
  T extends { title?: string | null; isRolloutConfirmed?: boolean }
>(
  calculators: T[]
): boolean => {
  const confirmable = rolloutCalculators(calculators || []);
  return confirmable.length > 0 && confirmable.every((c) => !!c.isRolloutConfirmed);
};
