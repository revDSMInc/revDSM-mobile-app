import { evaluateRuleGroup } from './dependency-engine';

export function resolveAvailableColors(field: any, dealCenterData: any = {}, state: any = {}) {
  const palette = field?.colors || field?.palette || [];
  const visibilityMap = field?.optionVisibility || {};

  if (!Object.keys(visibilityMap).length) return palette;

  return palette.filter((color: any) => {
    const condition = visibilityMap[color.name];
    if (!condition) return true;
    return evaluateRuleGroup(condition, { dealCenterData, state });
  });
}

export function resolveColorValue(field: any, state: any = {}, dealCenterData: any = {}) {
  const stateColor = state?.[field?.id];
  if (stateColor) return stateColor;

  if (field?.locked && field?.dcField) {
    return dealCenterData[field.dcField] || field.defaultValue || '';
  }

  return field?.defaultValue || '';
}
