import {
  DROP_PENDING, DROP_ACCEPTED, DROP_DECLINED,
  isPendingDrop, isResolvedDrop, hasUnresolvedDrop, pendingDropIndex,
  resolveAutoSecureIndex, autoSecureLastDrop, resolveActiveDownPayment,
  hasAcceptedDrop, toDropPricePayload, normalizeSingleAcceptedDrop,
  idlessDropSignature, adoptServerDropIds,
} from '../../src/screens/DynamicDealCenter/utils/drop-prices';

const drop = (price: number, status: string, downPayment = 0) => ({
  dropedPrice: price, price, status, downPayment, paymentMethod: 'check', pricemarkup: 'RETAIL + 1%', balance: price,
});

describe('pending drops never price the job', () => {
  it('classifies the three statuses', () => {
    expect(isPendingDrop(drop(202, DROP_PENDING))).toBe(true);
    expect(isResolvedDrop(drop(202, DROP_PENDING))).toBe(false);
    expect(isResolvedDrop(drop(202, DROP_ACCEPTED))).toBe(true);
    expect(isResolvedDrop(drop(202, DROP_DECLINED))).toBe(true);
  });

  it('⚠️ Result Lead would have SOLD a pending drop — auto-secure now skips it', () => {
    const drops = [drop(222, DROP_DECLINED), drop(202, DROP_PENDING)];
    // the regression: index 1 (the pending row) must NOT be chosen
    expect(resolveAutoSecureIndex(drops)).toBe(0);
    const out = autoSecureLastDrop(drops);
    expect(out[1].status).toBe(DROP_PENDING);   // untouched
    expect(out[0].status).toBe(DROP_ACCEPTED);
  });

  it('a list of ONLY pending drops auto-secures nothing', () => {
    const drops = [drop(202, DROP_PENDING)];
    expect(resolveAutoSecureIndex(drops)).toBe(-1);
    expect(autoSecureLastDrop(drops)).toBe(drops);   // same ref, no change
  });

  it('an accepted drop still wins, and pending is ignored', () => {
    const drops = [drop(222, DROP_ACCEPTED), drop(202, DROP_PENDING)];
    expect(resolveAutoSecureIndex(drops)).toBe(-1);  // already accepted
    expect(hasAcceptedDrop(drops)).toBe(true);
  });

  it('a pending down payment never seeds the Investment Center', () => {
    expect(resolveActiveDownPayment([drop(202, DROP_PENDING, 500)], 0)).toBe(0);
    expect(resolveActiveDownPayment([drop(202, DROP_ACCEPTED, 500)], 0)).toBe(500);
    // pending present but a declined row is the auto-secure target
    expect(resolveActiveDownPayment([drop(222, DROP_DECLINED, 300), drop(202, DROP_PENDING, 500)], 0)).toBe(300);
  });

  it('Result Lead can detect an unresolved drop', () => {
    expect(hasUnresolvedDrop([drop(202, DROP_PENDING)])).toBe(true);
    expect(hasUnresolvedDrop([drop(202, DROP_DECLINED)])).toBe(false);
    expect(hasUnresolvedDrop([])).toBe(false);
    expect(hasUnresolvedDrop(null)).toBe(false);
    expect(pendingDropIndex([drop(222, DROP_DECLINED), drop(202, DROP_PENDING)])).toBe(1);
    expect(pendingDropIndex([drop(222, DROP_DECLINED)])).toBe(-1);
  });

  it('⚠️ the payload PRESERVES pending — it must not be coerced to declined', () => {
    const [row] = toDropPricePayload([drop(202, DROP_PENDING)]);
    expect(row.status).toBe(DROP_PENDING);
    expect(row.dropedPrice).toBe(202);
  });

  it('a row with NO status still falls back to declined (legacy rows)', () => {
    const [row] = toDropPricePayload([{ dropedPrice: 202 }]);
    expect(row.status).toBe(DROP_DECLINED);
  });

  it('normalizeSingleAcceptedDrop leaves pending alone', () => {
    const drops = [drop(300, DROP_ACCEPTED), drop(250, DROP_ACCEPTED), drop(202, DROP_PENDING)];
    const out = normalizeSingleAcceptedDrop(drops);
    expect(out.map((d) => d.status)).toEqual([DROP_DECLINED, DROP_ACCEPTED, DROP_PENDING]);
  });

  it('the id signature and server-id adoption distinguish pending', () => {
    expect(idlessDropSignature([drop(202, DROP_PENDING)])).toBe('202:pending');
    const adopted = adoptServerDropIds(
      [drop(202, DROP_PENDING)],
      [{ _id: 'srv1', dropedPrice: 202, status: DROP_PENDING }],
    );
    expect((adopted[0] as any)._id).toBe('srv1');
  });
});

/**
 * Offline parity. A drop typed at a door is saved by `persistOffline`
 * (`useDynamicCalculators`), which stores `dropPrice` verbatim on the calculator payload; the
 * `calculatorState` sync step then sends that payload through `updateCalculator`. So the only
 * thing that could lose the status on the way up is the payload builder - which is exactly what
 * `toDropPricePayload` is, and why its pending case is pinned above too.
 *
 * ⚠️ The `calculator` CREATE step deletes `dropPrice` (`offlineLeadStore`), so a drop NEVER rides
 * the create - it always arrives via `calculatorState`. Dropping that step would silently lose
 * every offline drop, pending or not.
 */
describe('a pending drop survives the offline round trip', () => {
  it('the payload sent on sync still says pending', () => {
    const offlineStored = [drop(222, DROP_DECLINED), drop(202, DROP_PENDING)];
    const sent = toDropPricePayload(offlineStored);
    expect(sent.map((d) => d.status)).toEqual([DROP_DECLINED, DROP_PENDING]);
    expect(sent[1].dropedPrice).toBe(202);
  });

  it('a drop created offline carries its payment method and markup', () => {
    const [row] = toDropPricePayload([drop(202, DROP_PENDING)]);
    expect(row).toMatchObject({
      dropedPrice: 202,
      status: DROP_PENDING,
      paymentMethod: 'check',
      pricemarkup: 'RETAIL + 1%',
      downPayment: 0,
      balance: 202,
    });
  });

  it('⚠️ syncing must not let a pending drop get auto-secured on the way in', () => {
    // whatever order the server returns them in, pending is never the auto-secure target
    const fromServer = [drop(222, DROP_DECLINED), drop(202, DROP_PENDING)];
    expect(autoSecureLastDrop(fromServer)[1].status).toBe(DROP_PENDING);
    expect(hasUnresolvedDrop(fromServer)).toBe(true);
  });

  it('once resolved offline, it behaves exactly like an online drop', () => {
    const resolved = [drop(222, DROP_DECLINED), drop(202, DROP_ACCEPTED)];
    expect(hasUnresolvedDrop(resolved)).toBe(false);
    expect(hasAcceptedDrop(resolved)).toBe(true);
    expect(resolveActiveDownPayment(resolved, 0)).toBe(0);
    expect(toDropPricePayload(resolved).map((d) => d.status)).toEqual([DROP_DECLINED, DROP_ACCEPTED]);
  });
});

/**
 * The EXACT wire contract, pinned.
 *
 * ⚠️ A 500 was reported from a device after the pending work landed: the offline persist path
 * (`persistOffline` in `useDynamicCalculators`) sent `t.dropPrice` RAW, so the queued calculator
 * payload carried the internal row - `price` and friends - instead of these six keys. Online never
 * showed it, because both online savers already map through `toDropPricePayload`.
 *
 * This asserts the key SET, not just the values, so an internal field added to a drop row in the
 * UI can never leak to the API again.
 */
describe('the dropPrice wire contract', () => {
  const CONTRACT = ['dropedPrice', 'status', 'paymentMethod', 'pricemarkup', 'downPayment', 'balance'];

  it('a pending row sends exactly the six contract keys', () => {
    // an internal row as the UI holds it: note `price`, which must NOT go up
    const internal = {
      price: 202, dropedPrice: 202, status: DROP_PENDING,
      pricemarkup: 'RETAIL + 1%', paymentMethod: 'check', downPayment: 0, balance: 202,
    };
    const [row] = toDropPricePayload([internal]);
    expect(Object.keys(row).sort()).toEqual([...CONTRACT].sort());
    expect(row).toEqual({
      dropedPrice: 202,
      status: 'pending',
      paymentMethod: 'check',
      pricemarkup: 'RETAIL + 1%',
      downPayment: 0,
      balance: 202,
    });
  });

  it('a declined row matches the shape the API already accepts', () => {
    const [row] = toDropPricePayload([{
      price: 202, dropedPrice: 202, status: DROP_DECLINED,
      pricemarkup: 'RETAIL + 1%', paymentMethod: 'check', downPayment: 0, balance: 202,
    }]);
    expect(row).toEqual({
      dropedPrice: 202,
      status: 'declined',
      paymentMethod: 'check',
      pricemarkup: 'RETAIL + 1%',
      downPayment: 0,
      balance: 202,
    });
  });

  it('`price` is NEVER sent, whatever the status', () => {
    for (const status of [DROP_PENDING, DROP_ACCEPTED, DROP_DECLINED]) {
      const [row] = toDropPricePayload([{ price: 202, dropedPrice: 202, status }]);
      expect(row).not.toHaveProperty('price');
      expect(row.dropedPrice).toBe(202);
    }
  });

  it('an unknown internal field cannot leak to the API', () => {
    const [row] = toDropPricePayload([{
      dropedPrice: 202, status: DROP_PENDING, someFutureUiField: 'x', _localOnly: true,
    }]);
    expect(Object.keys(row).sort()).toEqual([...CONTRACT].sort());
  });

  it('_id and paymentMethods ride only when genuinely present', () => {
    const [plain] = toDropPricePayload([{ dropedPrice: 202, status: DROP_PENDING }]);
    expect(plain).not.toHaveProperty('_id');
    expect(plain).not.toHaveProperty('paymentMethods');

    const [full] = toDropPricePayload([{
      _id: 'srv1', dropedPrice: 202, status: DROP_PENDING, paymentMethods: ['wf1'],
    }]);
    expect(full._id).toBe('srv1');
    expect(full.paymentMethods).toEqual(['wf1']);
  });
});
