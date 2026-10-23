import {
  DROP_PENDING, DROP_ACCEPTED, DROP_DECLINED,
  dedupeDrops, findDropIndex, newDropUid, dropUidOf, appendDrop, isPendingDrop,
} from '../../src/screens/DynamicDealCenter/utils/drop-prices';

const d = (price: number, status: string, uid?: string) => ({
  ...(uid ? { uid } : {}),
  price, dropedPrice: price, status,
  paymentMethod: 'check', pricemarkup: 'RETAIL + 1%', downPayment: 0, balance: price,
});

describe('a drop row is addressed by uid, not by index', () => {
  it('newDropUid is unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newDropUid()));
    expect(ids.size).toBe(200);
  });

  it('⚠️ finds the row even when the index is stale (the crash case)', () => {
    const list = [d(300, DROP_DECLINED, 'u1'), d(500, DROP_PENDING, 'u2')];
    expect(findDropIndex(list, 'u2')).toBe(1);
    // the index held in component state is irrelevant
    expect(findDropIndex(list, 'u2', 500)).toBe(1);
  });

  it('falls back to a pending row at that price for legacy rows with no uid', () => {
    const list = [d(300, DROP_DECLINED), d(500, DROP_PENDING)];
    expect(findDropIndex(list, '', 500)).toBe(1);
  });

  it('returns -1 rather than guessing when nothing matches', () => {
    expect(findDropIndex([d(300, DROP_DECLINED)], 'nope', 999)).toBe(-1);
    expect(findDropIndex([], 'u1', 100)).toBe(-1);
    expect(findDropIndex(null, 'u1', 100)).toBe(-1);
  });

  it('never matches a RESOLVED row by price alone — that would overwrite an outcome', () => {
    const list = [d(500, DROP_ACCEPTED, 'u1')];
    expect(findDropIndex(list, '', 500)).toBe(-1);
  });
});

describe('dedupeDrops repairs rows the buggy build already wrote', () => {
  it('⚠️ the reported pair: $500 SECURED + $500 PENDING collapses, outcome wins', () => {
    const list = [d(500, DROP_ACCEPTED, 'u1'), d(500, DROP_PENDING, 'u2')];
    const out = dedupeDrops(list);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe(DROP_ACCEPTED);
  });

  it('⚠️ the first screenshot: $201 PENDING twice collapses to one', () => {
    const list = [d(201, DROP_PENDING), d(201, DROP_PENDING)];
    const out = dedupeDrops(list);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe(DROP_PENDING);
  });

  it('⚠️ the full screenshot: 300/300, 400/400, 500/500 → three rows', () => {
    const list = [
      d(300, DROP_DECLINED), d(300, DROP_PENDING),
      d(400, DROP_DECLINED), d(400, DROP_PENDING),
      d(500, DROP_ACCEPTED), d(500, DROP_PENDING),
    ];
    const out = dedupeDrops(list);
    expect(out.map((r) => [r.dropedPrice, r.status])).toEqual([
      [300, DROP_DECLINED],
      [400, DROP_DECLINED],
      [500, DROP_ACCEPTED],
    ]);
  });

  it('a repeated uid collapses even when prices differ', () => {
    const out = dedupeDrops([d(300, DROP_PENDING, 'u1'), d(305, DROP_DECLINED, 'u1')]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe(DROP_DECLINED);  // the outcome wins
  });

  it('⚠️ does NOT collapse two legitimately RESOLVED rows at the same price', () => {
    // a rep may drop to the same number in separate rounds; both are real history
    const list = [d(400, DROP_DECLINED, 'u1'), d(400, DROP_DECLINED, 'u2')];
    expect(dedupeDrops(list)).toHaveLength(2);
  });

  it('leaves a clean list alone, and returns the SAME array (no needless writes)', () => {
    const clean = [d(300, DROP_DECLINED, 'u1'), d(400, DROP_ACCEPTED, 'u2')];
    expect(dedupeDrops(clean)).toBe(clean);
    expect(dedupeDrops([])).toEqual([]);
    expect(dedupeDrops(null)).toEqual([]);
    expect(dedupeDrops([d(300, DROP_PENDING, 'u1')])).toHaveLength(1);
  });

  it('after dedupe at most one row is still pending', () => {
    const list = [
      d(300, DROP_DECLINED), d(300, DROP_PENDING),
      d(500, DROP_ACCEPTED), d(500, DROP_PENDING),
    ];
    expect(dedupeDrops(list).filter(isPendingDrop)).toHaveLength(0);
  });
});

describe('appendDrop still enforces the single-pending rule with uids', () => {
  it('a new drop declines the previous pending one', () => {
    const list = appendDrop([d(300, DROP_PENDING, 'u1')], d(400, DROP_PENDING, 'u2') as any);
    expect(list.map((r) => r.status)).toEqual([DROP_DECLINED, DROP_PENDING]);
    expect(dropUidOf(list[1])).toBe('u2');
  });
});
