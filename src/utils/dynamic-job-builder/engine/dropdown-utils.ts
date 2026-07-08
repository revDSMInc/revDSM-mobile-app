export const STRING_OPTION_FIELD_TYPES = new Set(['dropdown', 'toggle', 'optionList']);

export function hasDropdownOptionDependencies(field: any) {
  const map = field?.optionShowFields;
  if (!map || typeof map !== 'object') return false;
  return Object.values(map).some((ids) => Array.isArray(ids) && ids.length > 0);
}

export function getEffectiveDropdownOptions(field: any) {
  if (hasDropdownOptionDependencies(field)) {
    return Object.keys(field.optionShowFields || {});
  }
  return field?.options || [];
}

export function buildOptionShowFieldsFromOptions(options: string[] = [], existing: any = {}) {
  const next: Record<string, string[]> = {};
  options.forEach((option) => {
    next[option] = existing[option] || [];
  });
  return next;
}

export function syncDropdownOptionsFromDependencies(optionShowFields: any = {}) {
  return Object.keys(optionShowFields);
}

export function pruneOptionShowFields(optionShowFields: any = {}, options: string[] = []) {
  const optionSet = new Set(options);
  const next: Record<string, string[]> = {};

  Object.entries(optionShowFields || {}).forEach(([option, fieldIds]) => {
    if (optionSet.has(option)) {
      next[option] = fieldIds as string[];
    }
  });

  return next;
}

export function isVisibleByDropdownMapping(field: any, sectionFields: any[] = [], state: any = {}) {
  const dropdowns = (sectionFields || []).filter(
    (f: any) => f.type === 'dropdown' && f.key && hasDropdownOptionDependencies(f)
  );

  let isControlled = false;
  let isVisible = false;

  dropdowns.forEach((dropdown: any) => {
    const map = dropdown.optionShowFields || {};
    const matchingOptions = Object.entries(map).filter(([, fieldIds]) =>
      // Guard non-array optionShowFields values (web uses `(fieldIds || [])`);
      // an unguarded .includes on null/undefined would throw, not report incomplete.
      (Array.isArray(fieldIds) ? fieldIds : []).includes(field.id)
    );

    if (!matchingOptions.length) return;

    isControlled = true;
    const current = state[dropdown.id] || '';
    if (matchingOptions.some(([option]) => option === current)) {
      isVisible = true;
    }
  });

  if (!isControlled) return null;
  return isVisible;
}

export function collectDropdownControlledFieldIds(sectionFields: any[] = []) {
  const ids = new Set<string>();

  (sectionFields || []).forEach((field: any) => {
    if (field.type !== 'dropdown' || !field.optionShowFields) return;
    Object.values(field.optionShowFields).forEach((fieldIds) => {
      (fieldIds as string[]).forEach((id) => ids.add(id));
    });
  });

  return ids;
}
