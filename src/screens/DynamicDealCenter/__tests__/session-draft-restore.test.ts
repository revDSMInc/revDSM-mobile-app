import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useDynamicJobBuilderSession } from '../useDynamicJobBuilderSession';

// A loaded draft (already deserialized + hydrated), like the outcome GET returns.
const draft: any = {
  v_gutters: {
    t_gutters: {
      comboGroups: {
        s_kstyle: {
          combinations: [{ f_grid: { 'Left Side': { '3rd': 4 } }, f_color: 'Musket Brown', f_partial: 'Yes' }],
          sectionState: {},
        },
      },
    },
  },
};

const emptyConfig = { name: '', verticals: [] } as any;

type Api = ReturnType<typeof useDynamicJobBuilderSession>;
let api: Api | undefined;

function mount(useToken: boolean) {
  function Harness({ initialJobState, draftToken }: any) {
    api = useDynamicJobBuilderSession({
      initialConfig: emptyConfig,
      initialJobState,
      draftToken,
    });
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer;
  // 1) Mount while the outcome GET is still in flight (no draft yet).
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Harness, { initialJobState: undefined, draftToken: undefined }),
    );
  });

  // 2) Something writes to job state BEFORE the draft lands (this is what used to
  //    latch userEditedRef and permanently block the draft).
  act(() => {
    api!.updateTabState('v_gutters', 't_gutters', { sectionFields: {} });
  });

  // 3) The outcome GET resolves → a NEW draft arrives.
  act(() => {
    renderer!.update(
      React.createElement(Harness, {
        initialJobState: draft,
        draftToken: useToken ? 'lead1:calc1' : undefined,
      }),
    );
  });

  return () => act(() => renderer!.unmount());
}

const combo = () =>
  (api!.jobState as any)?.v_gutters?.t_gutters?.comboGroups?.s_kstyle?.combinations?.[0];

test('web parity: a newly-loaded draft applies even after an earlier write (prefilled data shows)', () => {
  const unmount = mount(true);
  expect(combo()?.f_partial).toBe('Yes');
  expect(combo()?.f_color).toBe('Musket Brown');
  expect(combo()?.f_grid).toEqual({ 'Left Side': { '3rd': 4 } });
  unmount();
});

test('control: without the draft token the earlier write blocks the draft (the old bug)', () => {
  const unmount = mount(false);
  expect(combo()).toBeUndefined();
  unmount();
});

test('the same draft is not re-applied, so rep edits are never clobbered', () => {
  function Harness({ initialJobState, draftToken }: any) {
    api = useDynamicJobBuilderSession({ initialConfig: emptyConfig, initialJobState, draftToken });
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Harness, { initialJobState: draft, draftToken: 'lead1:calc1' }),
    );
  });
  // Rep edits AFTER the draft applied.
  act(() => {
    api!.updateTabState('v_gutters', 't_gutters', { edited: true });
  });
  // A re-render with the SAME draft token must not restore over the edit.
  act(() => {
    renderer!.update(React.createElement(Harness, { initialJobState: draft, draftToken: 'lead1:calc1' }));
  });
  expect((api!.jobState as any)?.v_gutters?.t_gutters?.edited).toBe(true);
  act(() => renderer!.unmount());
});
