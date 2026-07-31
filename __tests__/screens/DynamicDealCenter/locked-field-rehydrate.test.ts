import {
  serializeDynamicJobStateForStorage,
  deserializeDynamicJobStateFromStorage,
  hydrateJobStateForPersistence,
} from '../../../src/utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import { buildDealCenterData } from '../../../src/screens/DynamicDealCenter/utils/build-deal-center-data';

/**
 * Regression: gutter "Extras" (Wedges / Straps) are LOCKED, dcField-driven fields.
 * Their value is not stored meaningfully — it resolves from the calculator
 * (dealCenterData). On reopen the deserialized state alone leaves them blank; the
 * job builder screen must RE-HYDRATE the loaded state against dealCenterData (web
 * parity: JobBuilderContext.applyDraftState) so the locked value comes back.
 */
describe('locked dcField field re-hydrates from dealCenterData on load', () => {
  const config = {
    name: 'test',
    verticals: [
      {
        id: 'v1',
        label: 'Gutters',
        tabs: [
          {
            id: 'v1__t1',
            label: 'Gutters',
            sections: [
              {
                id: 'sec_extras',
                label: 'Extras',
                sectionType: 'simple',
                fields: [
                  {
                    id: 'f_wedges',
                    type: 'text',
                    label: 'Wedges',
                    locked: true,
                    dcField: 'wedges_count',
                    defaultValue: '',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it('a locked field left blank in storage comes back from dealCenterData', () => {
    // Saved state has the locked field blank (what gets stored when dealCenterData
    // was unavailable at save time).
    const savedRuntime: any = {
      v1: { 'v1__t1': { sectionFields: { sec_extras: { f_wedges: '' } } } },
    };

    const serialized = serializeDynamicJobStateForStorage(savedRuntime, config, {});
    const deserialized = deserializeDynamicJobStateFromStorage(serialized, config);

    // Deserialize alone → still blank.
    expect(deserialized.v1['v1__t1'].sectionFields.sec_extras.f_wedges).toBe('');

    // Re-hydrate with a populated dealCenterData → the locked field resolves.
    const hydrated = hydrateJobStateForPersistence(deserialized, config, { wedges_count: 5 });
    expect(hydrated.v1['v1__t1'].sectionFields.sec_extras.f_wedges).toBe(5);
  });

  it('a NON-locked entered value is preserved through re-hydrate', () => {
    const cfg2 = JSON.parse(JSON.stringify(config));
    cfg2.verticals[0].tabs[0].sections[0].fields[0] = {
      id: 'f_note',
      type: 'text',
      label: 'Note',
      defaultValue: '',
    };
    const runtime: any = {
      v1: { 'v1__t1': { sectionFields: { sec_extras: { f_note: 'hello' } } } },
    };
    const hydrated = hydrateJobStateForPersistence(runtime, cfg2, {});
    expect(hydrated.v1['v1__t1'].sectionFields.sec_extras.f_note).toBe('hello');
  });

  // Regression (confirmed against live api.np.revdsm.com data): a locked field's
  // saved value is WIPED on reopen when dealCenterData can't resolve its dcField —
  // resolveLockedValue falls back to the blank defaultValue and overwrites the
  // saved value. The fix is upstream: dealCenterData must be built from the
  // RESULTED calculator's entries (which carry the dcField ref, e.g. an entry
  // whose `name` === 'wedges_count'), so the ref resolves and the value survives.
  // Regression: an UNBUILT product (locked field whose dcField does not resolve —
  // the product was never built) must be EMPTIED and its combination PRUNED, so the
  // portal does not render a phantom product (e.g. "LeafFilter → Combination #1-4"
  // with a default "Versa" profile the rep never entered). A locked optionList/toggle
  // that resolves to '' must return '' (matching the prune's default), NOT fall
  // through to its stored phantom value.
  describe('unbuilt (locked, unresolved) product combos are pruned', () => {
    const comboConfig = {
      name: 'lf-test',
      verticals: [
        {
          id: 'lf',
          label: 'LeafFilter',
          tabs: [
            {
              id: 'lf__t1',
              label: 'LeafFilter',
              sections: [
                {
                  id: 'sec_combo',
                  label: 'Combos',
                  sectionType: 'combination',
                  defaultItem: {},
                  fields: [
                    {
                      id: 'f_profile',
                      type: 'optionList',
                      label: 'LeafFilter Profile',
                      locked: true,
                      dcField: 'lf_profile',
                      defaultValue: '',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    it('drops a combo whose only LOCKED field carries an auto value (never built)', () => {
      // Phantom: a LeafFilter combo with a locked, calculator-resolved profile — the
      // rep never manually built LeafFilter, so the auto value must NOT persist.
      const phantom: any = {
        lf: { 'lf__t1': { comboGroups: { sec_combo: { combinations: [{ f_profile: 'Versa' }] } } } },
      };
      // Even when dealCenterData resolves the locked dcField, a locked-only combo is
      // auto-populated (not built) → pruned.
      const serialized = serializeDynamicJobStateForStorage(phantom, comboConfig, { lf_profile: 'Versa' });
      const deserialized = deserializeDynamicJobStateFromStorage(serialized, comboConfig);
      expect(deserialized.lf['lf__t1'].comboGroups.sec_combo.combinations).toHaveLength(0);
    });

    it('drops a combo whose non-locked field is at its config default (seeded, not entered)', () => {
      const cfg = JSON.parse(JSON.stringify(comboConfig));
      cfg.verticals[0].tabs[0].sections[0].fields = [
        { id: 'f_profile', type: 'optionList', label: 'Profile', defaultValue: 'Versa' },
      ];
      const seeded: any = {
        lf: { 'lf__t1': { comboGroups: { sec_combo: { combinations: [{ f_profile: 'Versa' }] } } } },
      };
      const serialized = serializeDynamicJobStateForStorage(seeded, cfg, {});
      const deserialized = deserializeDynamicJobStateFromStorage(serialized, cfg);
      // 'Versa' === field.defaultValue → a seeded default, not user input → pruned.
      expect(deserialized.lf['lf__t1'].comboGroups.sec_combo.combinations).toHaveLength(0);
    });

    it('keeps a combo with a manually-entered (non-locked, non-default) field', () => {
      const cfg = JSON.parse(JSON.stringify(comboConfig));
      cfg.verticals[0].tabs[0].sections[0].fields = [
        { id: 'f_note', type: 'text', label: 'Note', defaultValue: '' },
      ];
      const built: any = {
        lf: { 'lf__t1': { comboGroups: { sec_combo: { combinations: [{ f_note: 'custom' }] } } } },
      };
      const serialized = serializeDynamicJobStateForStorage(built, cfg, {});
      const deserialized = deserializeDynamicJobStateFromStorage(serialized, cfg);
      expect(deserialized.lf['lf__t1'].comboGroups.sec_combo.combinations).toHaveLength(1);
      expect(deserialized.lf['lf__t1'].comboGroups.sec_combo.combinations[0].f_note).toBe('custom');
    });
  });

  it('dealCenterData built from calculator entries resolves the dcField on reopen', () => {
    // Saved job state has the locked field blank (stored blank at save time).
    const saved: any = {
      v1: { 'v1__t1': { sectionFields: { sec_extras: { f_wedges: '' } } } },
    };
    const deserialized = deserializeDynamicJobStateFromStorage(
      serializeDynamicJobStateForStorage(saved, config, {}),
      config,
    );

    // The resulted calculator's entries carry an entry named 'wedges_count'.
    const entries = {
      field_x: { fieldId: 'field_x', name: 'wedges_count', inputValue: 5, label: 'Wedges' },
    };
    const dcd = buildDealCenterData({ entries, resultData: {}, schemas: [], lead: {} });
    expect(dcd.wedges_count).toBe(5);

    const hydrated = hydrateJobStateForPersistence(deserialized, config, dcd);
    expect(hydrated.v1['v1__t1'].sectionFields.sec_extras.f_wedges).toBe(5);

    // Empty entries → dcField unresolved → value stays blank (documents the bug
    // that the resulted-calculator dealCenterData source prevents).
    const dcdEmpty = buildDealCenterData({ entries: {}, resultData: {}, schemas: [], lead: {} });
    const hydratedBlank = hydrateJobStateForPersistence(deserialized, config, dcdEmpty);
    expect(hydratedBlank.v1['v1__t1'].sectionFields.sec_extras.f_wedges).toBe('');
  });
});
