function parseNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const n = Number(String(val).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function isPlainObject(val: any): boolean {
  return val && typeof val === 'object' && !Array.isArray(val);
}

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

/**
 * `col:FIELDID:COLUMNKEY` - ONE column of a `locationGrid`, summed across its rows (e.g. the Lighting section's `1st` / `2nd` /
 * `3rd` storey columns). The per-storey numbers exist elsewhere only as `allocation` fields, which are never persisted to state,
 * so a column ref is the only way a template can reach them.
 *
 * ⚠️ Resolved in the CONTEXT layer (`collect` / `getNumber` / `getText` / `getRaw`), NOT inside `substitute()`: that is what lets
 * one ref work in a merge token, a `condition.rules[].fieldId`, an `[IF]` expression AND a calculated variable's `fields`
 * without each growing its own parser. Keep it that way - and keep this file in step with the backend / web copies.
 */
function parseColumnRef(ref: string): { fieldId: string; column: string } | null {
  const m = /^col:(.+):([^:]+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  const fieldId = m[1].trim();
  const column = m[2].trim();
  return fieldId && column ? { fieldId, column } : null;
}

function sumColumn(grid: any, column: string): number {
  let total = 0;
  Object.values(grid).forEach((row: any) => {
    if (isPlainObject(row)) total += parseNum(row[column]);
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

function readScopeValue(scopeObj: any, fieldId: string): any {
  if (!isPlainObject(scopeObj)) return undefined;
  if (scopeObj[fieldId] !== undefined) return scopeObj[fieldId];
  if (isPlainObject(scopeObj.colorValues) && scopeObj.colorValues[fieldId] !== undefined) {
    return scopeObj.colorValues[fieldId];
  }
  return undefined;
}

function collectField(
  fieldId: string,
  verticalState: any,
  column?: string
): { number: number; text: string; found: boolean } {
  let number = 0;
  let text = '';
  let found = false;

  const consider = (raw: any) => {
    if (raw === undefined || raw === null || raw === '') return;
    // ⚠️ A column selector means nothing for a scalar: a plain number stored under the same field id is never counted as
    // "that column of it".
    if (column !== undefined) {
      if (isGridValue(raw)) {
        number += sumColumn(raw, column);
        found = true;
      }
      return;
    }
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

function findComboGroup(sectionId: string, verticalState: any): any {
  if (!sectionId || !isPlainObject(verticalState)) return null;
  for (const tabState of Object.values(verticalState) as any[]) {
    if (isPlainObject(tabState?.comboGroups) && tabState.comboGroups[sectionId]) {
      return tabState.comboGroups[sectionId];
    }
  }
  return null;
}

function findSimpleSection(sectionId: string, verticalState: any): any {
  if (!sectionId || !isPlainObject(verticalState)) return null;
  for (const tabState of Object.values(verticalState) as any[]) {
    if (isPlainObject(tabState?.sectionFields) && tabState.sectionFields[sectionId]) {
      return tabState.sectionFields[sectionId];
    }
    if (isPlainObject(tabState?.comboGroups?.[sectionId]?.sectionState)) {
      return tabState.comboGroups[sectionId].sectionState;
    }
  }
  return null;
}

function gridLocations(grid: any): string {
  if (!isGridValue(grid)) return '';
  return Object.entries(grid)
    .filter(([, row]: [string, any]) =>
      isPlainObject(row) ? Object.values(row).some((v) => parseNum(v) > 0) : parseNum(row) > 0
    )
    .map(([rowKey]) => rowKey)
    .join(', ');
}

function createContext(schema: any, verticalState: any) {
  const vars: Record<string, any> = {};
  const cache = new Map<string, any>();

  const collect = (fieldId: string) => {
    if (cache.has(fieldId)) return cache.get(fieldId);
    const col = parseColumnRef(fieldId);
    const res = col ? collectField(col.fieldId, verticalState, col.column) : collectField(fieldId, verticalState);
    cache.set(fieldId, res);
    return res;
  };

  (schema?.calculatedLogic || []).forEach((calc: any) => {
    if (!calc?.variableName) return;
    if (calc.formula?.type === 'sum') {
      const total = (calc.formula.fields || []).reduce((acc: number, fid: string) => acc + collect(fid).number, 0);
      vars[calc.variableName] = total;
    }
  });

  // ⚠️ Calculated variables are GLOBAL (precomputed once over the whole vertical state: a variable summing `col:grid:1st`
  // totals ALL combination rows), whereas a column ref used directly inside a combination-scoped line is SCOPE-AWARE and reads
  // the CURRENT row. Both are legitimate; variables were deliberately not made scope-aware so an already-shipped template
  // such as `Sum_Gutters` ("total across all rows") keeps its meaning.
  const scopedColumn = (ref: string, scope: any): number | undefined => {
    const col = parseColumnRef(ref);
    if (!col) return undefined;
    const v = scope ? readScopeValue(scope, col.fieldId) : undefined;
    return isGridValue(v) ? sumColumn(v, col.column) : collect(ref).number;
  };

  const getNumber = (ref: string, scope: any): number => {
    if (vars[ref] !== undefined) return vars[ref];
    const colNumber = scopedColumn(ref, scope);
    if (colNumber !== undefined) return colNumber;
    if (scope && scope[ref] !== undefined) {
      const v = scope[ref];
      return isGridValue(v) ? sumGrid(v) : parseNum(v);
    }
    return collect(ref).number;
  };

  const getText = (ref: string, scope: any): string => {
    if (vars[ref] !== undefined) return String(vars[ref]);
    if (parseColumnRef(ref)) return ''; // a column is a number; the merge falls through to getNumber
    if (scope) {
      const v = readScopeValue(scope, ref);
      if (v !== undefined && v !== null && v !== '' && !isPlainObject(v)) return String(v);
    }
    return collect(ref).text;
  };

  const getRaw = (ref: string, scope: any): any => {
    if (vars[ref] !== undefined) return vars[ref];
    if (parseColumnRef(ref)) {
      const col = parseColumnRef(ref)!;
      const v = scope ? readScopeValue(scope, col.fieldId) : undefined;
      if (isGridValue(v)) return sumColumn(v, col.column);
      const res = collect(ref);
      return res.found ? res.number : undefined;
    }
    if (scope) {
      const v = readScopeValue(scope, ref);
      if (v !== undefined) return v;
    }
    const res = collect(ref);
    return res.found ? (res.text !== '' ? res.text : res.number) : undefined;
  };

  return { vars, getNumber, getText, getRaw };
}

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
    case 'truthy':
      // A bare `[IF ref]`: a non-zero number, or a non-empty value that is not an explicit "no".
      return (
        num !== 0 ||
        (raw !== undefined && raw !== null && raw !== false && String(raw).trim() !== '' && !/^(0|no|false|off)$/i.test(String(raw).trim()))
      );
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

function formatValue(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return String(v);
  return String(v);
}

const IF_OPERATORS = ['>=', '<=', '==', '!=', '<>', '=', '>', '<'];
const IF_WORD_OPERATORS = ['isNotEmpty', 'isEmpty', 'exists'];

/**
 * `[IF ref op value]` -> a SchemaRule, handed to `evaluateRule` - the SAME function a line's own `condition.rules` use, so
 * "greater than 0" can never mean two different things depending on where an author wrote it.
 * `[IF Value > 0]` resolves against the line's own `valueReferenceId`, exactly as `[Value]` does.
 */
function buildIfRule(expr: string, mapping: any): any | null {
  const text = String(expr || '').trim();
  if (!text) return null;

  const wordMatch = new RegExp(`^(\\S+)\\s+(${IF_WORD_OPERATORS.join('|')})\\s*$`, 'i').exec(text);
  let ref: string;
  let operator: string;
  let value: any = '';

  if (wordMatch) {
    ref = wordMatch[1];
    operator = IF_WORD_OPERATORS.find((w) => w.toLowerCase() === wordMatch[2].toLowerCase()) as string;
  } else {
    const opMatch = /^(\S+?)\s*(>=|<=|==|!=|<>|=|>|<)\s*(.*)$/.exec(text);
    if (opMatch) {
      ref = opMatch[1];
      operator = opMatch[2] === '=' ? '==' : opMatch[2] === '<>' ? '!=' : opMatch[2];
      value = opMatch[3].trim().replace(/^(['"])(.*)\1$/, '$2');
    } else {
      ref = text;
      operator = 'truthy';
    }
  }

  if (ref === 'Value') {
    ref = mapping?.valueReferenceId || '';
    if (!ref) return null;
  }
  return { fieldId: ref, operator, value };
}

type CondToken =
  | { kind: 'text'; text: string }
  | { kind: 'if'; expr: string }
  | { kind: 'else' }
  | { kind: 'endif' };

/**
 * Resolves `[IF ..] .. [ELSE] .. [/IF]` blocks (they nest) BEFORE any `[token]` is merged, so a token inside a branch that was
 * not taken is never read.
 *
 * ⚠️ Forgiving on purpose: an unclosed `[IF]` closes at the end of the template (truncating would turn a missing `[/IF]` into a
 * silently shortened line), and a stray `[ELSE]` / `[/IF]` is DROPPED rather than printed - a raw marker on a customer's signed
 * agreement is the worse failure.
 */
function resolveConditionals(template: string, test: (expr: string) => boolean): string {
  if (!/\[\s*(IF\b|ELSE\s*\]|\/IF\s*\])/i.test(template)) return template;

  const tokens: CondToken[] = [];
  const re = /\[\s*(IF\b[^\]]*|ELSE|\/IF)\s*\]/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', text: template.slice(last, m.index) });
    const body = m[1].trim();
    if (/^IF\b/i.test(body)) tokens.push({ kind: 'if', expr: body.slice(2).trim() });
    else if (/^ELSE$/i.test(body)) tokens.push({ kind: 'else' });
    else tokens.push({ kind: 'endif' });
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ kind: 'text', text: template.slice(last) });

  let pos = 0;
  const sequence = (depth: number): string => {
    let out = '';
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.kind === 'text') {
        out += t.text;
        pos += 1;
      } else if (t.kind === 'if') {
        pos += 1;
        const take = test(t.expr);
        const thenPart = sequence(depth + 1);
        let elsePart = '';
        if (tokens[pos]?.kind === 'else') {
          pos += 1;
          elsePart = sequence(depth + 1);
          // A second [ELSE] in the same block is dropped along with what follows it.
          while (tokens[pos]?.kind === 'else') {
            pos += 1;
            sequence(depth + 1);
          }
        }
        if (tokens[pos]?.kind === 'endif') pos += 1; // missing [/IF]: closes at the end of the template
        out += take ? thenPart : elsePart;
      } else {
        // [ELSE] / [/IF]: ends the enclosing block, or is a stray one at the top level (dropped).
        if (depth > 0) return out;
        pos += 1;
      }
    }
    return out;
  };

  return sequence(0);
}

function substitute(template: string, mapping: any, ctx: any, scope: any): string {
  if (!template) return '';
  template = resolveConditionals(template, (expr) => {
    const rule = buildIfRule(expr, mapping);
    return rule ? evaluateRule(rule, ctx, scope) : false;
  });
  return template.replace(/\[([^\]]+)\]/g, (_: string, token: string) => {
    const key = String(token).trim();
    if (key === 'Value') {
      const ref = mapping.valueReferenceId;
      if (!ref) return '';
      const num = ctx.getNumber(ref, scope);
      const text = ctx.getText(ref, scope);
      return formatValue(text !== '' && !looksNumeric(text) ? text : num);
    }
    if (key.startsWith('loc:')) {
      const fid = key.slice(4).trim();
      const raw = scope ? readScopeValue(scope, fid) : undefined;
      return gridLocations(raw);
    }
    if (ctx.vars[key] !== undefined) return formatValue(ctx.vars[key]);
    const text = ctx.getText(key, scope);
    if (text !== '') return text;
    const num = ctx.getNumber(key, scope);
    return num ? formatValue(num) : '';
  });
}

export function evaluateDescriptionSchema(schema: any, jobState: any, verticalState: any): string[] {
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
