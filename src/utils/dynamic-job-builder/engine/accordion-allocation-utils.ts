import { findFieldContextOnTab, normalizeAllocationMetrics } from './allocation-config-utils';
import { resolveAllocationMetrics } from './allocation-value-resolver';

export function resolveAccordionAllocationStatus(field: any, tabState: any, tab: any, dealCenterData: any = {}) {
  if (field?.type !== 'accordion') return null;

  const childFields = field.fields || [];
  const allocationFields = childFields.filter((f: any) => f.type === 'allocation');

  if (!allocationFields.length) return null;

  const statuses = allocationFields.map((allocField: any) => {
    const resolved = resolveAllocationMetrics(allocField, {
      field: allocField,
      tabState,
      tab,
      dealCenterData,
    });
    return {
      field: allocField,
      ...resolved,
    };
  });

  const hasOver = statuses.some((s: any) => s.remaining < 0);
  const hasIncomplete = statuses.some((s: any) => s.remaining > 0);

  if (hasOver) return { type: 'error', message: 'Over allocated' };
  if (hasIncomplete) return { type: 'warning', message: 'Incomplete' };
  return { type: 'success', message: 'Complete' };
}
