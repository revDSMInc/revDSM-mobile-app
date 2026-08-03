/**
 * Conditional-field dependency engine — a faithful TS port of the web deal
 * center's `field-dependency-utils.js`
 * (`src/sections/deal-center/components/utils/`).
 *
 * A schema field can carry a `conditional` that reacts to OTHER fields having a
 * value (`dependsOn`):
 *   - valueMode `highlight` → tint this field's background when the parent(s)
 *     are filled (e.g. enter "gutter DS/E = 5" → "wedges" background turns yellow).
 *   - valueMode `fixed`     → force this field to a fixed value and disable it
 *     while the parent(s) are filled.
 *
 * `formState` is a flat map keyed by BOTH field id and field name → the numeric
 * value entered (mirrors how web reads its form state).
 */

import type { CalculatorField } from '../types/calculator';

const VALUE_MODES = { userInput: 'userInput', fixed: 'fixed', highlight: 'highlight' } as const;
const MATCH_MODES = { any: 'any', all: 'all' } as const;

export const DEFAULT_HIGHLIGHT_COLOR = '#FFEB3B';

export interface NormalizedConditional {
  dependsOn: string[];
  matchMode: 'any' | 'all';
  valueMode: 'userInput' | 'fixed' | 'highlight';
  fixedValue?: string;
  highlightColor?: string;
}

function resolveFieldId(ref: string, allFields: CalculatorField[] = []): string {
  if (!ref) return '';
  const byId = allFields.find((f) => f.id === ref);
  if (byId) return byId.id;
  const byName = allFields.find((f) => f.name === ref);
  return byName?.id || ref;
}

function normalizeDependsOn(dependsOn: any, allFields: CalculatorField[] = []): string[] {
  let refs: any = dependsOn;
  if (typeof refs === 'string') refs = refs ? [refs] : [];
  if (!Array.isArray(refs)) refs = [];
  const resolved = (refs as any[]).map((ref: string) => resolveFieldId(ref, allFields)).filter(Boolean) as string[];
  return [...new Set(resolved)];
}

export function normalizeConditional(conditional: any, allFields: CalculatorField[] = []): NormalizedConditional | null {
  if (!conditional) return null;

  const dependsOn = normalizeDependsOn(conditional.dependsOn, allFields);

  let valueMode: string = conditional.valueMode || VALUE_MODES.userInput;
  let fixedValue = conditional.fixedValue ?? '';

  const behavior = conditional.behavior || {};
  if (behavior.mode === 'fixedValue' || behavior.mode === 'fixed') {
    valueMode = VALUE_MODES.fixed;
    fixedValue = behavior.fixedValue ?? behavior.value ?? fixedValue;
  }
  if (behavior.mode === 'highlight') {
    valueMode = VALUE_MODES.highlight;
  }

  if (!dependsOn.length) return null;

  const normalizedMode =
    valueMode === VALUE_MODES.fixed
      ? VALUE_MODES.fixed
      : valueMode === VALUE_MODES.highlight
        ? VALUE_MODES.highlight
        : VALUE_MODES.userInput;

  const result: NormalizedConditional = {
    dependsOn,
    matchMode: conditional.matchMode === MATCH_MODES.all ? MATCH_MODES.all : MATCH_MODES.any,
    valueMode: normalizedMode as NormalizedConditional['valueMode'],
  };

  if (normalizedMode === VALUE_MODES.fixed) {
    result.fixedValue = String(fixedValue ?? '');
  }
  if (normalizedMode === VALUE_MODES.highlight) {
    result.highlightColor = conditional.highlightColor || behavior.highlightColor || DEFAULT_HIGHLIGHT_COLOR;
  }

  return result;
}

export function getFieldConditional(field: CalculatorField, allFields: CalculatorField[] = []): NormalizedConditional | null {
  if (field?.conditional) return normalizeConditional(field.conditional, allFields);
  return null;
}

function getFieldValueFromState(field: CalculatorField, formState: Record<string, any> = {}): any {
  if (!field) return '';
  if (formState[field.id] !== undefined && formState[field.id] !== null && formState[field.id] !== '') {
    return formState[field.id];
  }
  if (field.name && formState[field.name] !== undefined && formState[field.name] !== null) {
    return formState[field.name];
  }
  return '';
}

export function parentFieldHasValue(parentField: CalculatorField, formState: Record<string, any> = {}): boolean {
  if (!parentField) return false;
  const value = getFieldValueFromState(parentField, formState);
  if (value === null || value === undefined || value === '') return false;
  const num = Number(value);
  if (!Number.isNaN(num)) return num > 0;
  return Boolean(value);
}

export function dependableFieldsSatisfied(
  conditional: NormalizedConditional | null,
  allFields: CalculatorField[] = [],
  formState: Record<string, any> = {}
): boolean {
  if (!conditional) return false;
  const parentIds = Array.isArray(conditional.dependsOn) ? conditional.dependsOn : conditional.dependsOn ? [conditional.dependsOn] : [];
  const parents = parentIds.map((id) => allFields.find((f) => f.id === id || f.name === id)).filter(Boolean) as CalculatorField[];
  if (!parents.length) return false;
  const results = parents.map((parent) => parentFieldHasValue(parent, formState));
  if (conditional.matchMode === MATCH_MODES.all) return results.every(Boolean);
  return results.some(Boolean);
}

export function resolveConditionalFieldHighlight(
  field: CalculatorField,
  formState: Record<string, any> = {},
  allFields: CalculatorField[] = []
): string | null {
  const conditional = getFieldConditional(field, allFields);
  if (!conditional || conditional.valueMode !== VALUE_MODES.highlight) return null;
  if (!dependableFieldsSatisfied(conditional, allFields, formState)) return null;
  return conditional.highlightColor || DEFAULT_HIGHLIGHT_COLOR;
}

export function isConditionalFieldFixed(
  field: CalculatorField,
  formState: Record<string, any> = {},
  allFields: CalculatorField[] = []
): boolean {
  const conditional = getFieldConditional(field, allFields);
  if (!conditional || conditional.valueMode !== VALUE_MODES.fixed) return false;
  return dependableFieldsSatisfied(conditional, allFields, formState);
}

export function resolveConditionalFixedValue(
  field: CalculatorField,
  _formState: Record<string, any> = {},
  allFields: CalculatorField[] = []
): number {
  const conditional = getFieldConditional(field, allFields);
  if (!conditional || conditional.valueMode !== VALUE_MODES.fixed) return 0;
  return Number(conditional.fixedValue ?? 0) || 0;
}
