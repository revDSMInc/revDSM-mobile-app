import { trackPaths, selectLeadsToPrune, rekeyLead, PRUNE_GRACE_MS } from '../../src/utils/lead-photo-index';

describe('lead photo index', () => {
  const t0 = 1_000_000;
  it('tracks unique paths per lead', () => {
    let i = trackPaths({}, 'L1', ['a', 'b'], t0);
    i = trackPaths(i, 'L1', ['b', 'c'], t0 + 5);
    expect(i.L1.paths).toEqual(['a', 'b', 'c']);
    expect(i.L1.touchedAt).toBe(t0 + 5);
  });
  it('prunes only delivered leads past the grace period', () => {
    const i = { ...trackPaths({}, 'done', ['a'], t0), ...trackPaths({}, 'busy', ['b'], t0), ...trackPaths({}, 'fresh', ['c'], t0 + PRUNE_GRACE_MS) };
    const now = t0 + PRUNE_GRACE_MS;
    expect(selectLeadsToPrune(i, (id) => id === 'busy', now).sort()).toEqual(['done']);
  });
  it('re-keys a device id to the server id', () => {
    const i = rekeyLead(trackPaths({}, 'lead-1', ['a'], t0), 'lead-1', 'srv');
    expect(Object.keys(i)).toEqual(['srv']);
    expect(i.srv.paths).toEqual(['a']);
  });
});
