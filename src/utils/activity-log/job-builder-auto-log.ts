import { LeadService } from '../../services/api/leads';

export const JOB_BUILDER_LOCATIONS = [
  'LEFT SIDE',
  'RIGHT SIDE',
  'FRONT',
  'REAR',
  'GARAGE',
  'OTHER',
] as const;

export const JOB_BUILDER_STORIES = ['1ST STORY', '2ND STORY', '3RD STORY'] as const;

export const JOB_BUILDER_STORY_LABELS = ['1st Story', '2nd Story', '3rd Story'] as const;

/** Gutter grid: location × story (lIdx * 3 + sIdx). LeafFilter/Lighting: story × location. */
export function measurementIndexToLabels(
  mIdx: number,
  layout: 'gutter' | 'leaffilter' | 'lighting'
): { location: string; story: string } {
  if (layout === 'gutter') {
    const locIdx = Math.floor(mIdx / 3);
    const storyIdx = mIdx % 3;
    return {
      location: JOB_BUILDER_LOCATIONS[locIdx] || `Location ${locIdx + 1}`,
      story: JOB_BUILDER_STORY_LABELS[storyIdx] || `Story ${storyIdx + 1}`,
    };
  }

  const locIdx = mIdx % 6;
  const storyIdx = Math.floor(mIdx / 6);
  return {
    location: JOB_BUILDER_LOCATIONS[locIdx] || `Location ${locIdx + 1}`,
    story: JOB_BUILDER_STORY_LABELS[storyIdx] || `Story ${storyIdx + 1}`,
  };
}

export function normalizeLoggedSections(raw: unknown): Record<string, boolean> {
  let loggedSections: Record<string, boolean> = { lead_result: false };
  if (raw === true) {
    return {
      gutter: true,
      leaffilter: true,
      soffit: true,
      fascia: true,
      additional: true,
      lighting: true,
      lead_result: false,
    };
  }
  if (raw && typeof raw === 'object') {
    loggedSections = { ...loggedSections, ...(raw as Record<string, boolean>) };
  }
  return loggedSections;
}

/**
 * ⚠️ `calculatorId` is REQUIRED in practice: the outcome endpoint is
 * calculator-scoped since the bare lead-scoped route was deprecated. Callers that
 * cannot resolve one get the empty shape rather than a 404 round trip.
 */
export async function fetchJobBuilderLoggedSections(leadId: string, calculatorId?: string | null) {
  if (!calculatorId) {
    return { payload: {}, jobBuilder: {}, loggedSections: normalizeLoggedSections(undefined) };
  }
  const res = await LeadService.getLeadOutcomeByCalculator(leadId, calculatorId);
  const inner = res?.data?.data || res?.data || res || {};
  const jobBuilder = inner?.jobBuilder || inner?.jobState || inner;
  return {
    payload: inner,
    jobBuilder,
    loggedSections: normalizeLoggedSections(jobBuilder?.autoFieldsLogged),
  };
}

export async function markAutoFieldsLogged(
  leadId: string,
  jobBuilder: Record<string, unknown> | null | undefined,
  section: string
) {
  if (!leadId || !section) return;
  const current = jobBuilder?.autoFieldsLogged;
  const existing =
    current && typeof current === 'object' ? (current as Record<string, boolean>) : {};

  try {
    await LeadService.updateJobBuilder(leadId, {
      jobBuilder: {
        ...(jobBuilder || {}),
        autoFieldsLogged: { ...existing, [section]: true },
      },
    });
  } catch (error) {
    console.warn('[JobBuilder] Failed to mark autoFieldsLogged:', error);
  }
}

/** Strip noise from calculator titles in log meta only (not UI). */
export function sanitizeCalculatorLogTitle(title: string): string {
  return (title || '')
    .replace(/⚠️/g, '')
    .replace(/\s\((SM|MD|LG|XL|XXL(-[0-9])?)\)$/i, '')
    .replace(/\bnew\b/gi, '')
    .replace(/\btab\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLoggableJobBuilderValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Only log when a value is set or cleared — not when empty placeholders are auto-initialized. */
export function shouldLogJobBuilderFieldChange(oldValue: unknown, newValue: unknown): boolean {
  if (String(oldValue ?? '') === String(newValue ?? '')) return false;
  return isLoggableJobBuilderValue(newValue) || isLoggableJobBuilderValue(oldValue);
}
