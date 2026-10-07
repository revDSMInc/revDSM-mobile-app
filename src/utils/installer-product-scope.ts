import type {
  ScopeCombination,
  ScopeFieldRow,
  ScopeSection,
  SoldProduct,
} from '../config/types/installer';

const AUTO_LABEL = /^(section_|field_|selection_)/i;

const STORY_KEY = /^\d+(st|nd|rd|th)$/i;

const storyLabel = (key: string): string => (STORY_KEY.test(key) ? `${key} Story` : key);

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const isEnteredCell = (value: unknown): boolean => {
  const raw = text(value);
  if (!raw) return false;
  const n = Number(raw);
  return Number.isNaN(n) ? true : n > 0;
};

export const measurementRows = (raw: string, label: string): ScopeFieldRow[] => {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ label, value: raw }];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ label, value: raw }];
  }

  const byStory = new Map<string, string[]>();
  const push = (story: string, part: string) => {
    const parts = byStory.get(story);
    if (parts) parts.push(part);
    else byStory.set(story, [part]);
  };

  Object.entries(parsed).forEach(([location, stories]) => {
    if (stories && typeof stories === 'object' && !Array.isArray(stories)) {
      Object.entries(stories as Record<string, unknown>).forEach(([story, value]) => {
        if (isEnteredCell(value)) push(story, `${location}: ${text(value)}`);
      });
    } else if (isEnteredCell(stories)) {
      push('', `${location}: ${text(stories)}`);
    }
  });

  return [...byStory.entries()].map(([story, parts]) => ({
    label: storyLabel(story) || label,
    value: parts.join(', '),
  }));
};

export const fieldRows = (field: any): ScopeFieldRow[] => {
  const value = text(field?.value);
  if (!value) return [];

  const rawLabel = text(field?.label);
  const label = !rawLabel || AUTO_LABEL.test(rawLabel)
    ? ''
    : BARE_COLOR_KEY.test(rawLabel)
    ? 'Color'
    : rawLabel;

  const isMeasurement =
    rawLabel.toLowerCase() === 'measurements' ||
    (value.startsWith('{') && value.endsWith('}'));

  return isMeasurement ? measurementRows(value, label) : [{ label, value }];
};

const COLOR_LABEL = /colou?r/i;

const BARE_COLOR_KEY = /^colou?r([-_][a-z0-9]+)*$/i;

const isQuantityValue = (value: string): boolean =>
  value !== '' && Number.isFinite(Number(value));

export const buildFieldRows = (fields: any[]): ScopeFieldRow[] => {
  const out: ScopeFieldRow[] = [];

  (Array.isArray(fields) ? fields : []).forEach((field: any) => {
    const rows = fieldRows(field);
    if (rows.length !== 1) {
      out.push(...rows);
      return;
    }

    const [row] = rows;
    const previous = out[out.length - 1];

    if (COLOR_LABEL.test(text(field?.label)) && previous && isQuantityValue(previous.value)) {
      out[out.length - 1] = { ...previous, value: `${previous.value} · ${row.value}` };
      return;
    }

    out.push(row);
  });

  return out;
};

const toCombination = (combo: any, index: number): ScopeCombination | null => {
  const rows: ScopeFieldRow[] = [];
  const headline: string[] = [];

  buildFieldRows(combo?.fields).forEach((row) => {
    if (row.label) rows.push(row);
    else headline.push(row.value);
  });

  if (rows.length === 0 && headline.length === 0) return null;

  return { number: index + 1, headline: headline.join(' · '), rows };
};

const toSection = (section: any): ScopeSection | null => {
  const combinations = (Array.isArray(section?.combinations) ? section.combinations : [])
    .map(toCombination)
    .filter((c: ScopeCombination | null): c is ScopeCombination => !!c);

  const rows = buildFieldRows(section?.fields);

  if (combinations.length === 0 && rows.length === 0) return null;

  const rawLabel = text(section?.label);
  return {
    id: text(section?.id) || rawLabel || `section-${combinations.length}-${rows.length}`,
    label: !rawLabel || AUTO_LABEL.test(rawLabel) ? '' : rawLabel,
    combinations,
    rows,
  };
};

export const renumberScopeCombinations = (sections: ScopeSection[]): ScopeSection[] => {
  let n = 0;
  return sections.map((section) => ({
    ...section,
    combinations: section.combinations.map((combo) => ({ ...combo, number: ++n })),
  }));
};

const countCombinations = (sections: ScopeSection[]): number =>
  sections.reduce((total, section) => total + section.combinations.length, 0);

export const rowText = (row: ScopeFieldRow): string =>
  row.label ? `${row.label}: ${row.value}` : row.value;

export const flattenScopeSections = (sections: ScopeSection[]): string[] => {
  const lines: string[] = [];
  const multi = countCombinations(sections) > 1;
  sections.forEach((section) => {
    section.combinations.forEach((combo) => {
      const parts = [
        ...(combo.headline ? [combo.headline] : []),
        ...combo.rows.map(rowText),
      ];
      if (parts.length === 0) return;
      if (multi) lines.push(`Combination #${combo.number} — ${parts.join(' · ')}`);
      else lines.push(...parts);
    });
    lines.push(...section.rows.map(rowText));
  });
  return lines;
};

export const normalizeProductDetails = (raw: any): SoldProduct[] | undefined => {
  const products: any[] = Array.isArray(raw?.products) ? raw.products : [];
  if (products.length === 0) return undefined;

  const out: SoldProduct[] = [];

  products.forEach((product) => {
    const subs: any[] = Array.isArray(product?.subcategories) ? product.subcategories : [];

    if (subs.length === 0) {
      out.push({
        id: text(product?.id) || text(product?.verticalId) || text(product?.name),
        name: text(product?.name) || 'Product',
        lines: [],
        sections: [],
      });
      return;
    }

    subs.forEach((sub) => {
      const sections = renumberScopeCombinations(
        (Array.isArray(sub?.sections) ? sub.sections : [])
          .map(toSection)
          .filter((s: ScopeSection | null): s is ScopeSection => !!s)
      );

      out.push({
        id: text(sub?.id) || `${text(product?.id)}__${text(sub?.label)}`,
        name: text(sub?.label) || text(product?.name) || 'Product',
        lines: flattenScopeSections(sections),
        sections,
      });
    });
  });

  return out.length ? out : undefined;
};
