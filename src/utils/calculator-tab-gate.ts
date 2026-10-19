/**
 * When may the rep add another calculator tab?
 *
 * The ask: "when we create a new calculator by pressing plus, disable the plus button until
 * he adds something in that empty tab. If in the first tab he didn't add anything, the rep
 * should be unable to create a new calculator."
 *
 * ⚠️ An "empty" tab is NOT a tab with no entries. `mergeFullEntries` seeds EVERY field in the
 * schema with `inputValue: 0`, so a brand-new tab already carries a full entries map. Testing
 * `Object.keys(entries).length` would call every tab non-empty and the gate would never fire.
 * Emptiness here means: no field has a value, and nothing else has been chosen on it.
 *
 * Pure on purpose: the Deal Center imports react-native and cannot load under jest
 * (CLAUDE.md §6).
 */

export interface GateTab {
  id?: string | null;
  title?: string | null;
  entries?: Record<string, { inputValue?: unknown } | null | undefined> | null;
  totals?: { cost?: number; par?: number; retail?: number } | null;
  price?: number | null;
  paymentMethod?: string | null;
  isRolloutConfirmed?: boolean;
  selectedRenders?: unknown[] | null;
  dropPrice?: unknown[] | null;
}

const numeric = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Has the rep typed a quantity into any field on this tab? */
export const hasAnyFieldValue = (tab: GateTab | null | undefined): boolean =>
  Object.values(tab?.entries || {}).some((e) => numeric(e?.inputValue) !== 0);

/**
 * Is this tab still untouched?
 *
 * ⚠️ Deliberately generous about what counts as "touched". A confirmed rollout, a chosen
 * payment method, a selected render or a drop are all real work even with no quantity typed -
 * blocking the plus button in front of a customer because the app disagreed about what work
 * looks like is far worse than letting one extra tab through.
 */
export const isTabEmpty = (tab: GateTab | null | undefined): boolean => {
  if (!tab) return true;
  if (hasAnyFieldValue(tab)) return false;
  if (numeric(tab.totals?.retail) !== 0 || numeric(tab.totals?.cost) !== 0) return false;
  if (numeric(tab.price) !== 0) return false;
  if (tab.isRolloutConfirmed) return false;
  if ((tab.selectedRenders?.length || 0) > 0) return false;
  if ((tab.dropPrice?.length || 0) > 0) return false;
  return true;
};

export const ADD_TAB_BLOCKED_TITLE = 'Finish this calculator first';

export const ADD_TAB_BLOCKED_MESSAGE =
  'Add at least one item to this calculator before starting another one.';

export const ADD_TAB_BLOCKED_MESSAGE_OTHER =
  'One of your calculators is still empty. Add at least one item to it before starting another one.';

export interface AddTabDecision {
  allowed: boolean;
  /** The tab the rep has to fill in before they can add another. */
  blockingTabId?: string | null;
  title?: string;
  message?: string;
}

/**
 * ⚠️ Gated on ANY empty tab, not just the active one.
 *
 * The rep can add a tab, switch away from it and come back later. If the gate only looked at
 * the tab in view, two taps on plus from different tabs would still leave two blanks behind -
 * which is the thing being prevented.
 */
export const canAddCalculatorTab = (
  tabs: GateTab[] | null | undefined,
  activeTabId?: string | null
): AddTabDecision => {
  const list = (tabs || []).filter(Boolean);
  // ⚠️ No tabs at all is NOT blocked. The first calculator is created by the screen itself,
  // and refusing here would leave a lead with no way to start.
  if (!list.length) return { allowed: true };

  const empty = list.find((t) => isTabEmpty(t));
  if (!empty) return { allowed: true };

  return {
    allowed: false,
    blockingTabId: empty.id ?? null,
    title: ADD_TAB_BLOCKED_TITLE,
    message: emptyTabMessage(empty, list.length, activeTabId),
  };
};

/**
 * ⚠️ Never quote the tab's title.
 *
 * A calculator is named from what it contains (`G (LG)`, `G (SM)`), so a tab with nothing in
 * it is ALWAYS still on its placeholder - a bare position number. Quoting that gave the rep
 * `"2" is still empty`, which reads like a name they chose and tells them nothing: there is no
 * tab called 2, and the number shifts as tabs are added, deleted or reordered.
 *
 * So the message only distinguishes "the one you are on" from "another one".
 */
export const emptyTabMessage = (
  tab: GateTab,
  tabCount: number,
  activeTabId?: string | null
): string => {
  const isActive =
    !!tab?.id && !!activeTabId && String(tab.id) === String(activeTabId);
  if (tabCount > 1 && !isActive) return ADD_TAB_BLOCKED_MESSAGE_OTHER;
  return ADD_TAB_BLOCKED_MESSAGE;
};
