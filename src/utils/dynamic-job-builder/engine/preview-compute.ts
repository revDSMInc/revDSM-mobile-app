import { getTabSections, buildDefaultItemFromFields, buildComboGroupDefaultItem, buildComboGroupSectionState } from './combination-utils';
import { getLockedTabIds, getPreviewLockedTabIds } from './dependency-engine';

export const JOB_BUILDER_PREVIEW_TASKS = {
  COMPUTE_PREVIEW_SNAPSHOT: 'COMPUTE_PREVIEW_SNAPSHOT',
};

export function ensureVerticalSummaryTabs(config: any) {
  if (!config?.verticals?.length) return config;

  return {
    ...config,
    verticals: config.verticals.map((vertical: any) => {
      const hasSummary = vertical.tabs?.some((tab: any) => tab.isSummary);
      if (hasSummary) return vertical;

      // Web parity: never append a summary tab to a vertical that has no
      // product (non-summary) tabs — such verticals get dropped downstream.
      const nonSummaryTabs = (vertical.tabs || []).filter((tab: any) => !tab.isSummary);
      if (!nonSummaryTabs.length) return vertical;

      return {
        ...vertical,
        tabs: [
          ...(vertical.tabs || []),
          {
            id: 'summary',
            label: 'Summary',
            isSummary: true,
            lockedByDefault: false,
            productId: vertical.productId || vertical.id,
            combinations: { enabled: false, defaultItem: {}, fields: [] },
            fields: [],
          },
        ],
      };
    }),
  };
}

export function buildPreviewConfig(config: any) {
  const withSummaryTabs = ensureVerticalSummaryTabs(config);
  const verticals = (withSummaryTabs?.verticals || [])
    .map((vertical: any) => ({
      ...vertical,
      tabs: (vertical.tabs || []).filter((tab: any) => tab?.id),
    }))
    .filter((vertical: any) => vertical.tabs.length > 0);

  return {
    ...withSummaryTabs,
    name: withSummaryTabs?.name?.trim() || 'Untitled Template',
    verticals,
  };
}

export function buildConfigKey(config: any, dealCenterData: any = null) {
  const base = JSON.stringify(
    (config?.verticals || []).map((v: any) => ({
      id: v.id,
      label: v.label,
      tabs: (v.tabs || []).map((t: any) => ({
        id: t.id,
        label: t.label,
        lockedByDefault: t.lockedByDefault,
        dcField: t.dcField,
        dependencies: t.dependencies,
        fields: t.fields,
        combinationGroups: t.combinationGroups,
        combinations: t.combinations,
        isSummary: t.isSummary,
      })),
    }))
  );

  if (!dealCenterData || !Object.keys(dealCenterData).length) {
    return base;
  }

  const dcSignature = Object.entries(dealCenterData)
    .filter(([key]) => !key.startsWith('__'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');

  return `${base}::${dcSignature}`;
}

export function buildInitialJobState(config: any, dealCenterData: any = {}) {
  const state: any = {};

  (config?.verticals || []).forEach((vertical: any) => {
    state[vertical.id] = {};

    (vertical.tabs || []).forEach((tab: any) => {
      const sections = getTabSections(tab);
      const tabState: any = { colorValues: {}, sectionFields: {} };

      const combinationSections = sections.filter((section: any) => section.sectionType !== 'simple');
      const simpleSections = sections.filter((section: any) => section.sectionType === 'simple');

      if (combinationSections.length) {
        tabState.comboGroups = {};
        combinationSections.forEach((section: any) => {
          tabState.comboGroups[section.id] = {
            combinations: [buildComboGroupDefaultItem(section, dealCenterData)],
            sectionState: buildComboGroupSectionState(section, dealCenterData),
          };
        });
      } else if (tab.combinations?.enabled) {
        tabState.combinations = [
          buildDefaultItemFromFields(tab.combinations.fields, tab.combinations.defaultItem, dealCenterData),
        ];
      }

      simpleSections.forEach((section: any) => {
        tabState.sectionFields[section.id] = {
          colorValues: {},
          ...buildDefaultItemFromFields(section.fields, {}, dealCenterData),
        };
      });

      state[vertical.id][tab.id] = tabState;
    });
  });

  return state;
}

export function computeLockedTabIdsByVertical(
  config: any,
  { dealCenterData = {}, simulateDealCenter = false } = {}
) {
  const lockedTabIdsByVertical: Record<string, string[]> = {};

  (config?.verticals || []).forEach((vertical: any) => {
    lockedTabIdsByVertical[vertical.id] = simulateDealCenter
      ? getLockedTabIds(vertical, dealCenterData)
      : getPreviewLockedTabIds(vertical);
  });

  return lockedTabIdsByVertical;
}

export function computePreviewSnapshot({
  config,
  dealCenterData = {},
  simulateDealCenter = false,
}: { config?: any; dealCenterData?: any; simulateDealCenter?: boolean } = {}) {
  const previewConfig = buildPreviewConfig(config);
  const configKey = buildConfigKey(config, dealCenterData);
  const initialState = buildInitialJobState(previewConfig, dealCenterData);
  const lockedTabIdsByVertical = computeLockedTabIdsByVertical(previewConfig, {
    dealCenterData,
    simulateDealCenter,
  });

  return {
    previewConfig,
    configKey,
    initialState,
    lockedTabIdsByVertical,
  };
}

const TASK_HANDLERS: Record<string, any> = {
  [JOB_BUILDER_PREVIEW_TASKS.COMPUTE_PREVIEW_SNAPSHOT]: computePreviewSnapshot,
};

export function runJobBuilderPreviewTask(type: string, payload: any) {
  const handler = TASK_HANDLERS[type];
  if (!handler) {
    throw new Error(`Unknown job builder preview task: ${type}`);
  }
  return handler(payload);
}
