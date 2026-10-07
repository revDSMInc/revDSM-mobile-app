import { extrasList } from './pricing-data';
import { getVerticalItemIds } from './verticals-data';
import { toWebFlatCalculator } from './calculator-field-map';

export const normalizeCalculatorData = (details: any) => {
  if (!details) return { inputs: {}, extras: {}, flat: {} };

  const flat = toWebFlatCalculator(details);

  const inputs = {
    gutter5DsE: flat.gutter5DsE ?? null,
    gutter6Ft1: flat.gutter6Ft1 ?? null,
    gutter7DsE: flat.gutter7DsE ?? null,

    versaMaxFt1: flat.versaMaxFt1 ?? null,
    versa6Ft1: flat.versa6Ft1 ?? null,
    versa6Ft2: flat.versa6Ft2 ?? null,
    versa6Ft3: flat.versa6Ft3 ?? null,
    versa7Ft1: flat.versa7Ft1 ?? null,
    versa7Ft2: flat.versa7Ft2 ?? null,
    versa7Ft3: flat.versa7Ft3 ?? null,

    filter45Ft1: flat.filter45Ft1 ?? null,
    filter45Ft2: flat.filter45Ft2 ?? null,
    filter45Ft3: flat.filter45Ft3 ?? null,

    screens: flat.screens ?? null,
    ckToInstallers: flat.ckToInstallers ?? null,
  };

  const extras = Object.fromEntries(
    extrasList
      .filter((e) => e.id !== 'gutter7DsE')
      .map((e) => [e.id, flat[e.id] ?? null])
  );

  const verticals: Record<string, any> = {};
  getVerticalItemIds().forEach((id) => {
    verticals[id] = flat[id] ?? null;
  });

  return { inputs, extras, verticals, flat };
};

export const flattenCalculatorDetails = toWebFlatCalculator;
