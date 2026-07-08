import { createDefaultField } from './field-types';

export function createEmptyVertical(overrides: any = {}) {
  return {
    id: `vertical_${Date.now()}`,
    label: 'New Vertical',
    icon: '🏠',
    color: '#22c55e',
    tabs: [],
    ...overrides,
  };
}

export function createEmptyTab(overrides: any = {}) {
  return {
    id: `tab_${Date.now()}`,
    label: 'New Tab',
    lockedByDefault: false,
    sections: [],
    combinationGroups: [],
    combinations: {
      enabled: false,
      defaultItem: { color: '', grid: {} },
      fields: [],
    },
    fields: [],
    ...overrides,
  };
}

export function createBlankJobBuilderConfig() {
  return {
    name: '',
    description: '',
    status: 'draft',
    verticals: [],
  };
}

// NOTE: createDefaultJobBuilderConfig() (a hardcoded gutter/roofline template)
// was removed as part of "remove mocks entirely" — the Dynamic Job Builder now
// renders only real backend config. createEmptyVertical/createEmptyTab remain for
// the in-app config builder (add vertical / add tab actions).

export { createDefaultField };
