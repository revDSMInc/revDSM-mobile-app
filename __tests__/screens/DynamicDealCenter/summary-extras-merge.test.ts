/**
 * Summary "Extras" value·color merge — bordered stack grouping.
 *
 * Source of truth: web `vertical-summary-utils.js` `processStackFieldSummary` /
 * `buildStackRowSummary` (commit 5a54070). A bordered, multi-column stack pairs
 * its children positionally and joins each pair's formatted values with " · ", so
 * "Ground Spout = 4" + its adjacent "Color = Black" render as one row "4 · Black".
 *
 * Ticket: "Job builder > Gutter > Summary > Display Extras Value and Color in a
 * Single Row in Summary".
 *
 * The merge lives inside `buildCombinationEntry` → `processSummaryFields`, which
 * are module-private, so this drives it through the public `buildTabSummaryEntries`
 * with a minimal config/state shaped like the real backend schema.
 */
import { buildTabSummarySection } from '../../../src/utils/dynamic-job-builder/engine/vertical-summary-utils';

const num = (id: string, label: string) => ({ id, label, type: 'number' });
const swatch = (id: string) => ({ id, label: 'Color', type: 'swatch' });

/** A tab with one combination section whose row fields include a bordered "Extras" stack. */
function makeConfig(extrasFields: any[], opts: { bordered?: boolean; columns?: number } = {}) {
  return {
    verticals: [
      {
        id: 'v1',
        label: 'Gutters',
        tabs: [
          {
            id: 'gutters',
            label: 'Gutters',
            sections: [
              {
                id: 'sec1',
                label: 'Gutter',
                sectionType: 'combination',
                fields: [
                  {
                    id: 'extras',
                    label: 'Extras',
                    type: 'stack',
                    bordered: opts.bordered ?? true,
                    fieldGridColumns: opts.columns ?? 2,
                    fields: extrasFields,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function comboState(values: Record<string, any>) {
  return {
    v1: {
      gutters: {
        comboGroups: {
          sec1: { combinations: [{ _combinationNumber: 1, ...values }] },
        },
      },
    },
  };
}

/** Run the summary and return the flat list of { label, text } rows for the first combo. */
function extrasRows(config: any, state: any) {
  const summary = buildTabSummarySection(config.verticals[0].tabs[0], state.v1.gutters, {
    dealCenterData: {},
    applyConditions: false,
  });
  const section = summary.combinationSections?.[0];
  const combo = section?.combinations?.[0];
  return (combo?.comboFieldRows || []).map((r: any) => ({ label: r.label, text: r.text }));
}

describe('bordered 2-column stack merges value + color', () => {
  const config = makeConfig([
    num('ground_spout', 'Ground Spout'),
    swatch('ground_spout_color'),
    num('replace_corner', 'Replace Corner Miter'),
    swatch('replace_corner_color'),
  ]);

  it('renders "4 · Black" on one row, labelled by the number field', () => {
    const rows = extrasRows(
      config,
      comboState({
        ground_spout: 4,
        ground_spout_color: 'Black',
        replace_corner: 4,
        replace_corner_color: 'Designer Copper',
      })
    );

    expect(rows).toEqual([
      { label: 'Ground Spout', text: '4 · Black' },
      { label: 'Replace Corner Miter', text: '4 · Designer Copper' },
    ]);
  });

  it('shows only the number when the paired color is empty', () => {
    const rows = extrasRows(
      config,
      comboState({ ground_spout: 4, ground_spout_color: '', replace_corner: 0, replace_corner_color: '' })
    );

    // ground_spout: color empty → "4"; replace_corner: 0 is not displayable → dropped.
    expect(rows).toEqual([{ label: 'Ground Spout', text: '4' }]);
  });

  it('takes the label from the number field, never the color field', () => {
    const rows = extrasRows(config, comboState({ ground_spout: 4, ground_spout_color: 'Black' }));
    expect(rows[0].label).toBe('Ground Spout');
    expect(rows[0].label).not.toBe('Color');
  });
});

describe('non-merging cases (no regression)', () => {
  it('a NON-bordered stack keeps one row per child', () => {
    const config = makeConfig(
      [num('ground_spout', 'Ground Spout'), swatch('ground_spout_color')],
      { bordered: false, columns: 2 }
    );
    const rows = extrasRows(config, comboState({ ground_spout: 4, ground_spout_color: 'Black' }));

    expect(rows).toEqual([
      { label: 'Ground Spout', text: '4' },
      { label: 'Color', text: 'Black' },
    ]);
  });

  it('a single-column bordered stack keeps one row per child', () => {
    const config = makeConfig(
      [num('ground_spout', 'Ground Spout'), swatch('ground_spout_color')],
      { bordered: true, columns: 1 }
    );
    const rows = extrasRows(config, comboState({ ground_spout: 4, ground_spout_color: 'Black' }));

    expect(rows).toEqual([
      { label: 'Ground Spout', text: '4' },
      { label: 'Color', text: 'Black' },
    ]);
  });

  it('drops a pair entirely when neither value is present', () => {
    const config = makeConfig([num('ground_spout', 'Ground Spout'), swatch('ground_spout_color')]);
    const rows = extrasRows(config, comboState({ ground_spout: 0, ground_spout_color: '' }));

    expect(rows).toEqual([]);
  });
});
