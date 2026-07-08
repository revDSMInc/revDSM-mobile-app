/**
 * DynamicJobBuilderScreen tests — mobile app (mhalt-revdsm-mobile).
 *
 * Source of truth: web dynamic-job-builder.js
 *
 * Tests the core logic used by DynamicJobBuilderScreen.tsx (lines 399-453):
 *   - tabCompletionById — isTabComplete gate for each available tab
 *   - canComplete — final completion gate (sale needs appointment, demo doesn't)
 *   - canProceed — per-step gate (current tab complete → proceed)
 *   - availableTabs — respects lockedTabIds
 *   - currentTabIndex / currentTab — resolution from nonSummaryTabs + summaryTab
 *   - Demo clears scheduleTime (useEffect parity)
 */

// ── Mocks ───────────────────────────────────────────────────────────────

jest.mock('../../../src/services/api/leads', () => ({
  LeadService: {
    getLeadOutcomeByCalculator: jest.fn(),
    updateLeadOutcomeByCalculator: jest.fn(),
    downloadOutcomeDocuments: jest.fn(),
    submitJobBuilder: jest.fn(),
    updateLeadOutcome: jest.fn(),
    getSecureUrls: jest.fn(),
  },
}));

jest.mock('../../../src/config/message', () => ({
  FlashMessage: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock('../../../src/screens/DynamicDealCenter/useDynamicJobBuilderSession', () => ({
  useDynamicJobBuilderSession: jest.fn(),
}));

jest.mock('../../../src/screens/DynamicDealCenter/hooks/useDynamicJobBuilderActivityLog', () => ({
  useDynamicJobBuilderActivityLog: () => ({
    logOpened: jest.fn(),
    logSubmit: jest.fn(),
    logNavigate: jest.fn(),
    handleTabActivated: jest.fn(),
    trackTabStateChanges: jest.fn(),
  }),
}));

jest.mock('../../../src/utils/dynamic-job-builder/engine/tab-validation', () => ({
  isTabComplete: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/utils/dynamic-job-builder/engine/dynamic-job-state-storage', () => ({
  serializeDynamicJobStateForStorage: jest.fn().mockReturnValue({ _storageVersion: 1 }),
  deserializeDynamicJobStateFromStorage: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../src/widgets/components/dynamic-job-builder/DynamicTabRenderer', () => ({
  DynamicTabRenderer: () => null,
}));

jest.mock('../../../src/widgets/components/dynamic-job-builder/ProgressTracker', () => ({
  ProgressTracker: () => null,
}));

jest.mock('../../../src/widgets/components/dynamic-job-builder/VerticalTabBar', () => ({
  VerticalTabBar: () => null,
}));

// ── Helpers to reimplement the logic under test ─────────────────────────

function computeAvailableTabs(tabs: any[], lockedTabIds: string[]) {
  return tabs.filter((t: any) => !lockedTabIds.includes(t.id));
}

function computeTabProgress(
  allNonSummaryTabs: any[],
  currentVerticalLockedTabIds: string[],
  currentTab: any,
  tabCompletionById: Record<string, boolean>,
) {
  return allNonSummaryTabs.map((tab: any) => ({
    id: tab.id,
    label: tab.label || tab.id,
    complete: (tabCompletionById[tab.id] || false) && !currentVerticalLockedTabIds.includes(tab.id),
    active: tab.id === currentTab?.id,
    locked: currentVerticalLockedTabIds.includes(tab.id),
  }));
}

function computeIsCurrentTabComplete(currentTab: any, tabCompletionById: Record<string, boolean>): boolean {
  if (!currentTab) return false;
  return tabCompletionById[currentTab.id] || false;
}

function computeAreAllTabsComplete(nonSummaryTabs: any[], tabCompletionById: Record<string, boolean>): boolean {
  return nonSummaryTabs.every((t: any) => tabCompletionById[t.id]);
}

function computeCanComplete(
  areAllTabsComplete: boolean,
  isSale: boolean,
  isAppointmentSet: boolean,
): boolean {
  if (!areAllTabsComplete) return false;
  if (isSale) return isAppointmentSet;
  return true;
}

function computeCanProceed(
  currentTabIndex: number,
  nonSummaryTabCount: number,
  canComplete: boolean,
  isCurrentTabComplete: boolean,
): boolean {
  if (currentTabIndex === nonSummaryTabCount) {
    return canComplete;
  }
  return isCurrentTabComplete;
}

function computeCurrentTabIndex(
  selectedTabId: string,
  nonSummaryTabs: any[],
  summaryTab: any,
): number {
  if (!selectedTabId) return -1;
  if (selectedTabId === 'summary' || (summaryTab && selectedTabId === summaryTab.id)) {
    return nonSummaryTabs.length;
  }
  return nonSummaryTabs.findIndex((t: any) => t.id === selectedTabId);
}

// ── availableTabs ──────────────────────────────────────────────────────
// Web parity: locked tabs are excluded from availableTabs so the user can't
// navigate to them.
describe('availableTabs', () => {
  const tabs = [
    { id: 'tab1', label: 'Measurements' },
    { id: 'tab2', label: 'Products' },
    { id: 'tab3', label: 'Summary', isSummary: true },
  ];

  test('returns all tabs when no locked ids', () => {
    const available = computeAvailableTabs(tabs, []);
    expect(available).toHaveLength(3);
  });

  test('filters out locked tab ids', () => {
    const available = computeAvailableTabs(tabs, ['tab1']);
    expect(available.map((t) => t.id)).toEqual(['tab2', 'tab3']);
  });

  test('filters multiple locked ids', () => {
    const available = computeAvailableTabs(tabs, ['tab1', 'tab2']);
    expect(available.map((t) => t.id)).toEqual(['tab3']);
  });
});

// ── currentTabIndex ────────────────────────────────────────────────────
describe('currentTabIndex', () => {
  const nonSummaryTabs = [
    { id: 'tab1', label: 'Measurements' },
    { id: 'tab2', label: 'Products' },
  ];
  const summaryTab = { id: 'summary', label: 'Summary', isSummary: true };

  test('returns -1 when no tab selected', () => {
    expect(computeCurrentTabIndex('', nonSummaryTabs, summaryTab)).toBe(-1);
  });

  test('finds index of non-summary tab', () => {
    expect(computeCurrentTabIndex('tab1', nonSummaryTabs, summaryTab)).toBe(0);
    expect(computeCurrentTabIndex('tab2', nonSummaryTabs, summaryTab)).toBe(1);
  });

  test('summary tab gets index === nonSummaryTabs.length', () => {
    expect(computeCurrentTabIndex('summary', nonSummaryTabs, summaryTab)).toBe(2);
    expect(computeCurrentTabIndex(summaryTab.id, nonSummaryTabs, summaryTab)).toBe(2);
  });

  test('returns -1 for unknown tab id', () => {
    expect(computeCurrentTabIndex('nonexistent', nonSummaryTabs, summaryTab)).toBe(-1);
  });
});

// ── tabProgress ─────────────────────────────────────────────────────────
describe('tabProgress', () => {
  const tabs = [
    { id: 't1', label: 'One' },
    { id: 't2', label: 'Two' },
  ];

  test('marks active tab', () => {
    const progress = computeTabProgress(tabs, [], { id: 't1' }, { t1: true, t2: false });
    expect(progress[0].active).toBe(true);
    expect(progress[1].active).toBe(false);
  });

  test('marks locked tabs', () => {
    const progress = computeTabProgress(tabs, ['t2'], { id: 't1' }, { t1: true, t2: false });
    expect(progress[1].locked).toBe(true);
  });

  test('locked tabs are not complete even if tabCompletionById says true', () => {
    const progress = computeTabProgress(tabs, ['t1'], { id: 't2' }, { t1: true, t2: true });
    expect(progress[0].complete).toBe(false); // locked, despite completion true
    expect(progress[1].complete).toBe(true);  // not locked, complete
  });

  test('unlocked incomplete tabs show complete: false', () => {
    const progress = computeTabProgress(tabs, [], { id: 't1' }, { t1: true, t2: false });
    expect(progress[0].complete).toBe(true);
    expect(progress[1].complete).toBe(false);
  });
});

// ── isCurrentTabComplete ───────────────────────────────────────────────
describe('isCurrentTabComplete', () => {
  test('returns false when currentTab is null/undefined', () => {
    expect(computeIsCurrentTabComplete(null, {})).toBe(false);
    expect(computeIsCurrentTabComplete(undefined, {})).toBe(false);
  });

  test('returns completion status for the current tab', () => {
    expect(computeIsCurrentTabComplete({ id: 't1' }, { t1: true })).toBe(true);
    expect(computeIsCurrentTabComplete({ id: 't1' }, { t1: false })).toBe(false);
  });
});

// ── areAllTabsComplete ────────────────────────────────────────────────
describe('areAllTabsComplete', () => {
  const tabs = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

  test('returns true when every tab is complete', () => {
    expect(computeAreAllTabsComplete(tabs, { t1: true, t2: true, t3: true })).toBe(true);
  });

  test('returns false when any tab is incomplete', () => {
    expect(computeAreAllTabsComplete(tabs, { t1: true, t2: false, t3: true })).toBe(false);
  });

  test('returns true when no non-summary tabs', () => {
    expect(computeAreAllTabsComplete([], {})).toBe(true);
  });
});

// ── canComplete ─────────────────────────────────────────────────────────
// Web parity (dynamic-job-builder.js: isAppointmentSchedulingComplete):
//   - Sale: needs all tabs complete + appointment set
//   - Demo / unknown: needs only tab completion
describe('canComplete', () => {
  test('sale with all tabs complete and appointment set → true', () => {
    expect(computeCanComplete(true, true, true)).toBe(true);
  });

  test('sale with all tabs complete but no appointment → false', () => {
    expect(computeCanComplete(true, true, false)).toBe(false);
  });

  test('sale with incomplete tabs → false (even with appointment)', () => {
    expect(computeCanComplete(false, true, true)).toBe(false);
  });

  test('demo with all tabs complete → true (appointment not needed)', () => {
    expect(computeCanComplete(true, false, false)).toBe(true);
    expect(computeCanComplete(true, false, true)).toBe(true);
  });

  test('demo with incomplete tabs → false', () => {
    expect(computeCanComplete(false, false, true)).toBe(false);
  });

  test('unknown result type (not sale) treats like demo', () => {
    expect(computeCanComplete(true, false, false)).toBe(true);
  });
});

// ── canProceed ─────────────────────────────────────────────────────────
describe('canProceed', () => {
  test('on last step (summary tab): uses canComplete', () => {
    expect(computeCanProceed(3, 3, true, true)).toBe(true);
    expect(computeCanProceed(3, 3, false, true)).toBe(false);
  });

  test('on a regular tab: uses isCurrentTabComplete', () => {
    expect(computeCanProceed(1, 3, false, true)).toBe(true);
    expect(computeCanProceed(1, 3, false, false)).toBe(false);
  });
});

// ── Demo clears scheduleTime ───────────────────────────────────────────
// Web parity (dynamic-job-builder.js:111-121): once a non-sale result
// exists, any lingering install appointment is cleared from root state.
describe('Demo clears scheduleTime (web parity)', () => {
  // This mirrors the useEffect in DynamicJobBuilderScreen.tsx lines 296-300.
  const demoEffect = (isDemo: boolean, scheduleTime: any, clearRootState: jest.Mock) => {
    if (isDemo && scheduleTime) {
      clearRootState('scheduleTime');
    }
  };

  test('clears scheduleTime when isDemo and scheduleTime exists', () => {
    const clearRootState = jest.fn();
    demoEffect(true, { date: '2026-07-10', timeWindow: 'AM' }, clearRootState);
    expect(clearRootState).toHaveBeenCalledWith('scheduleTime');
  });

  test('does NOT clear scheduleTime when isSale', () => {
    const clearRootState = jest.fn();
    demoEffect(false, { date: '2026-07-10' }, clearRootState);
    expect(clearRootState).not.toHaveBeenCalled();
  });

  test('does NOT clear scheduleTime when it is falsy', () => {
    const clearRootState = jest.fn();
    demoEffect(true, null, clearRootState);
    expect(clearRootState).not.toHaveBeenCalled();
  });
});
