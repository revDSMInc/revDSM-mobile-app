import { getTabSections, getFlattenedCombinationSectionRowFields, flattenLeafFields } from './combination-utils';
import { formatComboFieldSummaryValue, resolveGrandTotalColumns } from './grand-total-utils';
import { computeGridTotal } from './allocation-utils';

export function buildVerticalSummarySections(vertical: any, verticalState: any = {}, ctx: any = {}) {
  const { lockedTabIds = [], dealCenterData = {} } = ctx;
  const lockedSet = new Set(lockedTabIds);
  const sections: any[] = [];

  (vertical.tabs || []).forEach((tab: any) => {
    if (tab.isSummary) return;
    if (lockedSet.has(tab.id)) return;

    const tabState = verticalState?.[tab.id] || {};
    const tabSections = getTabSections(tab);
    const combinationSections = tabSections.filter((s: any) => s.sectionType !== 'simple');
    const simpleSections = tabSections.filter((s: any) => s.sectionType === 'simple');

    const combinationEntries: any[] = [];
    const simpleEntries: any[] = [];

    combinationSections.forEach((section) => {
      const combos = tabState?.comboGroups?.[section.id]?.combinations || [];
      combos.forEach((combo: any, index: number) => {
        const columns = resolveGrandTotalColumns(section.fields || []);
        const summaryLine = columns
          .map((col) => {
            const { text, variant } = formatComboFieldSummaryValue(col, combo);
            return variant !== 'missing' ? `${col.label}: ${text}` : null;
          })
          .filter(Boolean)
          .join(' | ');

        combinationEntries.push({
          displayNumber: combo._combinationNumber || index + 1,
          summaryLine,
          locationRows: [],
          comboFieldRows: columns.map((col) => formatComboFieldSummaryValue(col, combo)),
          comboExtras: [],
        });
      });
    });

    simpleSections.forEach((section) => {
      const sectionState = tabState?.sectionFields?.[section.id] || {};
      (section.fields || []).forEach((field: any) => {
        if (field.type === 'sectionLabel' || field.type === 'allocation') return;
        const value = sectionState[field.id];
        if (value !== undefined && value !== '' && value !== null) {
          simpleEntries.push({
            label: field.label || field.key,
            text: String(value),
            variant: 'value',
          });
        }
      });
    });

    sections.push({
      tabId: tab.id,
      tabLabel: tab.label,
      accentColor: vertical.color || '#22c55e',
      combinationSections: combinationEntries.length > 0 ? [{
        sectionId: 'default',
        sectionLabel: '',
        combinations: combinationEntries,
        extras: [],
        extrasLabel: '',
      }] : [],
      simpleSections: [],
      tabFields: simpleEntries,
      isEmpty: combinationEntries.length === 0 && simpleEntries.length === 0,
    });
  });

  return sections;
}
