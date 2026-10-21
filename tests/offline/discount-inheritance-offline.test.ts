import {
  stampOfflineLog,
  stampActionTime,
  appendQueuedLog,
  rekeyQueuedLogs,
  settleQueuedLog,
  nextSendableLog,
  replayableLogs,
  MAX_LOG_ATTEMPTS,
  type QueuedActivityLog,
} from '../../src/utils/offline-activity-log';
import { findUnresolvedClientIds, resolveClientIds } from '../../src/utils/offline-lead-work';

/**
 * `inheritanceSource` is an ordinary `meta` key (it reaches `meta` via `restChange` in
 * `logRolloutChange`). This pins that the offline path carries it through UNCHANGED - queue,
 * re-key, resolve and retry - so a discount seeded at a door is still reported as inherited
 * once it syncs. Nothing here is specific to this key: it is the general "meta survives the
 * queue" guarantee, asserted on the key the portal reads.
 */
const OWNER = 'u1';
const SRC = 'default pre order discount';

// The meta `logPreOrderDiscount` produces for a seeded, defaulted discount.
const discountMeta = (leadId: string, calculatorId: string, appointmentId: string) => ({
  calculatorId,
  appointmentId,
  calculatorTitle: 'G (LG)',
  fieldName: 'preOrderDiscount',
  fieldLabel: 'In Home Pre Order Discount',
  fieldValue: 20,
  fieldCategory: 'rollout',
  oldValue: '',
  newValue: '20%',
  preOrderDiscount: 20,
  isDefaultDiscount: true,
  inheritanceSource: SRC,
  costPrice: 633,
  parPrice: 822,
  retailPrice: 1265,
  percentageOfRollout: 'COST + 23%',
  leadId,
  action: 'in home pre order discount applied',
});

const queued = (meta: Record<string, any>): QueuedActivityLog => {
  const held = stampOfflineLog(stampActionTime({ ...meta }, '2026-10-21T13:29:26.663Z'), '2026-10-21T13:29:26.663Z');
  return {
    id: 'log-1',
    eventType: 'change',
    payload: { module_type: 'rollout_and_drop', user_id: OWNER, meta: held },
    meta: held,
    attachLocation: false,
    occurredAt: held.occurredAt,
    ownerId: OWNER,
    attempts: 0,
  };
};

describe('the inherited-discount log survives the offline path', () => {
  it('queueing keeps inheritanceSource (and marks it queuedOffline)', () => {
    const q = queued(discountMeta('L1', 'C1', 'A1'));
    expect(q.payload.meta.inheritanceSource).toBe(SRC);
    expect(q.payload.meta.isDefaultDiscount).toBe(true);
    expect(q.payload.meta.queuedOffline).toBe(true);
    // the action time is the DOOR, not the sync
    expect(q.payload.meta.occurredAt).toBe('2026-10-21T13:29:26.663Z');
  });

  it('a lead created offline: re-key swaps the ids and leaves the key intact', () => {
    const q = queued(discountMeta('lead-1792000000000-a', 'calc-1792000000000-b', 'appt-1792000000000-c'));
    let rows = [q];
    rows = rekeyQueuedLogs(rows, 'lead-1792000000000-a', '6ad8bbee32e31cdf78fb2b48');
    rows = rekeyQueuedLogs(rows, 'appt-1792000000000-c', '6ad8bbf032e31cdf78fb2eb3');
    rows = rekeyQueuedLogs(rows, 'calc-1792000000000-b', '6ad8be0c32e31cdf78fba1ea');

    expect(findUnresolvedClientIds(rows[0].payload)).toEqual([]);
    expect(rows[0].payload.meta).toMatchObject({
      leadId: '6ad8bbee32e31cdf78fb2b48',
      calculatorId: '6ad8be0c32e31cdf78fba1ea',
      appointmentId: '6ad8bbf032e31cdf78fb2eb3',
      inheritanceSource: SRC,
      isDefaultDiscount: true,
      preOrderDiscount: 20,
    });
  });

  it('the send-time id resolver also preserves it', () => {
    const q = queued(discountMeta('lead-1792000000000-a', 'calc-1792000000000-b', 'appt-1792000000000-c'));
    const resolved = resolveClientIds(q.payload, {
      'lead-1792000000000-a': '6ad8bbee32e31cdf78fb2b48',
      'calc-1792000000000-b': '6ad8be0c32e31cdf78fba1ea',
      'appt-1792000000000-c': '6ad8bbf032e31cdf78fb2eb3',
    });
    expect(resolved.meta.inheritanceSource).toBe(SRC);
    expect(findUnresolvedClientIds(resolved)).toEqual([]);
  });

  it('a transport failure keeps the row byte-for-byte, so a retry still carries it', () => {
    let store = [queued(discountMeta('L1', 'C1', 'A1'))];
    store = settleQueuedLog(store, 'log-1', 'failed', MAX_LOG_ATTEMPTS, 'transport');
    expect(store).toHaveLength(1);
    expect(store[0].attempts).toBe(0);
    expect(store[0].payload.meta.inheritanceSource).toBe(SRC);
  });

  it('it is sendable in the normal drain order', () => {
    const store = appendQueuedLog([] as QueuedActivityLog[], queued(discountMeta('L1', 'C1', 'A1')));
    const next = nextSendableLog(store, OWNER, (l) => findUnresolvedClientIds(l.payload).length > 0);
    expect(next?.payload.meta.inheritanceSource).toBe(SRC);
    expect(replayableLogs(store, OWNER)).toHaveLength(1);
  });

  it('a NON-default (not seeded-from-default) discount has no key, offline too', () => {
    const noInherit: Record<string, any> = { ...discountMeta('L1', 'C1', 'A1') };
    delete noInherit.inheritanceSource;
    const q = queued({ ...noInherit, isDefaultDiscount: false });
    expect(q.payload.meta.inheritanceSource).toBeUndefined();
    expect(q.payload.meta.isDefaultDiscount).toBe(false);
  });
});

/**
 * The key is only emitted when `isDefault` is true, and `isDefault` is
 * `!!user.defaultPercentage && user.defaultPercentage === discountPct`.
 *
 * Offline that `user` is the REDUX user with any queued settings applied optimistically
 * (`applyPendingSettingsToUser`) - so a default the rep sets at a door is already on the user by
 * the time the discount is seeded. Without that, `isDefault` would be false offline and the log
 * would silently lose its inheritance, which is the failure this guards.
 */
describe('isDefault is computed correctly offline', () => {
  const { applyPendingSettingsToUser } = require('../../src/utils/offline-settings');
  const isDefault = (user: any, pct: number) =>
    !!user?.defaultPercentage && user.defaultPercentage === pct;

  it('a default set OFFLINE is applied to the user, so the seed is inherited', () => {
    const serverUser = { _id: 'u1', defaultPercentage: null };
    const user = applyPendingSettingsToUser(serverUser, { defaultPercentage: 20 });
    expect(user.defaultPercentage).toBe(20);
    expect(isDefault(user, 20)).toBe(true);
  });

  it('with no queued setting the server value still decides', () => {
    const user = applyPendingSettingsToUser({ _id: 'u1', defaultPercentage: 20 }, null);
    expect(isDefault(user, 20)).toBe(true);
    expect(isDefault(user, 15)).toBe(false);
  });

  it('a queued default OVERRIDES a stale server one', () => {
    const user = applyPendingSettingsToUser({ _id: 'u1', defaultPercentage: 15 }, { defaultPercentage: 25 });
    expect(isDefault(user, 25)).toBe(true);
    expect(isDefault(user, 15)).toBe(false);
  });

  it('clearing the default offline (null) means nothing is inherited', () => {
    const user = applyPendingSettingsToUser({ _id: 'u1', defaultPercentage: 20 }, { defaultPercentage: null });
    expect(user.defaultPercentage).toBeNull();
    expect(isDefault(user, 20)).toBe(false);
  });
});
