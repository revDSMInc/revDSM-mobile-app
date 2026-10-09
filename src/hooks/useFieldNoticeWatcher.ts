import { useEffect, useRef } from 'react';
import { getTabSections } from '../utils/dynamic-job-builder/engine/combination-utils';
import {
  getFlattenedCombinationSectionRowFields,
  getRenderedSectionCombos,
} from '../utils/dynamic-job-builder/engine/combination-utils';
import { hasFieldNotice, isGutterOpeningWidthField, resolveAnyFieldNotice } from '../utils/dynamic-job-builder/engine/notice-utils';
import { publishFieldNotice } from '../widgets/components/dynamic-job-builder/FieldNoticeModal';

type Snapshot = { values: Record<string, any>; fields: Record<string, any>; lengths: Record<string, number> };

const watched = (f: any) => hasFieldNotice(f) || isGutterOpeningWidthField(f);

function takeSnapshot(tab: any, tabState: any): Snapshot {
  const values: Record<string, any> = {};
  const fields: Record<string, any> = {};
  const lengths: Record<string, number> = {};

  (tab?.fields || []).filter(watched).forEach((f: any) => {
    values[`tab:${f.id}`] = tabState?.[f.id];
    fields[`tab:${f.id}`] = f;
  });

  getTabSections(tab).forEach((section: any) => {
    if (section.sectionType === 'simple') {
      (section.fields || []).filter(watched).forEach((f: any) => {
        const key = `${section.id}:simple:${f.id}`;
        values[key] = tabState?.sectionFields?.[section.id]?.[f.id];
        fields[key] = f;
      });
      return;
    }
    const combos = getRenderedSectionCombos(section, tabState);
    lengths[section.id] = combos.length;
    const noticeFields = getFlattenedCombinationSectionRowFields(section).filter(watched);
    combos.forEach((combo: any, i: number) => {
      noticeFields.forEach((f: any) => {
        const key = `${section.id}:${i}:${f.id}`;
        values[key] = combo?.[f.id];
        fields[key] = f;
      });
    });
  });
  return { values, fields, lengths };
}

/**
 * Fires a field's "Important Notice" from the VALUE CHANGING IN JOB STATE rather than from the widget's tap.
 * The tap path depends on the field instance surviving its own re-render; this one cannot be lost to a
 * re-mounted card, a different dropdown component, or a new (blank) combination. ⚠️ A section whose combination
 * count changed between snapshots (add / remove shifts indexes) only refreshes the baseline, and the first
 * snapshot never fires, so opening a saved deal stays silent.
 */
export function useFieldNoticeWatcher(tab: any, tabState: any) {
  const previous = useRef<Snapshot | null>(null);
  const tabId = tab?.id;

  useEffect(() => {
    previous.current = null;
  }, [tabId]);

  useEffect(() => {
    if (!tab || tab.isSummary) return;
    const next = takeSnapshot(tab, tabState);
    const before = previous.current;
    previous.current = next;
    if (!before) return;

    Object.keys(next.values).forEach((key) => {
      const sectionId = key.split(':')[0];
      if (before.lengths[sectionId] !== next.lengths[sectionId]) return;
      if (!(key in before.values)) return;
      if (before.values[key] === next.values[key]) return;
      const notice = resolveAnyFieldNotice(next.fields[key], next.values[key]);
      if (notice) publishFieldNotice(notice);
    });
  }, [tab, tabState]);
}
