import { buildDealCenterData } from './build-deal-center-data';
import { buildInitialJobState } from '../../../utils/dynamic-job-builder/engine/preview-compute';
import { deserializeDynamicJobStateFromStorage } from '../../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import { evaluateDescriptionSchema } from '../../../utils/dynamic-job-builder/agreement/description-schema-evaluator';

/**
 * Build the Investment Center "Includes the Following" job-scope matrix for ONE
 * calculator — the fix for the web bug where every calculator showed a hardcoded
 * generic gutter list regardless of its actual products.
 *
 * The real scope sentences come from the dynamic agreement description-schema engine
 * (`evaluateDescriptionSchema`), which is keyed by JOB-BUILDER field/section ids — a
 * different namespace than the calculator's `entries` (calculator-schema ids). The
 * bridge is the `dcField` mapping baked into the job-builder config:
 *
 *   1. If the calculator was already built, use its persisted `dynamicJobState`
 *      (richest — includes manually-entered job-builder fields).
 *   2. Otherwise reconstruct a job-builder `verticalState` from the calculator's own
 *      entries: `buildDealCenterData(entries) → buildInitialJobState(config, dcData)`,
 *      which populates each job-builder field from the calculator via `dcField`.
 *
 * Then every configured description schema is evaluated against that verticalState and
 * the emitted lines are stripped of FOOTAGES (e.g. `— 120'`, `12 sq`, `4 ea`) and the
 * blank COLOR substitutions collapsed — per the requirement "no footages, no colors,
 * in order". Inch sizes (`6"`) are kept (they denote product size, not footage).
 */

export interface InvestmentJobScopeParams {
  /** This calculator's entries (keyed by field id). */
  entries: Record<string, any>;
  /** System A configured calculator schemas (verticals) — for the dcField bridge. */
  calculatorSchemas: any[];
  /** System B job-builder config (verticals[].tabs[]) — drives buildInitialJobState. */
  jobBuilderConfig: any;
  /** All per-vertical description schemas (from useGetDescriptionSchemas). */
  descriptionSchemas: any[];
  /** The lead (lowest-priority data source for buildDealCenterData). */
  lead?: any;
  /** Persisted dynamicJobState for a BUILT calculator (from getLeadOutcomeByCalculator). */
  savedJobState?: any;
}

/**
 * Strip a single scope sentence of footages and blank-color artifacts.
 * Feet (`'`), squares (`sq`/`sq ft`), linear feet (`lf`), each (`ea`), hours (`hrs`),
 * and sheet counts are removed — inch sizes (`"`) are preserved.
 */
export function stripScopeLine(raw: string): string {
  let s = String(raw || '');
  const UNIT = `(?:'|sq\\s?ft|sq|lin\\.?\\s?ft|lf|ea|hrs?|sheets?|pcs?|units?)`;
  // Trailing/inline measurement with a leading dash separator: "— 120'", "- 12 sq".
  s = s.replace(new RegExp(`\\s*[—–-]\\s*[\\d.,]+\\s*${UNIT}\\b\\.?`, 'gi'), '');
  // Any remaining bare measurement token: "120'", "12 sq".
  s = s.replace(new RegExp(`\\b[\\d.,]+\\s*${UNIT}\\b\\.?`, 'gi'), '');
  // Any leftover unresolved schema token (blank color / value that didn't substitute).
  s = s.replace(/\[[^\]]*\]/g, '');
  s = s.replace(/\(\s*\)/g, '');        // empty parens
  s = s.replace(/\s{2,}/g, ' ');        // collapse doubled spaces (from blank colors)
  s = s.replace(/\s+([,.;])/g, '$1');   // no space before punctuation
  s = s.replace(/,\s*$/g, '');          // trailing comma
  s = s.replace(/\s*[—–-]\s*$/g, '');   // dangling trailing dash
  return s.trim();
}

/** Returns the ordered, footage/color-stripped job-scope lines for a calculator. */
export function buildInvestmentJobScope(params: InvestmentJobScopeParams): string[] {
  const { entries, calculatorSchemas, jobBuilderConfig, descriptionSchemas, lead, savedJobState } = params;
  if (!jobBuilderConfig || !Array.isArray(descriptionSchemas) || descriptionSchemas.length === 0) {
    return [];
  }

  // 1. Resolve the job-builder verticalState.
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
      return [];
    }
  }
  if (!verticalState) return [];

  // 2. Evaluate every description schema against that state and collect the lines.
  const lines: string[] = [];
  for (const schema of descriptionSchemas) {
    try {
      const out = evaluateDescriptionSchema(schema, {}, verticalState);
      if (Array.isArray(out)) lines.push(...out);
    } catch {
      // a broken/unrelated schema shouldn't abort the whole matrix
    }
  }

  // 3. Strip footages/colors, drop empties, dedupe (preserve first-seen order).
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
