/**
 * `section.showCombinationLabel` — the portal flag that hides the "Combination #N"
 * chip on sections holding a single logical configuration (Downspout & Accessories,
 * Measurements).
 *
 * Source of truth: web `dynamic-tab-renderer.js:233`
 *   const showCombinationLabel = section?.showCombinationLabel !== false;
 *
 * The flag is authored in the admin portal and must survive mobile's config
 * normalization untouched — that pipeline is what this covers, since a dropped
 * flag would silently re-show the chip with no error anywhere.
 */
import { getTabSections } from '../../../src/utils/dynamic-job-builder/engine/combination-utils';

// The exact expression from DynamicTabRenderer / web.
const showsLabel = (section: any) => section?.showCombinationLabel !== false;

describe('showCombinationLabel semantics', () => {
  it('hides the chip only for an explicit false', () => {
    expect(showsLabel({ showCombinationLabel: false })).toBe(false);
  });

  it('shows the chip when the flag is absent (schemas without it are unaffected)', () => {
    expect(showsLabel({})).toBe(true);
    expect(showsLabel({ showCombinationLabel: undefined })).toBe(true);
  });

  it('shows the chip when explicitly true', () => {
    expect(showsLabel({ showCombinationLabel: true })).toBe(true);
  });

  it('does not treat other falsy values as "hide" (web uses !== false, not falsy)', () => {
    expect(showsLabel({ showCombinationLabel: 0 })).toBe(true);
    expect(showsLabel({ showCombinationLabel: null })).toBe(true);
    expect(showsLabel({ showCombinationLabel: '' })).toBe(true);
  });
});

describe('the flag survives config normalization', () => {
  const section = (extra: any) => ({
    id: 'sec_downspout',
    label: 'Downspout & Accessories',
    sectionType: 'combination',
    fields: [{ id: 'f1', key: 'downspout_type', type: 'optionList', options: ['2 x 3'] }],
    ...extra,
  });

  it('keeps showCombinationLabel: false through getTabSections/normalizeSection', () => {
    const [out] = getTabSections({ sections: [section({ showCombinationLabel: false })] } as any);

    expect(out.showCombinationLabel).toBe(false);
    expect(showsLabel(out)).toBe(false);
  });

  it('leaves a section without the flag showing its chip', () => {
    const [out] = getTabSections({ sections: [section({})] } as any);

    expect(showsLabel(out)).toBe(true);
  });

  it('preserves the rest of the section while normalizing', () => {
    const [out] = getTabSections({ sections: [section({ showCombinationLabel: false })] } as any);

    expect(out.id).toBe('sec_downspout');
    expect(out.label).toBe('Downspout & Accessories');
    expect(out.sectionType).toBe('combination');
  });
});
