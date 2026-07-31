/**
 * Description Schema Evaluation Engine (generic, config-driven)
 *
 * Faithful RN port of web
 * `src/components/dynamic-job-builder/agreement/description-schema-evaluator.js`.
 * Turns a saved description schema (authored per-vertical in the portal Agreement
 * Config module) into an ordered list of "Description of Work" lines, evaluated
 * against the dynamic job builder's runtime `verticalState`.
 *
 * Keep in sync with the web copy — the two must produce identical output.
 *
 * Schema shape (see backend DescriptionSchemaEntity):
 *   - calculatedLogic[]:  { variableName, formula: { type:'sum', fields:[fieldId] } }
 *   - primaryMappings[]:  { component, scope:'simple'|'combination', sectionId,
 *                          condition:{ type:'all'|'any', rules:[{fieldId,operator,value}] },
 *                          logicTriggerId, logicTriggerCondition, valueReferenceId, outputTemplate }
 *   - conditionalDescriptions[]: { name, condition, outputDescription }
 *
 * Runtime lookup paths (per the dynamic job builder):
 *   simple section:      verticalState[tabId].sectionFields[sectionId][fieldId]
 *   combination row:     verticalState[tabId].comboGroups[sectionId].combinations[n][fieldId]
 *   section-scoped:      verticalState[tabId].comboGroups[sectionId].sectionState[fieldId]
 *   grid/locationGrid:   ...[gridFieldId][rowKey][colKey]  (object of objects → summed)
 *   swatch/color:        value at [fieldId] is the color name string
 */

// ----------------------------------------------------------------------
// value coercion helpers

function parseNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const n = Number(String(val).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function isPlainObject(val: any): boolean {
  return val && typeof val === 'object' && !Array.isArray(val);
}

/** A grid value is an object whose values are themselves objects ({ row: { col: n } }). */
function isGridValue(val: any): boolean {
  return isPlainObject(val) && Object.values(val).some((v) => isPlainObject(v));
}

function sumGrid(grid: any): number {
  let total = 0;
  Object.values(grid).forEach((row: any) => {
    if (isPlainObject(row)) {
      Object.values(row).forEach((v) => {
        total += parseNum(v);
      });
    } else {
      total += parseNum(row);
    }
  });
  return total;
}

function isAffirmative(value: any): boolean {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === 'on' || normalized === '1';
}

function looksNumeric(value: any): boolean {
  if (typeof value === 'number') return true;
  const s = String(value ?? '').trim();
  return s !== '' && /^-?\d*\.?\d+/.test(s.replace(/[^\d.-]/g, '')) && /\d/.test(s);
}

// ----------------------------------------------------------------------
// reading values out of a "scope" (a sectionFields[secId] map, a combo, or sectionState)

function readScopeValue(scopeObj: any, fieldId: string): any {
  if (!isPlainObject(scopeObj)) return undefined;
  if (scopeObj[fieldId] !== undefined) return scopeObj[fieldId];
  if (isPlainObject(scopeObj.colorValues) && scopeObj.colorValues[fieldId] !== undefined) {
    return scopeObj.colorValues[fieldId];
  }
  return undefined;
}

/**
 * Collect a field's value across the entire verticalState.
 * Returns { number, text, found } — number aggregates numeric occurrences (grids summed);
 * text is the first non-empty scalar (used for merges / string comparisons).
 */
function collectField(fieldId: string, verticalState: any): { number: number; text: string; found: boolean } {
  let number = 0;
  let text = '';
  let found = false;

  const consider = (raw: any) => {
    if (raw === undefined || raw === null || raw === '') return;
    if (isGridValue(raw)) {
      number += sumGrid(raw);
      found = true;
      return;
    }
    if (isPlainObject(raw)) return;
    found = true;
    if (looksNumeric(raw)) number += parseNum(raw);
    if (!text) text = String(raw);
  };

  if (isPlainObject(verticalState)) {
    Object.values(verticalState).forEach((tabState: any) => {
      if (!isPlainObject(tabState)) return;
      if (isPlainObject(tabState.sectionFields)) {
        Object.values(tabState.sectionFields).forEach((sec) => consider(readScopeValue(sec, fieldId)));
      }
      if (isPlainObject(tabState.comboGroups)) {
        Object.values(tabState.comboGroups).forEach((group: any) => {
          if (isPlainObject(group?.sectionState)) consider(readScopeValue(group.sectionState, fieldId));
          (group?.combinations || []).forEach((combo: any) => consider(readScopeValue(combo, fieldId)));
        });
      }
      (tabState.combinations || []).forEach((combo: any) => consider(readScopeValue(combo, fieldId)));
      if (isPlainObject(tabState.colorValues) && tabState.colorValues[fieldId] !== undefined) {
        consider(tabState.colorValues[fieldId]);
      }
      if (tabState[fieldId] !== undefined) consider(tabState[fieldId]);
    });
  }

  return { number, text, found };
}

/** Find the combination group (with its combinations[]) for a sectionId anywhere in verticalState. */
function findComboGroup(sectionId: string, verticalState: any): any {
  if (!sectionId || !isPlainObject(verticalState)) return null;
  for (const tabState of Object.values(verticalState) as any[]) {
    if (isPlainObject(tabState?.comboGroups) && tabState.comboGroups[sectionId]) {
      return tabState.comboGroups[sectionId];
    }
  }
  return null;
}

/** Find a simple section's field map (sectionFields[sectionId]) anywhere in verticalState. */
function findSimpleSection(sectionId: string, verticalState: any): any {
  if (!sectionId || !isPlainObject(verticalState)) return null;
  for (const tabState of Object.values(verticalState) as any[]) {
    if (isPlainObject(tabState?.sectionFields) && tabState.sectionFields[sectionId]) {
      return tabState.sectionFields[sectionId];
    }
    // section-scoped combination header fields live under comboGroups[sectionId].sectionState
    if (isPlainObject(tabState?.comboGroups?.[sectionId]?.sectionState)) {
      return tabState.comboGroups[sectionId].sectionState;
    }
  }
  return null;
}

/** Active location labels of a grid value ({ row: { col: n } }) — rows whose total > 0. */
function gridLocations(grid: any): string {
  if (!isGridValue(grid)) return '';
  return Object.entries(grid)
    .filter(([, row]: [string, any]) =>
      isPlainObject(row) ? Object.values(row).some((v) => parseNum(v) > 0) : parseNum(row) > 0
    )
    .map(([rowKey]) => rowKey)
    .join(', ');
}

// ----------------------------------------------------------------------
// evaluation context

function createContext(schema: any, verticalState: any) {
  const vars: Record<string, any> = {};
  const cache = new Map<string, any>();

  const collect = (fieldId: string) => {
    if (cache.has(fieldId)) return cache.get(fieldId);
    const res = collectField(fieldId, verticalState);
    cache.set(fieldId, res);
    return res;
  };

  // Pre-compute calculatedLogic variables (currently only 'sum').
  (schema?.calculatedLogic || []).forEach((calc: any) => {
    if (!calc?.variableName) return;
    if (calc.formula?.type === 'sum') {
      const total = (calc.formula.fields || []).reduce((acc: number, fid: string) => acc + collect(fid).number, 0);
      vars[calc.variableName] = total;
    }
  });

  const getNumber = (ref: string, scope: any): number => {
    if (vars[ref] !== undefined) return vars[ref];
    if (scope && scope[ref] !== undefined) {
      const v = scope[ref];
      return isGridValue(v) ? sumGrid(v) : parseNum(v);
    }
    return collect(ref).number;
  };

  const getText = (ref: string, scope: any): string => {
    if (vars[ref] !== undefined) return String(vars[ref]);
    if (scope) {
      const v = readScopeValue(scope, ref);
      if (v !== undefined && v !== null && v !== '' && !isPlainObject(v)) return String(v);
    }
    return collect(ref).text;
  };

  const getRaw = (ref: string, scope: any): any => {
    if (vars[ref] !== undefined) return vars[ref];
    if (scope) {
      const v = readScopeValue(scope, ref);
      if (v !== undefined) return v;
    }
    const res = collect(ref);
    return res.found ? (res.text !== '' ? res.text : res.number) : undefined;
  };

  return { vars, getNumber, getText, getRaw };
}

// ----------------------------------------------------------------------
// condition evaluation

function evaluateRule(rule: any, ctx: any, scope: any): boolean {
  if (!rule || !rule.fieldId) return false;
  const { fieldId, operator, value } = rule;
  const num = ctx.getNumber(fieldId, scope);
  const raw = ctx.getRaw(fieldId, scope);

  switch (operator) {
    case '>':
      return num > parseNum(value);
    case '>=':
      return num >= parseNum(value);
    case '<':
      return num < parseNum(value);
    case '<=':
      return num <= parseNum(value);
    case 'isNotEmpty':
    case 'exists':
      return (raw !== undefined && String(raw).trim() !== '') || num !== 0;
    case 'isEmpty':
      return !((raw !== undefined && String(raw).trim() !== '') || num !== 0);
    case '!=':
      return !equals(raw, num, value);
    case '==':
    default:
      return equals(raw, num, value);
  }
}

function equals(raw: any, num: number, value: any): boolean {
  if (typeof value === 'boolean') return isAffirmative(raw) === value;
  if (looksNumeric(value)) return num === parseNum(value);
  return String(raw ?? '').trim().toLowerCase() === String(value ?? '').trim().toLowerCase();
}

function evaluateCondition(condition: any, ctx: any, scope: any): boolean {
  if (!condition || !Array.isArray(condition.rules) || condition.rules.length === 0) return true;
  const type = condition.type === 'any' ? 'any' : 'all';
  return type === 'any'
    ? condition.rules.some((r: any) => evaluateRule(r, ctx, scope))
    : condition.rules.every((r: any) => evaluateRule(r, ctx, scope));
}

/** Legacy single-trigger form: logicTriggerId + logicTriggerCondition. */
function evaluateTrigger(mapping: any, ctx: any, scope: any): boolean {
  if (!mapping.logicTriggerId) return true;
  const cond = mapping.logicTriggerCondition || {};
  return evaluateRule(
    { fieldId: mapping.logicTriggerId, operator: cond.operator || '>', value: cond.value ?? 0 },
    ctx,
    scope
  );
}

function mappingPasses(mapping: any, ctx: any, scope: any): boolean {
  if (mapping.condition && Array.isArray(mapping.condition.rules) && mapping.condition.rules.length) {
    return evaluateCondition(mapping.condition, ctx, scope);
  }
  return evaluateTrigger(mapping, ctx, scope);
}

// ----------------------------------------------------------------------
// template merge

function formatValue(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return String(v);
  return String(v);
}

function substitute(template: string, mapping: any, ctx: any, scope: any): string {
  if (!template) return '';
  return template.replace(/\[([^\]]+)\]/g, (_: string, token: string) => {
    const key = String(token).trim();
    if (key === 'Value') {
      const ref = mapping.valueReferenceId;
      if (!ref) return '';
      const num = ctx.getNumber(ref, scope);
      const text = ctx.getText(ref, scope);
      return formatValue(text !== '' && !looksNumeric(text) ? text : num);
    }
    // [loc:FIELDID] → active grid location labels for that field in the current scope
    if (key.startsWith('loc:')) {
      const fid = key.slice(4).trim();
      const raw = scope ? readScopeValue(scope, fid) : undefined;
      return gridLocations(raw);
    }
    if (ctx.vars[key] !== undefined) return formatValue(ctx.vars[key]);
    // treat as a field id — prefer text (color/type), fall back to number
    const text = ctx.getText(key, scope);
    if (text !== '') return text;
    const num = ctx.getNumber(key, scope);
    return num ? formatValue(num) : '';
  });
}

// ----------------------------------------------------------------------
// main

export function evaluateDescriptionSchema(schema: any, jobState: any, verticalState: any): string[] {
  // jobState kept for signature compatibility; evaluation uses verticalState.
  const state = verticalState || jobState || {};
  if (!schema) return [];

  const ctx = createContext(schema, state);
  const lines: string[] = [];

  (schema.primaryMappings || []).forEach((mapping: any) => {
    if (!mapping) return;

    if (mapping.scope === 'combination') {
      const group = findComboGroup(mapping.sectionId, state);
      const combos = group?.combinations || [];
      combos.forEach((combo: any) => {
        if (mappingPasses(mapping, ctx, combo)) {
          const line = substitute(mapping.outputTemplate, mapping, ctx, combo).trim();
          if (line) lines.push(line);
        }
      });
      return;
    }

    const scopeObj = mapping.sectionId ? findSimpleSection(mapping.sectionId, state) : null;
    if (mappingPasses(mapping, ctx, scopeObj)) {
      const line = substitute(mapping.outputTemplate, mapping, ctx, scopeObj).trim();
      if (line) lines.push(line);
    }
  });

  (schema.conditionalDescriptions || []).forEach((cond: any) => {
    if (!cond) return;
    if (evaluateCondition(cond.condition, ctx, null)) {
      const line = substitute(cond.outputDescription, {}, ctx, null).trim();
      if (line) lines.push(line);
    }
  });

  return lines;
}

export default evaluateDescriptionSchema;
