import { createDefaultField } from './field-types';
import { migrateConfigTabFields } from '../engine/combination-utils';

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

export function createDefaultJobBuilderConfig() {
  return migrateConfigTabFields({
    name: 'Gutters / Roofline — Standard',
    description: 'Default gutter and roofline job builder template',
    status: 'active',
    verticals: [
      {
        id: 'gutters-roofline',
        label: 'Gutters / Roofline',
        icon: '🏠',
        color: '#22c55e',
        tabs: [
          {
            id: 'gutter',
            label: 'Gutter',
            lockedByDefault: false,
            combinations: {
              enabled: true,
              defaultItem: { color: '', grid: {}, partial: '', mitersOut: '', mitersIn: '', endCapsR: '', endCapsL: '' },
              fields: [
                { id: 'g_alloc', type: 'allocation', label: '6" K-Style Gutter', key: '_alloc_gutter', avail: 200, unit: 'ft' },
                { id: 'g_partial', type: 'toggle', label: 'Gutter Partial?', key: 'partial', options: ['Yes', 'No'] },
                { id: 'g_color', type: 'swatch', label: 'Color', key: 'color', palette: 'gutter' },
                { id: 'g_grid', type: 'locationGrid', label: 'Measurements', key: 'grid', singleStory: false },
                { id: 'g_sec', type: 'sectionLabel', title: 'Miters & End Caps', key: '_miters' },
                { id: 'g_mo', type: 'number', label: '# of Miters (Outside)', key: 'mitersOut', placeholder: '# of Miters (Outside)' },
                { id: 'g_mi', type: 'number', label: '# of Miters (Inside)', key: 'mitersIn', placeholder: '# of Miters (Inside)' },
                { id: 'g_ecr', type: 'number', label: '# End Caps (Rights)', key: 'endCapsR', placeholder: '# End Caps (Rights)' },
                { id: 'g_ecl', type: 'number', label: '# End Caps (Lefts)', key: 'endCapsL', placeholder: '# End Caps (Lefts)' },
              ],
            },
            fields: [
              {
                id: 'g_size',
                type: 'text',
                label: 'Gutter Size',
                key: 'gutterSize',
                locked: true,
                dcField: 'gutterProduct',
                defaultValue: '6" K-Style Gutter',
              },
            ],
          },
          {
            id: 'guard',
            label: 'Guard',
            lockedByDefault: false,
            combinations: {
              enabled: true,
              defaultItem: { color: '', grid: {}, profile: 'K-Style' },
              fields: [
                { id: 'lf_alloc', type: 'allocation', label: '6" Micro Mesh Guard', key: '_alloc_guard', avail: 200, unit: 'ft' },
                { id: 'lf_profile', type: 'toggle', label: 'Existing Gutter Profile', key: 'profile', options: ['K-Style', 'Half-Round', 'Fascia'] },
                { id: 'lf_color', type: 'swatch', label: 'Guard Color', key: 'color', palette: 'gutter' },
                { id: 'lf_grid', type: 'locationGrid', label: 'Guard Measurements', key: 'grid', singleStory: false },
              ],
            },
            fields: [
              { id: 'lf_size', type: 'text', label: 'Gutter Opening Width', key: 'size', locked: true, defaultValue: '6"' },
              { id: 'lf_prof', type: 'text', label: 'Guard Profile', key: 'guardProfile', locked: true, defaultValue: 'Micro Mesh' },
            ],
          },
          {
            id: 'soffit',
            label: 'Soffit',
            lockedByDefault: false,
            combinations: { enabled: false, defaultItem: {}, fields: [] },
            fields: [
              { id: 'so_type', type: 'toggle', label: 'Type', key: 'type', options: ['Partial', 'Full'] },
              { id: 'so_foot', type: 'number', label: 'Vinyl Soffit Footage', key: 'footage', locked: true, dcField: 'vinylSoffit', defaultValue: 200 },
              { id: 'so_stype', type: 'toggle', label: 'Soffit Type', key: 'soffitType', options: ['Hidden Vent Vinyl', 'Pinhole Vinyl'] },
              { id: 'so_color', type: 'swatch', label: 'Soffit Color', key: 'color', palette: 'gutter' },
            ],
          },
          {
            id: 'fascia',
            label: 'Fascia',
            lockedByDefault: false,
            combinations: { enabled: false, defaultItem: {}, fields: [] },
            fields: [
              { id: 'fa_wrap_type', type: 'toggle', label: 'Wrap Type', key: 'wrapType', options: ['Partial', 'Full'] },
              { id: 'fa_wrap_ft', type: 'number', label: 'Fascia Wrap Footage', key: 'wrapFootage', locked: true, dcField: 'fasciaWrap', defaultValue: 200 },
              { id: 'fa_wrap_color', type: 'swatch', label: 'Wrap Color', key: 'wrapColor', palette: 'gutter' },
            ],
          },
          {
            id: 'misc',
            label: 'Misc',
            lockedByDefault: false,
            combinations: { enabled: false, defaultItem: {}, fields: [] },
            fields: [
              { id: 'mi_labor', type: 'number', label: 'Extra Labor', key: 'extraLabor', locked: true, dcField: 'extraLabor', defaultValue: 0 },
              { id: 'mi_reason', type: 'textarea', label: 'Why is there additional labor?', key: 'reason', rows: 3, placeholder: 'Enter reason...', required: true },
            ],
          },
          {
            id: 'summary',
            label: 'Summary',
            lockedByDefault: false,
            combinations: { enabled: false, defaultItem: {}, fields: [] },
            fields: [],
            isSummary: true,
          },
        ],
      },
    ],
  });
}

export { createDefaultField };
