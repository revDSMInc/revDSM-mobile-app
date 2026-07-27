/**
 * Shared parity case definitions for the regular (lf-calculator) calculation
 * engine. Consumed by:
 *   - __tests__/_generators/parity-golden.gen.ts (computes the WEB result → golden JSON)
 *   - __tests__/Parity.test.ts                    (computes the MOBILE result → compares to golden)
 *
 * Keeping the inputs in one place guarantees the generator and the test feed the
 * exact same arguments, so the golden JSON is a faithful web-vs-mobile snapshot.
 *
 * `details` for the web engine is always a FLAT object. Where a case also wants
 * to prove the mobile engine handles a NESTED { inputs, extras } shape identically,
 * the nested form is provided in `mobileNested`.
 */

export interface ParityCase {
  key: string;
  details: any; // flat details — fed to BOTH web and mobile
  mobileNested?: any; // optional nested shape — mobile must match the same golden
  markupKey: string;
  paymentMethod: string;
  isLowesLead?: boolean;
  ckToInstallers?: number;
}

const gutterVersa = { gutter5DsE: '100', versa6Ft1: '50', paymentMethod: 'wf4103' };
const withExtras = { ...gutterVersa, extraLabor: '15', wedges: '10' };
const withScreens = {
  gutter5DsE: '100',
  versa6Ft1: '50',
  ckToInstallers: '20',
  screens: '20',
  paymentMethod: 'wf4103',
};

const nestedFlat = {
  gutter6Ft1: '45',
  versaMaxFt1: '225',
  versa6Ft1: '80',
  extraLabor: '23',
  wedges: '60',
  paymentPlan: 'check',
};
const nestedShape = {
  _id: 'calc-1',
  inputs: {
    gutter6Ft1: '45',
    versaMaxFt1: '225',
    versa6Ft1: '80',
    extraLabor: '23',
    paymentPlan: 'check',
  },
  extras: { wedges: '60', extraLabor: '23' },
};

const extraLaborFlat = {
  gutter6Ft1: '45',
  versaMaxFt1: '225',
  versa6Ft1: '80',
  extraLabor: '1',
  wedges: '60',
  paymentPlan: 'check',
};
const extraLaborNested = {
  inputs: { gutter6Ft1: '45', versaMaxFt1: '225', versa6Ft1: '80', extraLabor: '1', paymentPlan: 'check' },
  extras: { wedges: '60', extraLabor: '' },
};

const filterFlat = {
  gutter6Ft1: '45',
  versaMaxFt1: '225',
  versa6Ft1: '80',
  filter45Ft3: '2',
  wedges: '60',
};
const filterNested = {
  inputs: { gutter6Ft1: '45', versaMaxFt1: '225', versa6Ft1: '80', filter45Ft3: '2' },
  extras: { wedges: '60' },
};

const verticalFlat = {
  gutter6Ft1: '45',
  versaMaxFt1: '225',
  versa6Ft1: '80',
  wedges: '60',
  rfShngl3Tab: '10',
  winSH_VinylStd: '5',
  flMatCarpet: '200',
  rmTubReplace: '1',
};
const verticalNested = {
  inputs: { gutter6Ft1: '45', versaMaxFt1: '225', versa6Ft1: '80' },
  extras: { wedges: '60' },
  rfShngl3Tab: '10',
  winSH_VinylStd: '5',
  flMatCarpet: '200',
  rmTubReplace: '1',
};

const markups = ['50', '65', '100'];

function expand(
  base: string,
  cfg: Omit<ParityCase, 'key' | 'markupKey'>,
  keys: string[] = markups,
): ParityCase[] {
  return keys.map((markupKey) => ({ ...cfg, markupKey, key: `${base}#${markupKey}` }));
}

export const PARITY_CASES: ParityCase[] = [
  ...expand('gutterVersa', { details: gutterVersa, paymentMethod: 'wf4103' }),
  ...expand('withExtras', { details: withExtras, paymentMethod: 'wf4103' }),
  ...expand('withScreens', { details: withScreens, paymentMethod: 'wf4103', ckToInstallers: 20 }),
  ...expand(
    'nested',
    { details: nestedFlat, mobileNested: nestedShape, paymentMethod: 'check' },
    ['50', '100'],
  ),
  ...expand('extraLabor', { details: extraLaborFlat, mobileNested: extraLaborNested, paymentMethod: 'check' }),
  ...expand('filter45', { details: filterFlat, mobileNested: filterNested, paymentMethod: 'check' }),
  ...expand('vertical', { details: verticalFlat, mobileNested: verticalNested, paymentMethod: 'check' }),
];
