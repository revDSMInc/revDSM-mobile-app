/**
 * The Investment Center's "Includes the Following" lines, evaluated ON DEVICE.
 *
 * Online the server renders these inside `GET /appointments/:id/lfcalculators` and attaches them
 * as `descriptions` + `descriptionsByCategory`. They are NOT stored on the calculator, and no
 * other endpoint returns them - so a calculator built offline has none, and a cached list written
 * before the rep changed a quantity carries stale ones. Either way the customer is shown one
 * scope at the door and a different one after the sync.
 *
 * This is a port of the backend's `dealCenterDescriptionEvaluator`, from the spec in
 * `docs/MOBILE-DEAL-CENTER-DESCRIPTIONS-OFFLINE.md` (backend `staging`, 2026-10-21).
 *
 * ⚠️ The schemas it needs are NOT the ones the app already caches.
 *   `/sales-rep/v1/description-schema`              -> job builder, nested `verticalState`
 *   `/company/v1/deal-center-description-schema`    -> THIS, flat calculator
 * Separate collections, separate endpoints, same authoring UI. Caching one does not give the
 * other - which is exactly how the first attempt at this missed.
 *
 * ⚠️ Pure on purpose: it is jest-loadable, unlike anything importing React Native.
 */

export interface DealCenterDescriptionEntry {
  line: string;
  categoryId: string;
  categoryName: string;
}

export interface DealCenterDescriptionResult {
  descriptions: string[];
  descriptionsByCategory: Array<{
    categoryId: string;
    categoryName: string;
    descriptions: string[];
  }>;
}

const EMPTY: DealCenterDescriptionResult = { descriptions: [], descriptionsByCategory: [] };

/* ------------------------------------------------------------------ coercion */

const parseNum = (val: any): number => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const n = Number(String(val).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const isAffirmative = (value: any): boolean => {
  if (value === true || value === 1) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'on' || s === '1';
};

const looksNumeric = (value: any): boolean => {
  const s = String(value ?? '').replace(/[^\d.-]/g, '');
  return s !== '' && /\d/.test(s);
};

const isPlainObject = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------- step 1: flatten */

/**
 * ⚠️ `entries[]` are lifted ON TOP of the document's own top-level keys, because the backend's
 * loop runs after the spread. An entry wins over a same-named top-level value; an entry with
 * `inputValue === undefined` is skipped and the top-level value survives.
 */
export const flattenCalculator = (calc: any): Record<string, any> => {
  const obj: Record<string, any> = { ...(calc || {}) };
  const entries = (calc as any)?.entries;

  /**
   * ⚠️ `entries` has TWO shapes and both reach here.
   *
   *   server (`GET .../lfcalculators`) -> an ARRAY of CalculatorEntry
   *   on device (`CalcTab.entries`)    -> a RECORD keyed by field id
   *
   * The backend only ever sees the array, so a port that checks `Array.isArray` alone silently
   * flattens nothing for the in-memory tab - which is exactly the offline case this exists for,
   * and it fails by rendering bare category names rather than by throwing.
   */
  const list = Array.isArray(entries)
    ? entries
    : entries && typeof entries === 'object'
      ? Object.values(entries)
      : [];

  for (const entry of list as any[]) {
    if (entry?.fieldId && entry?.inputValue !== undefined) obj[entry.fieldId] = entry.inputValue;
  }
  return obj;
};

/** One level deep. ⚠️ An object value is ABSENT here - there is no grid handling in deal center. */
const readField = (calc: Record<string, any>, fieldId: string): any => {
  const v = calc?.[String(fieldId || '').trim()];
  return isPlainObject(v) ? undefined : v;
};

const fieldPresent = (calc: Record<string, any>, fieldId: string): boolean => {
  const v = readField(calc, fieldId);
  return v !== undefined && v !== null && v !== '';
};

/* ---------------------------------------------------- step 2: the presence gate */

const conditionRuleFieldIds = (condition: any): string[] => {
  const out: string[] = [];
  const push = (rules: any) =>
    (Array.isArray(rules) ? rules : []).forEach((r: any) => {
      if (r?.fieldId) out.push(String(r.fieldId));
    });
  if (!condition) return out;
  push(condition.rules);
  (Array.isArray(condition.groups) ? condition.groups : []).forEach((g: any) => push(g?.rules));
  return out;
};

const someRuleFieldPresent = (calc: Record<string, any>, condition: any): boolean =>
  conditionRuleFieldIds(condition).some((id) => fieldPresent(calc, id));

const hasAnyRule = (condition: any): boolean => conditionRuleFieldIds(condition).length > 0;

/**
 * ⚠️ A deal-center schema is authored per PRODUCT, but an LFCalculator carries no product id, so
 * the server evaluates every schema against every calculator and relies on field presence to keep
 * a Gutter schema silent on a Flooring calculator.
 *
 * ⚠️ This INVERTS the usual reading of an empty condition. Inside the evaluator an empty condition
 * means "unconditional, passes"; here a mapping with no rules at all is DROPPED, because it would
 * otherwise print on every calculator of every product. Both behaviours are required.
 */
export const gateSchema = (
  schema: any,
  calc: Record<string, any>
): { primaryMappings: any[]; conditionalDescriptions: any[] } | null => {
  if (!schema) return null;

  const primary = Array.isArray(schema.primaryMappings) ? schema.primaryMappings : [];
  const conditional = Array.isArray(schema.conditionalDescriptions)
    ? schema.conditionalDescriptions
    : [];

  // Schema gate: every referenced field id, plus every legacy trigger.
  const referenced: string[] = [];
  [...primary, ...conditional].forEach((m: any) => {
    referenced.push(...conditionRuleFieldIds(m?.condition));
    if (m?.logicTriggerId) referenced.push(String(m.logicTriggerId));
  });
  if (!referenced.some((id) => fieldPresent(calc, id))) return null;

  const primaryMappings = primary.filter((m: any) =>
    hasAnyRule(m?.condition)
      ? someRuleFieldPresent(calc, m.condition)
      : // No condition: only a legacy trigger can keep it alive. Never unconditional.
        !!m?.logicTriggerId && fieldPresent(calc, m.logicTriggerId)
  );

  const conditionalDescriptions = conditional.filter(
    (m: any) => hasAnyRule(m?.condition) && someRuleFieldPresent(calc, m.condition)
  );

  return { primaryMappings, conditionalDescriptions };
};

/* ------------------------------------------------------------ step 3: evaluate */

interface Ctx {
  calc: Record<string, any>;
  vars: Record<string, number>;
  getRaw: (ref: string) => any;
  getNumber: (ref: string) => number;
  getText: (ref: string) => string;
}

const createContext = (schema: any, calc: Record<string, any>): Ctx => {
  const vars: Record<string, number> = {};
  (Array.isArray(schema?.calculatedLogic) ? schema.calculatedLogic : []).forEach((logic: any) => {
    // Only `sum` is implemented server-side; any other formula yields no variable at all.
    if (logic?.formula?.type !== 'sum' || !logic?.variableName) return;
    const fields = Array.isArray(logic.formula.fields) ? logic.formula.fields : [];
    vars[String(logic.variableName)] = fields.reduce(
      (total: number, fieldId: any) => total + parseNum(readField(calc, String(fieldId))),
      0
    );
  });

  // ⚠️ A variable name SHADOWS a field id everywhere a ref is resolved.
  const getRaw = (ref: string): any => {
    const key = String(ref || '').trim();
    if (vars[key] !== undefined) return vars[key];
    return readField(calc, key);
  };

  return {
    calc,
    vars,
    getRaw,
    getNumber: (ref) => parseNum(getRaw(ref)),
    getText: (ref) => {
      const v = getRaw(ref);
      return v === undefined || v === null ? '' : String(v);
    },
  };
};

const equals = (raw: any, num: number, value: any): boolean => {
  if (typeof value === 'boolean') return isAffirmative(raw) === value;
  if (looksNumeric(value)) return num === parseNum(value);
  return String(raw ?? '').trim().toLowerCase() === String(value ?? '').trim().toLowerCase();
};

/**
 * ⚠️ `String(null).trim()` is `"null"`, so a field explicitly set to null passes `isNotEmpty`.
 * The presence gate usually hides it, but a mapping kept alive by a DIFFERENT field will see it.
 * Reproduced deliberately - "fixing" it here makes the device and the server disagree.
 */
export const evaluateRule = (rule: any, ctx: Ctx): boolean => {
  if (!rule?.fieldId) return false;
  const num = ctx.getNumber(rule.fieldId);
  const raw = ctx.getRaw(rule.fieldId);
  const nonEmpty = (raw !== undefined && String(raw).trim() !== '') || num !== 0;

  switch (rule.operator) {
    case '>':
      return num > parseNum(rule.value);
    case '>=':
      return num >= parseNum(rule.value);
    case '<':
      return num < parseNum(rule.value);
    case '<=':
      return num <= parseNum(rule.value);
    case 'isNotEmpty':
    case 'exists':
    case 'truthy':
      return nonEmpty;
    case 'isEmpty':
      return !nonEmpty;
    case '!=':
      return !equals(raw, num, rule.value);
    default: // '==' and any unknown operator
      return equals(raw, num, rule.value);
  }
};

const evaluateCondition = (condition: any, ctx: Ctx): boolean => {
  if (!condition) return true;
  const groups = Array.isArray(condition.groups) ? condition.groups : [];
  if (groups.length) {
    // AND between groups; an empty group passes.
    return groups.every((g: any) => {
      const rules = Array.isArray(g?.rules) ? g.rules : [];
      if (!rules.length) return true;
      return g?.type === 'any'
        ? rules.some((r: any) => evaluateRule(r, ctx))
        : rules.every((r: any) => evaluateRule(r, ctx));
    });
  }
  const rules = Array.isArray(condition.rules) ? condition.rules : [];
  if (!rules.length) return true;
  return condition.type === 'any'
    ? rules.some((r: any) => evaluateRule(r, ctx))
    : rules.every((r: any) => evaluateRule(r, ctx));
};

const mappingPasses = (mapping: any, ctx: Ctx): boolean => {
  const condition = mapping?.condition;
  const hasRules = Array.isArray(condition?.rules) && condition.rules.length > 0;
  const hasGroups = Array.isArray(condition?.groups) && condition.groups.length > 0;
  if (hasRules || hasGroups) return evaluateCondition(condition, ctx);
  // Legacy single trigger. Passes trivially when there is no `logicTriggerId`.
  if (!mapping?.logicTriggerId) return true;
  return evaluateRule(
    {
      fieldId: mapping.logicTriggerId,
      operator: mapping.logicTriggerCondition?.operator ?? '>',
      value: mapping.logicTriggerCondition?.value ?? 0,
    },
    ctx
  );
};

/* -------------------------------------------------------------- step 4: render */

const IF_WORD_OPERATORS = ['isNotEmpty', 'isEmpty', 'exists'];

const buildIfRule = (expr: string, mapping: any): any | null => {
  const text = String(expr || '').trim();
  if (!text) return null;

  const wordMatch = new RegExp(`^(.*?)\\s+(${IF_WORD_OPERATORS.join('|')})\\s*$`, 'i').exec(text);
  let ref: string;
  let operator: string;
  let value: any = '';

  if (wordMatch) {
    ref = wordMatch[1].trim();
    operator = IF_WORD_OPERATORS.find(
      (w) => w.toLowerCase() === wordMatch[2].toLowerCase()
    ) as string;
  } else {
    const opMatch = /^(.*?)\s*(>=|<=|==|!=|<>|=|>|<)\s*(.*)$/.exec(text);
    if (opMatch) {
      ref = opMatch[1].trim();
      operator = opMatch[2] === '=' ? '==' : opMatch[2] === '<>' ? '!=' : opMatch[2];
      value = opMatch[3].trim().replace(/^(['"])(.*)\1$/, '$2');
    } else {
      ref = text;
      operator = 'truthy'; // a bare ref is a truthy test
    }
  }

  if (ref === 'Value') {
    ref = mapping?.valueReferenceId || '';
    if (!ref) return null;
  }
  return { fieldId: ref, operator, value };
};

type CondToken =
  | { kind: 'text'; text: string }
  | { kind: 'if'; expr: string }
  | { kind: 'else' }
  | { kind: 'endif' };

/**
 * ⚠️ Forgiving on purpose, and the two rules are not symmetric: an unclosed `[IF]` closes at the
 * END of the template (truncating would silently shorten a line on a signed document), while a
 * stray `[ELSE]` / `[/IF]` is DROPPED rather than printed (a raw marker in front of a customer is
 * the worse failure).
 */
const resolveConditionals = (template: string, test: (expr: string) => boolean): string => {
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
          while (tokens[pos]?.kind === 'else') {
            pos += 1;
            sequence(depth + 1);
          }
        }
        if (tokens[pos]?.kind === 'endif') pos += 1;
        out += take ? thenPart : elsePart;
      } else {
        if (depth > 0) return out;
        pos += 1;
      }
    }
    return out;
  };

  return sequence(0);
};

/**
 * ⚠️ `[IF]` blocks resolve BEFORE any token merge, so a token inside a branch that was not taken
 * is never read.
 *
 * ⚠️ A field whose number is 0 renders as `''`, not `"0"`.
 */
const substitute = (template: string, mapping: any, ctx: Ctx): string => {
  if (!template) return '';
  const resolved = resolveConditionals(template, (expr) => {
    const rule = buildIfRule(expr, mapping);
    return rule ? evaluateRule(rule, ctx) : false;
  });
  return resolved.replace(/\[([^\]]+)\]/g, (_: string, token: string) => {
    const key = String(token).trim();
    if (key === 'Value') {
      const ref = mapping?.valueReferenceId;
      if (!ref) return '';
      const text = ctx.getText(ref);
      const num = ctx.getNumber(ref);
      return text !== '' && !looksNumeric(text) ? text : String(num);
    }
    if (ctx.vars[key] !== undefined) return String(ctx.vars[key]);
    const text = ctx.getText(key);
    const num = ctx.getNumber(key);
    // ⚠️ A numeric field of 0 renders as '' (spec 6b), so the numeric-looking case must be
    // decided by the NUMBER, not by `text !== ''` - `String(0)` is "0", which is non-empty and
    // would otherwise print a bare zero into a line a customer reads.
    if (text !== '' && !looksNumeric(text)) return text;
    return num ? String(num) : '';
  });
};

/** An array of lines, or a legacy newline-joined string. Each surviving line is its own entry. */
export const splitOutputs = (outputTemplate: any): string[] => {
  const raw = Array.isArray(outputTemplate)
    ? outputTemplate.map((x) => String(x ?? ''))
    : String(outputTemplate ?? '').split('\n');
  return raw.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
};

/* ------------------------------------------------- step 5: collect, dedupe, group */

export const evaluateDealCenterDescriptions = (
  schemas: any[] | null | undefined,
  calculator: any
): DealCenterDescriptionResult => {
  if (!Array.isArray(schemas) || !schemas.length || !calculator) return { ...EMPTY };

  const calc = flattenCalculator(calculator);
  const entries: DealCenterDescriptionEntry[] = [];

  for (const schema of schemas) {
    const gated = gateSchema(schema, calc);
    if (!gated) continue;
    const ctx = createContext(schema, calc);

    const emit = (mapping: any, forceEmptyCategory: boolean) => {
      if (!mappingPasses(mapping, ctx)) return;
      for (const template of splitOutputs(mapping?.outputTemplate)) {
        const line = substitute(template, mapping, ctx).trim();
        if (!line) continue;
        entries.push({
          line,
          // ⚠️ conditionalDescriptions ALWAYS land in the unnamed group.
          categoryId: forceEmptyCategory ? '' : String(mapping?.categoryId ?? ''),
          categoryName: forceEmptyCategory ? '' : String(mapping?.categoryName ?? ''),
        });
      }
    };

    gated.primaryMappings.forEach((m: any) => emit(m, false));
    gated.conditionalDescriptions.forEach((m: any) => emit(m, true));
  }

  /**
   * ⚠️ The two lists dedupe INDEPENDENTLY: a line shared by two categories appears once in the
   * flat list and once in EACH group. Do not derive one from the other.
   *
   * ⚠️ Never sorted - schema order, then mapping order. The portal decides which trade leads.
   */
  const seenFlat = new Set<string>();
  const descriptions: string[] = [];
  entries.forEach((e) => {
    if (seenFlat.has(e.line)) return;
    seenFlat.add(e.line);
    descriptions.push(e.line);
  });

  const order: string[] = [];
  const buckets = new Map<string, { categoryId: string; categoryName: string; seen: Set<string>; descriptions: string[] }>();
  entries.forEach((e) => {
    let bucket = buckets.get(e.categoryId);
    if (!bucket) {
      bucket = { categoryId: e.categoryId, categoryName: e.categoryName, seen: new Set(), descriptions: [] };
      buckets.set(e.categoryId, bucket);
      order.push(e.categoryId);
    }
    if (!bucket.categoryName && e.categoryName) bucket.categoryName = e.categoryName;
    if (bucket.seen.has(e.line)) return;
    bucket.seen.add(e.line);
    bucket.descriptions.push(e.line);
  });

  return {
    descriptions,
    descriptionsByCategory: order.map((id) => {
      const b = buckets.get(id)!;
      return { categoryId: b.categoryId, categoryName: b.categoryName, descriptions: b.descriptions };
    }),
  };
};

export default evaluateDealCenterDescriptions;
