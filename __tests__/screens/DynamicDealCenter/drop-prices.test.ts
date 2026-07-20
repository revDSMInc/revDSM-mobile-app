/**
 * Rollout drop-price single-accepted invariant — mobile (mhalt-revdsm-mobile).
 *
 * Source of truth: web `ViewAllCalculators.js`
 *   - in-array demotion      :1041-1044 / :1067-1069 / :1082-1085
 *   - save-time normalizer   :1116-1123
 *   - hydration mapping      :469-480  (secured = status === 'accepted')
 *
 * Regression cover for the "multiple SECURED after reload" bug, whose cause was
 * a save-engine signature that ignored a drop's `status`, so a status-only edit
 * landing mid-save was treated as a no-op and the demotion was never PUT.
 */
import { normalizeSingleAcceptedDrop } from '../../../src/screens/DynamicDealCenter/utils/drop-prices';

const drop = (price: number, status?: string) => ({ price, dropedPrice: price, status });

describe('normalizeSingleAcceptedDrop', () => {
  const accepted = (drops: any[]) => drops.filter((d) => d.status === 'accepted');

  it('leaves a valid single-accepted list untouched (same reference)', () => {
    const drops = [drop(655, 'declined'), drop(594, 'accepted')];
    expect(normalizeSingleAcceptedDrop(drops)).toBe(drops);
  });

  it('leaves an all-declined list untouched', () => {
    const drops = [drop(655, 'declined'), drop(594, 'declined')];
    expect(normalizeSingleAcceptedDrop(drops)).toBe(drops);
  });

  it('demotes all but the LAST accepted drop', () => {
    // The exact corrupted shape from the bug report: 1st and 2nd both SECURED.
    const result = normalizeSingleAcceptedDrop([drop(655, 'accepted'), drop(594, 'accepted')]);

    expect(accepted(result)).toHaveLength(1);
    expect(result[0]).toEqual({ price: 655, dropedPrice: 655, status: 'declined' });
    expect(result[1].status).toBe('accepted');
  });

  it('keeps the last accepted even with declined entries interleaved', () => {
    const result = normalizeSingleAcceptedDrop([
      drop(1175, 'accepted'),
      drop(1176, 'declined'),
      drop(1176, 'accepted'),
      drop(1176, 'declined'),
    ]);

    expect(accepted(result)).toHaveLength(1);
    expect(result[2].status).toBe('accepted');
  });

  it('collapses many accepted drops down to one', () => {
    const result = normalizeSingleAcceptedDrop(
      [655, 594, 1175, 1176, 1177].map((p) => drop(p, 'accepted'))
    );

    expect(accepted(result)).toHaveLength(1);
    expect(result[4].status).toBe('accepted');
  });

  it('never mutates the input array or its entries', () => {
    const first = drop(655, 'accepted');
    const drops = [first, drop(594, 'accepted')];

    normalizeSingleAcceptedDrop(drops);

    expect(first.status).toBe('accepted');
    expect(drops).toHaveLength(2);
  });

  it('preserves every other field on a demoted drop, including _id', () => {
    const result = normalizeSingleAcceptedDrop([
      { _id: 'abc', price: 655, status: 'accepted', paymentMethod: 'check', downPayment: 100, balance: 555 },
      { _id: 'def', price: 594, status: 'accepted' },
    ]);

    expect(result[0]).toEqual({
      _id: 'abc', price: 655, status: 'declined', paymentMethod: 'check', downPayment: 100, balance: 555,
    });
  });

  it('does not touch drops with a missing or unknown status', () => {
    // Such rows are neither accepted nor declined; they must not be silently
    // promoted or demoted — the badge treats them as LOCKED.
    const result = normalizeSingleAcceptedDrop([
      drop(655, undefined),
      drop(594, ''),
      drop(500, 'accepted'),
    ]);

    expect(result[0].status).toBeUndefined();
    expect(result[1].status).toBe('');
    expect(result[2].status).toBe('accepted');
  });

  it('handles null, undefined and empty input', () => {
    expect(normalizeSingleAcceptedDrop(null)).toEqual([]);
    expect(normalizeSingleAcceptedDrop(undefined)).toEqual([]);
    expect(normalizeSingleAcceptedDrop([])).toEqual([]);
  });

  it('is idempotent', () => {
    const once = normalizeSingleAcceptedDrop([drop(655, 'accepted'), drop(594, 'accepted')]);
    expect(normalizeSingleAcceptedDrop(once)).toBe(once);
  });
});

describe('SECURED badge condition (RolloutView drops list)', () => {
  // Web hydration `ViewAllCalculators.js:472-473` maps the two flags as
  // INDEPENDENT positive tests. Mobile derived `secured = !declined`, which
  // rendered a statusless drop as SECURED.
  const securedOf = (status?: string) => status === 'accepted';
  const declinedOf = (status?: string) => status === 'declined';

  it.each([
    ['accepted', true, false],
    ['declined', false, true],
    [undefined, false, false],
    ['', false, false],
    ['secured', false, false],
  ])('status %p → secured=%p declined=%p', (status, secured, declined) => {
    expect(securedOf(status as any)).toBe(secured);
    expect(declinedOf(status as any)).toBe(declined);
  });

  it('a statusless drop is not SECURED (the old !declined rule said it was)', () => {
    const status = undefined;
    expect(status !== 'declined').toBe(true); // old rule → SECURED
    expect(securedOf(status)).toBe(false); // fixed rule → LOCKED
  });
});

describe('tabSignature drop component — the save-race root cause', () => {
  // Mirrors the `dropSig` built in useDynamicCalculators.tabSignature. The old
  // version mapped price only, so a status-only change produced an IDENTICAL
  // signature: flushSave then cleared `dirty` and scheduled no follow-up, and
  // the demotion was never written.
  const oldDropSig = (drops: any[]) => drops.map((d: any) => d?.price ?? '').join(',');
  const newDropSig = (drops: any[]) =>
    drops
      .map(
        (d: any) =>
          `${d?.price ?? ''}:${d?.status ?? ''}:${d?.downPayment ?? ''}:${d?.balance ?? ''}:${d?.paymentMethod ?? ''}`
      )
      .join(',');

  const before = [drop(655, 'accepted'), drop(594, 'declined')];
  const afterSecuringTheSecond = [drop(655, 'declined'), drop(594, 'accepted')];

  it('the old signature could not see the demotion (this was the bug)', () => {
    expect(oldDropSig(before)).toBe(oldDropSig(afterSecuringTheSecond));
  });

  it('the new signature sees it, so a follow-up save is scheduled', () => {
    expect(newDropSig(before)).not.toBe(newDropSig(afterSecuringTheSecond));
  });

  it('also sees an Unselect (accepted → declined with no price change)', () => {
    const unselected = [drop(655, 'declined'), drop(594, 'declined')];
    expect(oldDropSig(before)).toBe(oldDropSig(unselected));
    expect(newDropSig(before)).not.toBe(newDropSig(unselected));
  });

  it('also sees down-payment / balance / plan edits on an existing drop', () => {
    const base = [{ price: 655, status: 'accepted', downPayment: 0, balance: 655, paymentMethod: 'check' }];
    const edited = [{ price: 655, status: 'accepted', downPayment: 100, balance: 555, paymentMethod: 'greensky_1' }];

    expect(oldDropSig(base)).toBe(oldDropSig(edited));
    expect(newDropSig(base)).not.toBe(newDropSig(edited));
  });

  it('still treats a genuinely unchanged list as clean (no redundant saves)', () => {
    expect(newDropSig(before)).toBe(newDropSig([drop(655, 'accepted'), drop(594, 'declined')]));
  });
});
