import { isAllocationField } from './allocation-utils';
import {
  buildAllocationStatus,
  isAllocationCardActive,
  normalizeAllocationStatusMessages,
} from './allocation-config-utils';
import { resolveAllocationMetrics } from './allocation-value-resolver';
import { isFieldVisibleWithConditions } from './dependency-engine';

const BADGE_PRIORITY: Record<string, number> = { error: 3, warning: 2, success: 1 };

function pickHigherPriorityStatus(current: any, next: any) {
  if (!next) return current;
  if (!current) return next;
  return (BADGE_PRIORITY[next.type] || 0) > (BADGE_PRIORITY[current.type] || 0) ? next : current;
}

export function resolveAccordionAllocationStatus(accordionField: any, ctx: any = {}) {
  const childFields = accordionField?.fields || [];
  const allocationChildren = childFields.filter(isAllocationField);
  if (!allocationChildren.length) return null;

  const {
    tabState,
    tab,
    section,
    sectionState,
    combos,
    dealCenterData = {},
    value,
    sectionFields,
    applyConditions = true,
  } = ctx;

  const depCtx = { dealCenterData, sectionFields, tab, tabState, section };
  const state = value || sectionState || tabState || {};

  const isChildVisible = (child: any) =>
    isFieldVisibleWithConditions(child, state, depCtx, applyConditions);

  let badge: any = null;
  let evaluatedCount = 0;

  allocationChildren.forEach((child: any, index: number) => {
    if (!isChildVisible(child)) return;
    if (!isAllocationCardActive(child, tabState, tab)) return;

    const statusMessages = normalizeAllocationStatusMessages(child.statusMessages);
    if (!statusMessages.enabled) return;

    const resolved = resolveAllocationMetrics(child, {
      field: child,
      tabState,
      tab,
      section,
      sectionState: sectionState ?? value,
      combos,
      fields: childFields,
      fieldIndex: index,
      dealCenterData,
    });

    evaluatedCount += 1;
    const status = buildAllocationStatus(child, resolved.remaining, child.unit || 'ft');
    if (!status) return;

    if (status.type === 'error') {
      badge = pickHigherPriorityStatus(badge, { type: 'error', label: 'Over Allocated' });
      return;
    }

    if (status.type === 'warning') {
      badge = pickHigherPriorityStatus(badge, { type: 'warning', label: 'Footage remaining' });
      return;
    }

    if (status.type === 'success') {
      badge = pickHigherPriorityStatus(badge, { type: 'success', label: 'Perfectly allocated' });
    }
  });

  if (!evaluatedCount) return null;

  if (badge?.type === 'success') {
    const allPerfect = allocationChildren.every((child: any, index: number) => {
      if (!isChildVisible(child)) return true;
      if (!isAllocationCardActive(child, tabState, tab)) return true;
      if (!normalizeAllocationStatusMessages(child.statusMessages).enabled) return true;

      const resolved = resolveAllocationMetrics(child, {
        field: child,
        tabState,
        tab,
        section,
        sectionState: sectionState ?? value,
        combos,
        fields: childFields,
        fieldIndex: index,
        dealCenterData,
      });

      return buildAllocationStatus(child, resolved.remaining, child.unit || 'ft')?.type === 'success';
    });

    return allPerfect ? badge : null;
  }

  return badge;
}
