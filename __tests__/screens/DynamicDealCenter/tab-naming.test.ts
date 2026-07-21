/**
 * Dynamic calculator tab naming — Misc-key suppression.
 *
 * Source of truth: web `sections/deal-center/components/utils/tab-naming.utils.js`
 * `collectTabKeys` (commit 9d22d62, "ticket-999").
 *
 * Ticket: 'if no Versa or VMax is selected then you can display these as "LF Misc".
 * Do not display otherwise (if tab name already has Versa and/or VMax do not add
 * "LF Misc" to tab name).'
 */
import { getLiveSchemaBaseName } from '../../../src/screens/DynamicDealCenter/utils/tab-naming';

const field = (id: string, name: string, label: string) => ({ id, name, label });

/** A gutter-roofline schema shaped like the server's: Gutters + a guard category. */
const schema = (guardCategoryName: string, guardFields: any[]) => [
  {
    id: 'sch1',
    name: 'Gutter / Roofline',
    categories: [
      {
        id: 'cat_gutters',
        name: 'Gutters',
        directFields: [field('g1', 'gutter_5_ds_e', '5" K-Style Gutter'), field('g2', 'wedges', 'Wedges')],
      },
      { id: 'cat_guard', name: guardCategoryName, directFields: guardFields },
    ],
  },
] as any;

/** LeafFilter-flavoured guard category (labels mention Versa) → misc key is "LF Misc". */
const lfSchema = schema('LeafFilter', [
  field('v1', 'versa_1st_story', 'Versa 1st Story'),
  field('v2', 'versa_max_1st_story', 'Versa Max 1st Story'),
  field('m1', 'corners_filter', 'Corners (Filter)'),
  field('m2', 'sawzall_hanger', 'Sawzall Hanger'),
]);

/** Generic micro-mesh guard category → misc key is "GuardMisc". */
const guardSchema = schema('Gutter Guards', [
  field('gm1', 'micro_mesh_1st_story', '6" Micro Mesh'),
  field('gm2', 'corners_filter', 'Corners (Filter)'),
]);

const entries = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { fieldId: id, inputValue: 5 }])) as any;

describe('LF Misc suppression (the ticketed rule)', () => {
  it('drops "LF Misc" when Versa is selected', () => {
    expect(getLiveSchemaBaseName(entries('g1', 'v1', 'm1'), lfSchema)).toBe('G+Versa');
  });

  it('drops "LF Misc" when Versa Max is selected', () => {
    expect(getLiveSchemaBaseName(entries('g1', 'v2', 'm1'), lfSchema)).toBe('G+VMax');
  });

  it('drops "LF Misc" when BOTH Versa and VMax are selected', () => {
    expect(getLiveSchemaBaseName(entries('g1', 'v1', 'v2', 'm1'), lfSchema)).toBe('G+Versa+VMax');
  });

  it('KEEPS "LF Misc" when no Versa/VMax is selected — the add-ons stand alone', () => {
    expect(getLiveSchemaBaseName(entries('g1', 'm1'), lfSchema)).toBe('G+LF Misc');
  });

  it('keeps a standalone "LF Misc" even with several misc add-ons', () => {
    expect(getLiveSchemaBaseName(entries('m1', 'm2'), lfSchema)).toBe('LF Misc');
  });

  it('suppresses regardless of which was entered first (order-independent)', () => {
    // Suppression runs after collection, so a misc-then-main sequence behaves the same.
    expect(getLiveSchemaBaseName(entries('m1', 'v1'), lfSchema)).toBe('Versa');
  });
});

describe('no regression to the rest of the naming', () => {
  it('names gutters alone "G"', () => {
    expect(getLiveSchemaBaseName(entries('g1'), lfSchema)).toBe('G');
  });

  it('collapses gutter misc add-ons into "G" (there is no "G Misc" key — web parity)', () => {
    // Rule 1 of the ticket is satisfied by construction: every field in the Gutters
    // category resolves to 'G', so a "G Misc" can never appear alongside 'G'.
    expect(getLiveSchemaBaseName(entries('g2'), lfSchema)).toBe('G');
    expect(getLiveSchemaBaseName(entries('g1', 'g2'), lfSchema)).toBe('G');
  });

  it('returns an empty base name when nothing is entered', () => {
    expect(getLiveSchemaBaseName({}, lfSchema)).toBe('');
  });

  it('returns an empty base name when there are no schemas', () => {
    expect(getLiveSchemaBaseName(entries('g1'), [])).toBe('');
  });

  it('ignores zero-valued (seeded) entries', () => {
    const seeded = { g1: { fieldId: 'g1', inputValue: 0 }, v1: { fieldId: 'v1', inputValue: 0 } } as any;
    expect(getLiveSchemaBaseName(seeded, lfSchema)).toBe('');
  });

  it('does NOT suppress GuardMisc under Guard — web still emits both', () => {
    // Deliberate web parity, not an oversight. See MISC_KEY_PARENTS.
    expect(getLiveSchemaBaseName(entries('g1', 'gm1', 'gm2'), guardSchema)).toBe('G+Guard+GuardMisc');
  });

  it('keeps a standalone GuardMisc', () => {
    expect(getLiveSchemaBaseName(entries('gm2'), guardSchema)).toBe('GuardMisc');
  });
});
