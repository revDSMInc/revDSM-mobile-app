import {
  isSettledPaymentRow,
  mergeSettledPayments,
} from '../../src/utils/offline-funding-merge';

// "Cannot remove $100 Check - it has already been collected", seen only after an offline sync.

describe('isSettledPaymentRow', () => {
  it('counts a charged or collected row as settled', () => {
    expect(isSettledPaymentRow({ collected: true })).toBe(true);
    expect(isSettledPaymentRow({ charged: true })).toBe(true);
  });

  it('leaves an untouched row alone', () => {
    expect(isSettledPaymentRow({ charged: false, collected: false })).toBe(false);
    expect(isSettledPaymentRow({})).toBe(false);
    expect(isSettledPaymentRow(null)).toBe(false);
  });
});

describe('mergeSettledPayments', () => {
  const queued = [{ pid: 'a', method: 'Cash', amount: 50 }];

  it('carries a settled row the offline snapshot never saw', () => {
    const out = mergeSettledPayments(queued, [
      { pid: 'z', method: 'Check', amount: 100, collected: true },
    ]);
    expect(out.map((r: any) => r.pid)).toEqual(['z', 'a']);
  });

  it('does not carry an unsettled server row - that one really was removed', () => {
    const out = mergeSettledPayments(queued, [{ pid: 'z', method: 'Check', amount: 100 }]);
    expect(out.map((r: any) => r.pid)).toEqual(['a']);
  });

  // The rep edited a row they could see; their version is the newer intent.
  it('lets a queued row win over the server copy of the same pid', () => {
    const out = mergeSettledPayments([{ pid: 'z', method: 'Cash', amount: 75 }], [
      { pid: 'z', method: 'Check', amount: 100, collected: true },
    ]);
    expect(out).toHaveLength(1);
    expect((out[0] as any).amount).toBe(75);
  });

  it('copies the carried row verbatim - money that moved is not re-priced', () => {
    const out = mergeSettledPayments([], [
      { pid: 'z', kind: 'down', method: 'Check', type: 'manual', amount: 100, collected: true },
    ]);
    expect(out[0]).toEqual({
      pid: 'z',
      kind: 'down',
      method: 'Check',
      type: 'manual',
      amount: 100,
    });
  });

  it('is a no-op when the server has nothing settled, or nothing at all', () => {
    expect(mergeSettledPayments(queued, [])).toEqual(queued);
    expect(mergeSettledPayments(queued, null)).toEqual(queued);
    expect(mergeSettledPayments(queued, undefined)).toEqual(queued);
  });

  it('ignores a settled row with no pid, which cannot be matched or sent', () => {
    expect(mergeSettledPayments(queued, [{ amount: 100, collected: true }])).toEqual(queued);
  });

  it('survives an empty queue', () => {
    expect(mergeSettledPayments(null, null)).toEqual([]);
  });
});
