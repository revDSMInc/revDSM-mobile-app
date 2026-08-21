import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { JobBuilderConfig, JobState, Vertical } from '../../utils/dynamic-job-builder/types';
import { createEmptyVertical, createEmptyTab } from '../../utils/dynamic-job-builder/constants/default-config';
import { buildInitialJobState, computePreviewSnapshot } from '../../utils/dynamic-job-builder/engine/preview-compute';
import { getLockedTabIds } from '../../utils/dynamic-job-builder/engine/dependency-engine';
import { migrateConfigTabFields } from '../../utils/dynamic-job-builder/engine/combination-utils';

interface UseDynamicJobBuilderSessionOptions {
  initialConfig?: JobBuilderConfig;
  initialJobState?: JobState;
  /**
   * Web parity (`stateResetKey`, dynamic-job-builder.js:165-173). Identity token for
   * the LOADED DRAFT — pass the RAW saved state from the server. Whenever it changes
   * a genuinely new draft arrived, so it is applied unconditionally (web resets its
   * session on a restore). Re-renders that merely re-derive `initialJobState` (e.g.
   * `dealCenterData` settling) do NOT change this token, so a rep's edits are never
   * clobbered. Omit to keep the legacy "apply until first edit" behaviour.
   */
  draftToken?: any;
  /**
   * Has the draft READ finished (regardless of whether it found anything)?
   * Supply it whenever `draftToken` is used — it is what lets the restore latch on a
   * lead that has NO saved draft yet. See the effect below.
   */
  draftSettled?: boolean;
  dealCenterData?: any;
  onJobStateChange?: (state: JobState) => void;
}

export function useDynamicJobBuilderSession(options: UseDynamicJobBuilderSessionOptions = {}) {
  const { initialConfig, initialJobState, draftToken, draftSettled, dealCenterData, onJobStateChange } =
    options;

  const [config, setConfig] = useState<JobBuilderConfig>(() => {
    // No mock/default fallback: the screen only mounts this hook once a real
    // backend config is present. An empty config is the safe inert default.
    const cfg = initialConfig || ({ name: '', verticals: [] } as JobBuilderConfig);
    return migrateConfigTabFields(cfg);
  });

  const [jobState, setJobState] = useState<JobState>(() => {
    if (initialJobState) return initialJobState;
    return buildInitialJobState(config, dealCenterData);
  });

  // React to async-fetched initialJobState (e.g., from the outcome GET on mount).
  //
  // Web parity (JobBuilderContext.applyDraftState): the saved draft is applied when
  // it becomes available AND re-applied if it changes (the outcome GET and the
  // dealCenterData-driven re-hydration can settle across several renders) — right up
  // until the rep actually edits a field, at which point THEIR state takes over and
  // the incoming draft must never clobber it. The previous one-shot guard latched on
  // the FIRST truthy value: if that first value was hydrated before dealCenterData
  // was ready, the corrected re-hydration never got applied (locked/dc fields stayed
  // blank); and if the GET resolved slower than a keystroke, the late draft wiped the
  // rep's edit. We track "has the user edited yet" separately and re-apply the latest
  // draft reference until they do.
  const userEditedRef = useRef(false);
  const lastAppliedInitialRef = useRef<JobState | undefined>(undefined);
  const lastDraftTokenRef = useRef<any>(undefined);
  useEffect(() => {
    // Web parity (dynamic-job-builder.js `stateResetKey` effect): when a NEW draft is
    // loaded it is applied unconditionally — web only skips when the key is unchanged,
    // and clears its per-session nav flag on restore. Mobile's old guard latched
    // `userEditedRef` on the FIRST write of any kind and then refused the draft
    // FOREVER, so any write landing before the outcome GET resolved permanently blanked
    // the reopened deal ("prefilled statuses don't show like web"). Keying off the raw
    // saved state restores web's behaviour without re-clobbering edits: the token only
    // changes when the server actually returns a different draft.
    if (draftToken !== undefined) {
      if (lastDraftTokenRef.current === draftToken) return;

      // ⚠️ LATCH ON THE READ SETTLING, NOT ON A TRUTHY DRAFT.
      //
      // The guard used to sit at the top of this effect as `if (!initialJobState) return;`,
      // so a lead whose outcome GET found NOTHING (every brand-new lead) never latched the
      // token — and then the FIRST draft to arrive at ANY later moment was applied
      // unconditionally, wiping whatever the rep had done in the meantime.
      //
      // That is a real flow, not a theoretical one: `commitUploaded` invalidates
      // ['leadOutcome', leadId] after an agreement is filed, so signing an agreement
      // REFETCHES this draft — and by then the server holds the draft written by the
      // 2 s autosave that ran when the appointment was scheduled. That draft carries
      // `scheduleTime` and no `agreements`, so restoring it deleted the agreement the rep
      // had just signed, and the next autosave persisted the state without it.
      // (`useLeadReports` invalidates the same key, so this was never limited to one flow.)
      //
      // A settled read that found nothing means there is nothing to restore, ever: any
      // state the server holds from then on was written BY THIS SESSION.
      if (draftSettled === undefined) {
        // Caller supplied no signal — keep the old behaviour (latch on a real draft).
        if (!initialJobState) return;
      } else if (!draftSettled) {
        // Still loading. Waiting here is what preserves the blank-tab fix: a draft that
        // lands after an early write is still applied, exactly as before.
        return;
      }

      lastDraftTokenRef.current = draftToken;
      if (!initialJobState) return;
      lastAppliedInitialRef.current = initialJobState;
      userEditedRef.current = false; // fresh draft → fresh session (web: userNavigatedRef = false)
      setJobState(initialJobState);
      return;
    }

    // Legacy path (no token supplied): apply until the rep's first real edit.
    if (!initialJobState) return;
    if (userEditedRef.current) return;
    if (lastAppliedInitialRef.current === initialJobState) return;
    lastAppliedInitialRef.current = initialJobState;
    setJobState(initialJobState);
  }, [initialJobState, draftToken, draftSettled]);

  const lockedTabIdsByVertical = useMemo(() => {
    const result: Record<string, string[]> = {};
    (config.verticals || []).forEach((v: any) => {
      // Pass dealCenterData so tab visibility rules have access to dealCenterData variables
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
      // A field edit is a real user edit → freeze out any late-arriving draft from
      // the outcome GET so it can't overwrite what the rep just typed.
      userEditedRef.current = true;
      // Resolve a functional updater INSIDE the setter, against React's latest
      // `prev`, so multiple edits in one tick chain instead of clobbering (web
      // parity). Accepts a concrete object too (backward compatible).
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

  // Write a ROOT-level key on jobState (scheduleTime / agreements / orderSheets).
  // Storage already round-trips these as pass-through keys; this is the missing
  // writer so the summary tab can persist appointment + document state.
  const updateRootState = useCallback(
    (key: string, value: any) => {
      // Setting appointment / agreement / order-sheet is a real user edit too.
      userEditedRef.current = true;
      updateJobState((prev) => ({ ...prev, [key]: value }));
    },
    [updateJobState]
  );

  // Remove a root-level key (used for the demo → clear scheduleTime rule).
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
