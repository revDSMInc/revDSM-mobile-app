export interface DealEditLoadState {
  configLoading: boolean;
  schemasLoading: boolean;
  outcomeFetched: boolean;
  calculatorLoading: boolean;
  portalLoading: boolean;
}

export function isDealEditLoading(s: DealEditLoadState): boolean {
  return (
    s.configLoading ||
    s.schemasLoading ||
    !s.outcomeFetched ||
    s.calculatorLoading ||
    s.portalLoading
  );
}

export function showsCannotEdit(
  load: DealEditLoadState,
  deal: { hasJobBuilderConfig: boolean; isDynamicDeal: boolean; builderReady: boolean },
): boolean {
  if (isDealEditLoading(load)) return false;
  return !deal.hasJobBuilderConfig || !deal.isDynamicDeal || !deal.builderReady;
}
