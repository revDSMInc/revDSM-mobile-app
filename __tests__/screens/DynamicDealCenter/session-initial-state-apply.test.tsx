import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useDynamicJobBuilderSession } from '../../../src/screens/DynamicDealCenter/useDynamicJobBuilderSession';

/**
 * Regression: the dynamic job builder loads its saved state via an async outcome
 * GET on (re)open. `useDynamicJobBuilderSession` must apply that state to jobState
 * when it arrives, RE-apply it if it changes (the GET + dealCenterData re-hydration
 * can settle across several renders — e.g. locked/dcField values fill in only once
 * dealCenterData is ready), and STOP once the rep edits so a late draft never wipes
 * their input. Web parity: JobBuilderContext.applyDraftState.
 */

const config: any = {
  name: 'jb',
  verticals: [
    {
      id: 'v1',
      label: 'Gutters',
      tabs: [
        {
          id: 'v1__t1',
          label: 'Gutters',
          sections: [
            {
              id: 'sec1',
              label: 'Extras',
              sectionType: 'simple',
              fields: [{ id: 'f_miters', type: 'number', label: 'Miters' }],
            },
          ],
        },
      ],
    },
  ],
};

let captured: any = null;
function Probe({ ijs }: { ijs: any }) {
  captured = useDynamicJobBuilderSession({
    initialConfig: config,
    dealCenterData: {},
    initialJobState: ijs,
  });
  return null;
}
const miters = () => captured?.jobState?.v1?.['v1__t1']?.sectionFields?.sec1?.f_miters;
const stateWith = (v: any) => ({ v1: { 'v1__t1': { sectionFields: { sec1: { f_miters: v } } } } });

describe('useDynamicJobBuilderSession — async initialJobState application', () => {
  it('applies initialJobState that arrives after mount (reopen GET)', () => {
    captured = null;
    let tr: any;
    act(() => { tr = ReactTestRenderer.create(<Probe ijs={undefined} />); });
    expect(miters()).not.toBe(7);
    act(() => { tr.update(<Probe ijs={stateWith(7)} />); });
    expect(miters()).toBe(7);
  });

  it('re-applies a corrected initialJobState (dealCenterData settled) before any edit', () => {
    captured = null;
    let tr: any;
    // First draft (hydrated before dealCenterData was ready).
    act(() => { tr = ReactTestRenderer.create(<Probe ijs={stateWith(0)} />); });
    expect(miters()).toBe(0);
    // Corrected draft arrives (re-hydrated with dealCenterData) — must win.
    act(() => { tr.update(<Probe ijs={stateWith(5)} />); });
    expect(miters()).toBe(5);
  });

  it('does NOT clobber a user edit made before the async state arrives', () => {
    captured = null;
    let tr: any;
    act(() => { tr = ReactTestRenderer.create(<Probe ijs={undefined} />); });
    act(() => {
      captured.updateTabState('v1', 'v1__t1', (prev: any) => ({
        ...prev,
        sectionFields: { ...(prev.sectionFields || {}), sec1: { f_miters: 99 } },
      }));
    });
    expect(miters()).toBe(99);
    act(() => { tr.update(<Probe ijs={stateWith(7)} />); });
    expect(miters()).toBe(99);
  });
});
