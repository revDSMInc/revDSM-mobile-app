import { hasEnteredScope } from './scope-signature';

export interface RehashDraftLatch {
  seen: Set<string>;
  draft: Set<string>;
}

export const createRehashDraftLatch = (): RehashDraftLatch => ({ seen: new Set(), draft: new Set() });

export function latchRehashDrafts(
  latch: RehashDraftLatch,
  tabs: Array<{ id: string; entries?: Record<string, any> }>,
): void {
  tabs.forEach((t) => {
    if (!t?.id || latch.seen.has(t.id)) return;
    latch.seen.add(t.id);
    if (!hasEnteredScope(t.entries)) latch.draft.add(t.id);
  });
}

export function releaseRehashDrafts(latch: RehashDraftLatch, ids: Array<string | undefined>): void {
  ids.forEach((id) => {
    if (id) latch.draft.delete(id);
  });
}

export const isRehashDraftCalculator = (latch: RehashDraftLatch, id?: string): boolean =>
  !!id && latch.draft.has(id);
