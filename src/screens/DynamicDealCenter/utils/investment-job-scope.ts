import { buildDealCenterData } from './build-deal-center-data';
import { buildInitialJobState } from '../../../utils/dynamic-job-builder/engine/preview-compute';
import { deserializeDynamicJobStateFromStorage } from '../../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import { evaluateDescriptionSchema } from '../../../utils/dynamic-job-builder/agreement/description-schema-evaluator';

export interface InvestmentJobScopeParams {
  entries: Record<string, any>;
  calculatorSchemas: any[];
  jobBuilderConfig: any;
  descriptionSchemas: any[];
  lead?: any;
  savedJobState?: any;
  calculatorDescriptions?: string[];
}

export function stripScopeLine(raw: string): string {
  let s = String(raw || '');
  const UNIT = `(?:'|sq\\s?ft|sq|lin\\.?\\s?ft|lf|ea|hrs?|sheets?|pcs?|units?)`;
  s = s.replace(new RegExp(`\\s*[—–-]\\s*[\\d.,]+\\s*${UNIT}\\b\\.?`, 'gi'), '');
  s = s.replace(new RegExp(`\\b[\\d.,]+\\s*${UNIT}\\b\\.?`, 'gi'), '');
  s = s.replace(/\[[^\]]*\]/g, '');
  s = s.replace(/\(\s*\)/g, '');        // empty parens
  s = s.replace(/\s{2,}/g, ' ');        // collapse doubled spaces (from blank colors)
  s = s.replace(/\s+([,.;])/g, '$1');   // no space before punctuation
  s = s.replace(/,\s*$/g, '');          // trailing comma
  s = s.replace(/\s*[—–-]\s*$/g, '');   // dangling trailing dash
  return s.trim();
}

function cleanScopeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const cleaned = stripScopeLine(line);
    if (cleaned.length < 3) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function buildInvestmentJobScope(params: InvestmentJobScopeParams): string[] {
  const { entries, calculatorSchemas, jobBuilderConfig, descriptionSchemas, lead, savedJobState, calculatorDescriptions } = params;

  const calcLines: string[] = Array.isArray(calculatorDescriptions)
    ? calculatorDescriptions.filter((d: any) => typeof d === 'string' && d.trim())
    : [];

  if (calcLines.length > 0) {
    return cleanScopeLines(calcLines);
  }

  if (!jobBuilderConfig || !Array.isArray(descriptionSchemas) || descriptionSchemas.length === 0) {
    return cleanScopeLines(calcLines);
  }

  let verticalState: any = null;
  try {
    if (savedJobState) {
      verticalState = deserializeDynamicJobStateFromStorage(savedJobState, jobBuilderConfig);
    }
  } catch {
    verticalState = null;
  }
  if (!verticalState) {
    try {
      const dealCenterData = buildDealCenterData({
        entries: entries || {},
        resultData: {},
        schemas: calculatorSchemas || [],
        lead: lead || {},
      });
      verticalState = buildInitialJobState(jobBuilderConfig, dealCenterData);
    } catch {
      return cleanScopeLines(calcLines);
    }
  }
  if (!verticalState) return cleanScopeLines(calcLines);

  const lines: string[] = [...calcLines];
  for (const schema of descriptionSchemas) {
    if (typeof schema === 'string') {
      if (schema.trim()) lines.push(schema.trim());
      continue;
    }
    if (Array.isArray(schema?.descriptions)) {
      lines.push(...schema.descriptions.filter((d: any) => typeof d === 'string' && d.trim()));
    }
    try {
      const out = evaluateDescriptionSchema(schema, {}, verticalState);
      if (Array.isArray(out)) lines.push(...out);
    } catch {
    }
  }

  return cleanScopeLines(lines);
}
