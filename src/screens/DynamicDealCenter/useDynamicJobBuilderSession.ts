import { useState, useCallback, useMemo } from 'react';
import type { JobBuilderConfig, JobState, Vertical, Tab } from '../../utils/dynamic-job-builder/types';
import { createEmptyVertical, createEmptyTab, createDefaultJobBuilderConfig } from '../../utils/dynamic-job-builder/constants/default-config';
import { buildInitialJobState, computePreviewSnapshot } from '../../utils/dynamic-job-builder/engine/preview-compute';
import { getLockedTabIds } from '../../utils/dynamic-job-builder/engine/dependency-engine';
import { migrateConfigTabFields } from '../../utils/dynamic-job-builder/engine/combination-utils';

interface UseDynamicJobBuilderSessionOptions {
  initialConfig?: JobBuilderConfig;
  initialJobState?: JobState;
  onJobStateChange?: (state: JobState) => void;
}

export function useDynamicJobBuilderSession(options: UseDynamicJobBuilderSessionOptions = {}) {
  const { initialConfig, initialJobState, onJobStateChange } = options;

  const [config, setConfig] = useState<JobBuilderConfig>(() => {
    const cfg = initialConfig || createDefaultJobBuilderConfig();
    return migrateConfigTabFields(cfg);
  });

  const [jobState, setJobState] = useState<JobState>(() => {
    if (initialJobState) return initialJobState;
    return buildInitialJobState(config);
  });

  const lockedTabIds = useMemo(() => {
    const vertical = config.verticals?.[0];
    return getLockedTabIds(vertical, jobState[vertical?.id] || {});
  }, [config, jobState]);

  const previewSnapshot = useMemo(
    () => computePreviewSnapshot({ config, dealCenterData: jobState }),
    [config, jobState, lockedTabIds]
  );

  const updateJobState = useCallback(
    (updater: (prev: JobState) => JobState) => {
      setJobState((prev) => {
        const next = updater(prev);
        onJobStateChange?.(next);
        return next;
      });
    },
    [onJobStateChange]
  );

  const updateTabState = useCallback(
    (verticalId: string, tabId: string, tabState: any) => {
      updateJobState((prev) => ({
        ...prev,
        [verticalId]: { ...(prev[verticalId] || {}), [tabId]: tabState },
      }));
    },
    [updateJobState]
  );

  const updateVertical = useCallback(
    (verticalId: string, updater: (v: Vertical) => Vertical) => {
      setConfig((prev) => ({
        ...prev,
        verticals: prev.verticals.map((v) => (v.id === verticalId ? updater(v) : v)),
      }));
    },
    []
  );

  const addVertical = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      verticals: [...prev.verticals, createEmptyVertical()],
    }));
  }, []);

  const removeVertical = useCallback((verticalId: string) => {
    setConfig((prev) => ({
      ...prev,
      verticals: prev.verticals.filter((v) => v.id !== verticalId),
    }));
    setJobState((prev) => {
      const next = { ...prev };
      delete next[verticalId];
      return next;
    });
  }, []);

  const addTab = useCallback(
    (verticalId: string) => {
      updateVertical(verticalId, (v) => ({
        ...v,
        tabs: [...(v.tabs || []), createEmptyTab(verticalId)],
      }));
    },
    [updateVertical]
  );

  const removeTab = useCallback(
    (verticalId: string, tabId: string) => {
      updateVertical(verticalId, (v) => ({
        ...v,
        tabs: (v.tabs || []).filter((t) => t.id !== tabId),
      }));
      setJobState((prev) => {
        const next = { ...prev };
        if (next[verticalId]) {
          const vState = { ...next[verticalId] };
          delete vState[tabId];
          next[verticalId] = vState;
        }
        return next;
      });
    },
    [updateVertical]
  );

  return {
    config,
    setConfig,
    jobState,
    setJobState,
    lockedTabIds,
    previewSnapshot,
    updateJobState,
    updateTabState,
    updateVertical,
    addVertical,
    removeVertical,
    addTab,
    removeTab,
  };
}
