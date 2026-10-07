export type DropdownSync = { write: false } | { write: true; value: string };

const NO_WRITE: DropdownSync = { write: false };

export function resolveDropdownSync(params: {
  options?: string[];
  value?: any;
  defaultValue?: string;
  isMulti?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
}): DropdownSync {
  const { value, defaultValue, isMulti, readOnly } = params;
  const options = Array.isArray(params.options) ? params.options : [];

  if (isMulti || readOnly) return NO_WRITE;

  if (!options.length) return NO_WRITE;

  const current = typeof value === 'string' ? value : '';

  if (current) {
    return options.includes(current) ? NO_WRITE : { write: true, value: '' };
  }

  if (defaultValue && options.includes(defaultValue)) {
    return { write: true, value: defaultValue };
  }

  return NO_WRITE;
}
