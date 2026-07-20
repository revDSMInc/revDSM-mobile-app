/**
 * Empty-step gate predicate — the "No details on this step yet" decision.
 *
 * Source of truth: web `dynamic-job-builder.js` `stateHasContent` (lines 40-60) &
 * `collectLockedFieldIds` (lines 62-77), commit 301a2fdc.
 *
 * Ticket: "My Deals > Display Empty State for Unconfigured Job Builder Steps" —
 * a step whose saved state holds only calculator-seeded (locked) values, or
 * nothing, must read as empty so the rep gets the Add-details / Skip prompt.
 */
import {
  stateHasContent,
  collectLockedFieldIds,
} from '../../../src/utils/dynamic-job-builder/engine/empty-step-gate';

describe('stateHasContent — scalar rules', () => {
  it('treats empty / zero / falsy scalars as no content', () => {
    expect(stateHasContent(null)).toBe(false);
    expect(stateHasContent(undefined)).toBe(false);
    expect(stateHasContent(0)).toBe(false);
    expect(stateHasContent(false)).toBe(false);
    expect(stateHasContent('')).toBe(false);
    expect(stateHasContent('   ')).toBe(false);
    expect(stateHasContent('0')).toBe(false);
    expect(stateHasContent('0.0')).toBe(false);
  });

  it('treats real values as content', () => {
    expect(stateHasContent(5)).toBe(true);
    expect(stateHasContent(true)).toBe(true);
    expect(stateHasContent('Versa')).toBe(true);
    expect(stateHasContent('6"')).toBe(true);
    expect(stateHasContent('12')).toBe(true);
  });
});

describe('stateHasContent — arrays & objects', () => {
  it('empty array / object are no content', () => {
    expect(stateHasContent([])).toBe(false);
    expect(stateHasContent({})).toBe(false);
  });

  it('an array counts when any element has content', () => {
    expect(stateHasContent([0, '', null])).toBe(false);
    expect(stateHasContent([0, 'Blue'])).toBe(true);
  });

  it('skips structural keys', () => {
    expect(stateHasContent({ colorValues: { x: 'Blue' } })).toBe(false);
    expect(stateHasContent({ _combinationNumber: 3 })).toBe(false);
    expect(stateHasContent({ _storageVersion: 2 })).toBe(false);
  });

  it('recurses into nested combination state', () => {
    const tabState = {
      comboGroups: {
        sec1: { combinations: [{ f1: 0, f2: '', colorValues: {} }] },
      },
    };
    expect(stateHasContent(tabState)).toBe(false);

    const withEntry = {
      comboGroups: {
        sec1: { combinations: [{ f1: 0 }, { f2: 25 }] },
      },
    };
    expect(stateHasContent(withEntry)).toBe(true);
  });
});

describe('stateHasContent — locked fields do not count (the ticket)', () => {
  // The reported bug: a LeafFilter step carrying only calculator-seeded values
  // (LeafFilter Profile = "Versa", Gutter Opening Width = 6") must read as EMPTY.
  const locked = new Set(['leaffilter_profile', 'gutter_opening_width']);

  const stepWith = (combo: any) => ({ comboGroups: { sec1: { combinations: [combo] } } });

  it('reads as content when locked fields are NOT excluded (the pre-fix behaviour)', () => {
    const tabState = stepWith({ leaffilter_profile: 'Versa', gutter_opening_width: '6"', colorValues: {} });
    // No locked set passed → the seeded values look like real input. This is
    // exactly why the screen must pass `lockedFieldIds`.
    expect(stateHasContent(tabState)).toBe(true);
  });

  it('reads as EMPTY once the locked ids are excluded (the fix)', () => {
    const tabState = stepWith({ leaffilter_profile: 'Versa', gutter_opening_width: '6"', colorValues: {} });
    expect(stateHasContent(tabState, locked)).toBe(false);
  });

  it('a rep-entered value alongside locked ones DOES count', () => {
    const tabState = stepWith({ leaffilter_profile: 'Versa', downspout_footage: 40, colorValues: {} });
    expect(stateHasContent(tabState, locked)).toBe(true);
  });
});

describe('stateHasContent — locked-key exclusion is direct', () => {
  it('excludes a top-level locked key', () => {
    expect(stateHasContent({ a: 'Versa' }, new Set(['a']))).toBe(false);
    expect(stateHasContent({ a: 'Versa', b: 'Copper' }, new Set(['a']))).toBe(true);
  });
});

describe('collectLockedFieldIds', () => {
  const config = {
    verticals: [
      {
        tabs: [
          {
            id: 't1',
            fields: [
              { id: 'direct_locked', locked: true },
              { id: 'direct_plain' },
            ],
            sections: [
              {
                fields: [
                  { id: 'sec_locked_type', type: 'locked' },
                  { id: 'sec_locked_color', type: 'lockedWithColor' },
                  { id: 'sec_plain', type: 'number' },
                  // nested container field
                  { id: 'container', fields: [{ id: 'nested_locked', locked: true }] },
                ],
              },
            ],
          },
          { id: 'summary', isSummary: true, fields: [{ id: 'ignored', locked: true }] },
        ],
      },
    ],
  };

  it('collects every locked field id across fields/sections/nesting', () => {
    const ids = collectLockedFieldIds(config);
    expect(ids.has('direct_locked')).toBe(true);
    expect(ids.has('sec_locked_type')).toBe(true);
    expect(ids.has('sec_locked_color')).toBe(true);
    expect(ids.has('nested_locked')).toBe(true);
    // the summary tab's locked field is walked too (web walks every tab)
    expect(ids.has('ignored')).toBe(true);
  });

  it('does not collect plain fields', () => {
    const ids = collectLockedFieldIds(config);
    expect(ids.has('direct_plain')).toBe(false);
    expect(ids.has('sec_plain')).toBe(false);
  });

  it('is safe on an empty / malformed config', () => {
    expect(collectLockedFieldIds(null).size).toBe(0);
    expect(collectLockedFieldIds({}).size).toBe(0);
    expect(collectLockedFieldIds({ verticals: [] }).size).toBe(0);
  });
});
