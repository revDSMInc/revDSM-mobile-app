import { Field } from '../types';

export const FIELD_TYPES = [
  { id: 'allocation', label: 'Allocation Tracker', icon: 'chart-box-outline' },
  { id: 'toggle', label: 'Toggle Group', icon: 'toggle-switch' },
  { id: 'optionList', label: 'Option List', icon: 'format-list-bulleted' },
  { id: 'dropdown', label: 'Dropdown', icon: 'form-dropdown' },
  { id: 'swatch', label: 'Color', icon: 'palette' },
  { id: 'colorSelection', label: 'Color Selection', icon: 'palette-swatch' },
  { id: 'text', label: 'Text Input', icon: 'text-short' },
  { id: 'number', label: 'Number Input', icon: 'numeric' },
  { id: 'locationGrid', label: 'Location Grid', icon: 'grid' },
  { id: 'roomPicker', label: 'Room Picker', icon: 'door' },
  { id: 'sectionLabel', label: 'Section Label', icon: 'format-header-1' },
  { id: 'combinationSummary', label: 'Combination Summary', icon: 'table-pivot' },
  { id: 'textarea', label: 'Text Area', icon: 'text-box' },
  { id: 'stack', label: 'Stack', icon: 'view-agenda-outline' },
  { id: 'accordion', label: 'Accordion', icon: 'unfold-more-horizontal' },
];

export const CONTAINER_FIELD_TYPES = new Set(['stack', 'accordion']);

export function isContainerFieldType(type: string) {
  return CONTAINER_FIELD_TYPES.has(type);
}

export const LEGACY_FIELD_TYPE_LABELS: Record<string, string> = {
  locked: 'Locked Field',
  inputWithColor: 'Color',
  lockedWithColor: 'Color',
};

export function getFieldTypeLabel(type: string) {
  return FIELD_TYPES.find((t) => t.id === type)?.label || LEGACY_FIELD_TYPE_LABELS[type] || type;
}

export function isCombinationSummaryField(field: any) {
  return field?.type === 'combinationSummary';
}

export const NON_REQUIRED_FIELD_TYPES = new Set([
  'sectionLabel',
  'allocation',
  'combinationSummary',
  'stack',
  'accordion',
]);

export function supportsRequiredField(type: string) {
  return !NON_REQUIRED_FIELD_TYPES.has(type);
}

export function sanitizeFieldRequiredForSave(field: any) {
  if (!field || supportsRequiredField(field.type)) return field;
  if (field.required === undefined) return field;
  const { required, ...rest } = field;
  return rest;
}

export function uniqueFieldKey(preferred: string, existingFields: any[] = []) {
  const used = new Set((existingFields || []).map((f) => f.key).filter(Boolean));
  if (preferred && !used.has(preferred)) return preferred;

  const base = preferred || 'field';
  let attempt = `${base}_${Math.random().toString(36).slice(2, 7)}`;
  while (used.has(attempt)) {
    attempt = `${base}_${Math.random().toString(36).slice(2, 7)}`;
  }
  return attempt;
}

export function createDefaultField(type: string, existingFields: any[] = []): Field {
  const base: Field = {
    id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    key: '',
  };
  let field: Field;

  switch (type) {
    case 'toggle':
      field = {
        ...base,
        label: 'Select Option',
        options: ['Option 1', 'Option 2'],
        key: 'selection',
        required: false,
        columns: 0,
        multiSelect: false,
      };
      break;
    case 'optionList':
      field = {
        ...base,
        label: 'Select Option',
        options: ['Option 1', 'Option 2'],
        key: 'selection',
        required: false,
        columns: 1,
        multiSelect: false,
      };
      break;
    case 'dropdown':
      field = {
        ...base,
        label: 'Select Option',
        options: ['Option 1', 'Option 2'],
        placeholder: 'Select...',
        optionShowFields: {},
        key: 'selection',
        required: false,
      };
      break;
    case 'swatch':
      field = {
        ...base,
        label: 'Color',
        key: 'color',
        required: false,
        locked: false,
        dcField: '',
        defaultValue: '',
      };
      break;
    case 'colorSelection':
      field = {
        ...base,
        label: 'Color',
        key: 'color',
        required: false,
        locked: false,
        dcField: '',
        defaultValue: '',
      };
      break;
    case 'text':
      field = {
        ...base,
        label: 'Text Field',
        key: 'textValue',
        placeholder: '',
        locked: false,
        dcField: '',
        defaultValue: '',
        required: false,
      };
      break;
    case 'number':
      field = {
        ...base,
        label: 'Quantity',
        key: 'quantity',
        unit: '',
        placeholder: '0',
        locked: false,
        dcField: '',
        defaultValue: '',
        required: false,
      };
      break;
    case 'locationGrid':
      field = {
        ...base,
        label: 'Measurements',
        key: 'grid',
        singleStory: false,
        gridConfig: createDefaultLocationGridConfig(),
        required: false,
      };
      break;
    case 'roomPicker':
      field = {
        ...base,
        label: 'Room(s)',
        key: 'rooms',
        roomSet: 'rooms',
        roomOptions: createDefaultRoomOptions('rooms'),
        required: false,
      };
      break;
    case 'allocation':
      field = {
        ...base,
        label: 'Product Allocation',
        key: `_alloc_${Math.random().toString(36).slice(2, 7)}`,
        allocAvail: 0,
        allocUnit: 'ft',
      };
      break;
    case 'sectionLabel':
      field = { ...base, title: 'Section Title', key: '_section' };
      break;
    case 'combinationSummary':
      field = {
        ...base,
        label: 'GRAND TOTAL - ALL COMBINATIONS',
        key: '_summary',
        columnCount: 0,
        defaultEmptyMessage: 'Not Selected',
        summaryColumns: [],
        showFooterTotal: true,
        footerLabel: '',
        minCombinations: 1,
      };
      break;
    case 'textarea':
      field = { ...base, label: 'Notes', key: 'notes', rows: 3, placeholder: '', required: false };
      break;
    case 'stack':
      field = {
        ...base,
        label: 'Stack',
        key: '_stack',
        columns: 1,
        bordered: true,
        fields: [],
      };
      break;
    case 'accordion':
      field = {
        ...base,
        label: 'Footage Allocation Tracker',
        key: '_accordion',
        icon: 'chart-box-outline',
        defaultExpanded: true,
        columns: 2,
        fields: [],
      };
      break;
    default:
      field = { ...base, key: 'field', required: false };
  }

  const withKey = { ...field, key: uniqueFieldKey(field.key || '', existingFields) };
  if (!supportsRequiredField(type)) {
    return sanitizeFieldRequiredForSave(withKey);
  }
  return { ...withKey, required: withKey.required ?? false };
}

function createDefaultLocationGridConfig() {
  return {
    rows: [
      { key: 'front', label: 'Front' },
      { key: 'right', label: 'Right Side' },
      { key: 'rear', label: 'Rear' },
      { key: 'left', label: 'Left Side' },
    ],
    columns: [
      { key: '1st', label: '1st Story' },
      { key: '2nd', label: '2nd Story' },
    ],
    rowHeaderLabel: 'Location',
    unit: 'ft',
  };
}

function createDefaultRoomOptions(roomSet: string) {
  if (roomSet === 'bath') {
    return ['Master Bath', 'Guest Bath', 'Half Bath', 'Basement Bath', 'Other'];
  }
  return [
    'Living Room', 'Master Bedroom', 'Bedroom 2', 'Bedroom 3',
    'Hallway', 'Kitchen', 'Dining Room', 'Basement', 'Office', 'Other',
  ];
}

export function migrateLegacyColorField(field: any) {
  if (!field) return field;

  if (field.type === 'inputWithColor' || field.type === 'lockedWithColor') {
    const next: any = {
      id: field.id,
      type: 'swatch',
      label: field.label || 'Color',
      key: field.colorKey || 'color',
      productId: field.productId,
    };
    if (field.required !== undefined) next.required = field.required;
    return next;
  }

  return field;
}

function migrateFieldsList(fields: any[]) {
  return (fields || []).map(migrateLegacyColorField);
}

function migrateTabColorFields(tab: any) {
  if (!tab) return tab;

  const next = { ...tab };

  if (next.sections) {
    next.sections = next.sections.map((section: any) => ({
      ...section,
      fields: migrateFieldsList(section.fields),
    }));
  }

  if (next.fields) {
    next.fields = migrateFieldsList(next.fields);
  }

  if (next.combinations?.fields) {
    next.combinations = {
      ...next.combinations,
      fields: migrateFieldsList(next.combinations.fields),
    };
  }

  return next;
}

export function migrateConfigColorFields(config: any) {
  if (!config) return config;

  const next = { ...config };

  if (Array.isArray(next.verticals)) {
    next.verticals = next.verticals.map((vertical: any) => ({
      ...vertical,
      tabs: (vertical.tabs || []).map(migrateTabColorFields),
    }));
  }

  return next;
}
