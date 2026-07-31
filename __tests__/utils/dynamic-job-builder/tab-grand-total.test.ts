import {
  computeTabCombinationsGrandTotal,
  getTabGrandTotalUnit,
  buildTabTotalLabel,
} from '../../../src/utils/dynamic-job-builder/engine/grand-total-utils';

// Web parity: `TabCombinationsGrandTotalSummary` sums combos across EVERY
// combination section in the tab (Gutter + LeafFilter), not just the last one.
// This was the bug: mobile fed the card a single section's combos so the
// Gutter+LeafFilter grand total came up short (LeafFilter only).

// A combo locationGrid value is { story: { cell: number } } (see computeGridTotal).
const grid = (n: number) => ({ s1: { c1: n } });

const gutterSection = {
  id: 'gutter',
  label: 'Gutter',
  fields: [{ id: 'g_len', key: 'g_len', type: 'locationGrid', unit: 'FT' }],
};
const leafSection = {
  id: 'leaffilter',
  label: 'LeafFilter',
  fields: [{ id: 'lf_len', key: 'lf_len', type: 'locationGrid', unit: 'FT' }],
};

describe('computeTabCombinationsGrandTotal — Gutter + LeafFilter aggregation', () => {
  test('sums locationGrid footage across BOTH sections', () => {
    const entries = [
      { combo: { g_len: grid(30) }, section: gutterSection, summaryField: null, displayNumber: 1 },
      { combo: { lf_len: grid(45) }, section: leafSection, summaryField: null, displayNumber: 2 },
    ];
    // 30 (gutter) + 45 (leaffilter) = 75 — NOT just the last section's 45.
    expect(computeTabCombinationsGrandTotal(entries)).toBe(75);
  });

  test('sums multiple combos within each section too', () => {
    const entries = [
      { combo: { g_len: grid(10) }, section: gutterSection, summaryField: null, displayNumber: 1 },
      { combo: { g_len: grid(20) }, section: gutterSection, summaryField: null, displayNumber: 2 },
      { combo: { lf_len: grid(5) }, section: leafSection, summaryField: null, displayNumber: 3 },
    ];
    expect(computeTabCombinationsGrandTotal(entries)).toBe(35);
  });

  test('empty entries → 0', () => {
    expect(computeTabCombinationsGrandTotal([])).toBe(0);
  });

  test('unit + label resolve from the entries / tab', () => {
    const entries = [{ combo: { g_len: grid(30) }, section: gutterSection, summaryField: null }];
    expect(getTabGrandTotalUnit(entries)).toBe('FT');
    expect(buildTabTotalLabel('Gutter and LeafFilter')).toBe('TOTAL GUTTER AND LEAFFILTER');
  });
});
