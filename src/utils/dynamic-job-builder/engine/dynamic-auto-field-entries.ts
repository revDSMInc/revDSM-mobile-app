export async function fetchAutoFieldEntries(leadId: string, calculatorData: any) {
  if (!leadId || !calculatorData) return {};
  return {};
}

export function resolveAutoFieldEntries(config: any, dealCenterData: any = {}) {
  const entries: Record<string, any> = {};

  (config?.verticals || []).forEach((vertical: any) => {
    (vertical.tabs || []).forEach((tab: any) => {
      if (tab.isSummary) return;
      (tab.fields || []).forEach((field: any) => {
        if (field.dcField && dealCenterData[field.dcField] !== undefined) {
          entries[field.id] = dealCenterData[field.dcField];
        }
      });
    });
  });

  return entries;
}
