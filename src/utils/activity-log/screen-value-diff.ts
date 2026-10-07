export interface ScreenValue {
  label: string;
  value: unknown;
  meta?: Record<string, unknown> | ((from: string, to: string) => Record<string, unknown>);
}

export type ScreenValues = Record<string, ScreenValue>;

export interface ScreenValueChange {
  fieldName: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  meta?: Record<string, unknown>;
}

const coerce = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function snapshotScreenValues(values: ScreenValues | null | undefined): Record<string, string> {
  const snapshot: Record<string, string> = {};
  Object.entries(values || {}).forEach(([fieldName, entry]) => {
    snapshot[fieldName] = coerce(entry?.value);
  });
  return snapshot;
}

export function diffScreenValues(
  prev: Record<string, string> | null | undefined,
  values: ScreenValues | null | undefined
): ScreenValueChange[] {
  if (!prev || !values) return [];

  const next = snapshotScreenValues(values);
  const changes: ScreenValueChange[] = [];

  Object.keys({ ...prev, ...next }).forEach((fieldName) => {
    const oldValue = prev[fieldName] ?? '';
    const newValue = next[fieldName] ?? '';
    if (oldValue === newValue) return;

    const entry = values[fieldName];
    const meta = typeof entry?.meta === 'function' ? entry.meta(oldValue, newValue) : entry?.meta;

    changes.push({
      fieldName,
      fieldLabel: entry?.label || fieldName,
      oldValue,
      newValue,
      ...(meta ? { meta } : {}),
    });
  });

  return changes;
}
