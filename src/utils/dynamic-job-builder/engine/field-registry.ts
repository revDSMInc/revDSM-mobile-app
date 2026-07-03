import { createDefaultAllocationMetrics, DEFAULT_ALLOCATION_STATUS_MESSAGES } from './allocation-config-utils';
import { createDefaultLocationGridConfig } from './location-grid-utils';
import { createDefaultRoomOptions } from './room-picker-utils';

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

export function resolveFieldComponent(fieldType: string) {
  const map: Record<string, string> = {
    toggle: 'ToggleGroup',
    optionList: 'OptionList',
    dropdown: 'Dropdown',
    swatch: 'SwatchPicker',
    colorSelection: 'SwatchPicker',
    text: 'TextField',
    number: 'InputField',
    locationGrid: 'LocationGrid',
    roomPicker: 'RoomPicker',
    sectionLabel: 'SectionLabel',
    combinationSummary: 'GrandTotalCard',
    textarea: 'TextareaField',
    stack: 'Stack',
    accordion: 'AccordionSection',
    locked: 'LockedField',
    lockedWithColor: 'LockedFieldWithColor',
    allocation: 'AllocatorBar',
  };
  return map[fieldType] || 'InputField';
}
