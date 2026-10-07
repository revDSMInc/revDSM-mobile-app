import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { JobBuilderConfig, JobState, Vertical } from '../../utils/dynamic-job-builder/types';
import { createEmptyVertical, createEmptyTab } from '../../utils/dynamic-job-builder/constants/default-config';
import { buildInitialJobState, computePreviewSnapshot } from '../../utils/dynamic-job-builder/engine/preview-compute';
import { getLockedTabIds } from '../../utils/dynamic-job-builder/engine/dependency-engine';
import { migrateConfigTabFields } from '../../utils/dynamic-job-builder/engine/combination-utils';

interface UseDynamicJobBuilderSessionOptions {
  initialConfig?: JobBuilderConfig;
  initialJobState?: JobState;
  draftToken?: any;
  draftSettled?: boolean;
  dealCenterData?: any;
  onJobStateChange?: (state: JobState) => void;
}

export function useDynamicJobBuilderSession(options: UseDynamicJobBuilderSessionOptions = {}) {
  const { initialConfig, initialJobState, draftToken, draftSettled, dealCenterData, onJobStateChange } =
    options;

  const [config, setConfig] = useState<JobBuilderConfig>(() => {
    const cfg = initialConfig || ({ name: '', verticals: [] } as JobBuilderConfig);
    return migrateConfigTabFields(cfg);
  });

  const [jobState, setJobState] = useState<JobState>(() => {
    if (initialJobState) return initialJobState;
    return buildInitialJobState(config, dealCenterData);
  });

  const userEditedRef = useRef(false);
  const lastAppliedInitialRef = useRef<JobState | undefined>(undefined);
  const lastDraftTokenRef = useRef<any>(undefined);
  useEffect(() => {
    if (draftToken !== undefined) {
      if (lastDraftTokenRef.current === draftToken) return;

      if (draftSettled === undefined) {
        if (!initialJobState) return;
      } else if (!draftSettled) {
        return;
      }

      lastDraftTokenRef.current = draftToken;
      if (!initialJobState) return;
      lastAppliedInitialRef.current = initialJobState;
      userEditedRef.current = false; // fresh draft → fresh session (web: userNavigatedRef = false)
      setJobState(initialJobState);
      return;
    }

    if (!initialJobState) return;
    if (userEditedRef.current) return;
    if (lastAppliedInitialRef.current === initialJobState) return;
    lastAppliedInitialRef.current = initialJobState;
    setJobState(initialJobState);
  }, [initialJobState, draftToken, draftSettled]);

  const lockedTabIdsByVertical = useMemo(() => {
    const result: Record<string, string[]> = {};
    (config.verticals || []).forEach((v: any) => {
      result[v.id] = getLockedTabIds(v, dealCenterData || {});
    });
    return result;
  }, [config, dealCenterData]);

  const lockedTabIds = useMemo(() => {
    const firstV = config.verticals?.[0];
    return firstV ? lockedTabIdsByVertical[firstV.id] || [] : [];
  }, [config, lockedTabIdsByVertical]);

  const previewSnapshot = useMemo(
    () => computePreviewSnapshot({ config, dealCenterData: dealCenterData || {} }),
    [config, dealCenterData]
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
    (verticalId: string, tabId: string, tabStateOrUpdater: any) => {
      userEditedRef.current = true;
      updateJobState((prev) => {
        const currentTabState = prev[verticalId]?.[tabId] || {};
        const nextTabState =
          typeof tabStateOrUpdater === 'function'
            ? tabStateOrUpdater(currentTabState)
            : tabStateOrUpdater;
        return {
          ...prev,
          [verticalId]: { ...(prev[verticalId] || {}), [tabId]: nextTabState },
        };
      });
    },
    [updateJobState]
  );

  const updateRootState = useCallback(
    (key: string, value: any) => {
      userEditedRef.current = true;
      updateJobState((prev) => ({ ...prev, [key]: value }));
    },
    [updateJobState]
  );

  const clearRootState = useCallback(
    (key: string) => {
      updateJobState((prev) => {
        if (prev[key] === undefined) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
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
    lockedTabIdsByVertical,
    previewSnapshot,
    updateJobState,
    updateTabState,
    updateRootState,
    clearRootState,
    updateVertical,
    addVertical,
    removeVertical,
    addTab,
    removeTab,
  };
}
