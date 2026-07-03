export const DEFAULT_SUMMARY_EMPTY_MESSAGE = 'Not Selected';

export function createEmptySummaryColumn(emptyMessage = DEFAULT_SUMMARY_EMPTY_MESSAGE) {
  return {
    fieldKey: '',
    label: '',
    emptyMessage: emptyMessage || DEFAULT_SUMMARY_EMPTY_MESSAGE,
  };
}

export function normalizeSummaryColumnConfig(summaryField: any = {}) {
  const defaultEmpty = summaryField.defaultEmptyMessage || DEFAULT_SUMMARY_EMPTY_MESSAGE;
  const existing = (summaryField.summaryColumns || []).map((col: any) => ({
    fieldKey: col.fieldKey || '',
    label: col.label || '',
    emptyMessage: col.emptyMessage || defaultEmpty,
  }));

  const explicitCount = Number(summaryField.columnCount);
  if (explicitCount > 0) {
    const cols = [...existing];
    while (cols.length < explicitCount) {
      cols.push(createEmptySummaryColumn(defaultEmpty));
    }
    return cols.slice(0, explicitCount);
  }

  return existing;
}

export function usesExplicitSummaryColumns(summaryField: any = {}) {
  const count = Number(summaryField.columnCount);
  if (count > 0) return true;
  return (summaryField.summaryColumns || []).length > 0;
}

export function getEffectiveColumnCount(summaryField: any = {}) {
  const count = Number(summaryField.columnCount);
  if (count > 0) return count;
  return (summaryField.summaryColumns || []).length;
}
