import {
  appendQueuedLog,
  isQueueableLog,
  newActivityLogId,
  nextSendableLog,
  stampActionTime,
  stampOfflineLog,
  type QueuedActivityLog,
} from '../../src/utils/offline-activity-log';
import { findUnresolvedClientIds } from '../../src/utils/offline-lead-work';

const log = (id: string, leadId: string, extra: Partial<QueuedActivityLog> = {}): QueuedActivityLog => ({
  id,
  eventType: 'add',
  payload: { meta: { leadId } },
  meta: { leadId },
  attachLocation: false,
  occurredAt: '2026-10-14T07:00:00.000Z',
  ownerId: 'rep',
  attempts: 0,
  ...extra,
});

const unresolved = (l: QueuedActivityLog) => findUnresolvedClientIds(l.payload).length > 0;

describe('which modules are held offline', () => {
  it.each([
    'funding',
    'result_lead',
    'lead_result_field_entry',
    'roofline_deck',
    'investment_center',
    'consent_form',
    'roof_waiver_form',
    'job_builder',
    'agreement',
    'lead_check_in',
  ])('queues %s', (m) => expect(isQueueableLog(m)).toBe(true));

  it('does not queue a log with no module or a system log', () => {
    expect(isQueueableLog(undefined)).toBe(false);
    expect(isQueueableLog('system')).toBe(false);
  });
});

describe('one action-time variable', () => {
  it('stamps occurredAt and nothing else under another name', () => {
    const m = stampActionTime({ a: 1 }, '2026-10-14T07:47:36.813Z');
    expect(m.occurredAt).toBe('2026-10-14T07:47:36.813Z');
    expect('timestamp' in m).toBe(false);
  });
  it('keeps a moment the caller already knew (a photo capture time)', () => {
    const m = stampActionTime({ occurredAt: '2026-10-14T01:00:00.000Z' }, '2026-10-14T09:00:00.000Z');
    expect(m.occurredAt).toBe('2026-10-14T01:00:00.000Z');
  });
  it('replaces an unparseable value', () => {
    expect(stampActionTime({ occurredAt: 'nope' }, '2026-10-14T09:00:00.000Z').occurredAt).toBe(
      '2026-10-14T09:00:00.000Z'
    );
  });
  it('flags a held log without touching the time', () => {
    const m = stampOfflineLog({ occurredAt: '2026-10-14T01:00:00.000Z' }, '2026-10-14T09:00:00.000Z');
    expect(m).toMatchObject({ occurredAt: '2026-10-14T01:00:00.000Z', queuedOffline: true });
  });
});

describe('replay order per lead', () => {
  const tempLead = 'lead-1760428056813-abcdefghi';

  it('sends in the order they were queued', () => {
    const q = [log('1', 'L1'), log('2', 'L1')];
    expect(nextSendableLog(q, 'rep', unresolved)?.id).toBe('1');
  });

  it('holds a lead still on an offline id, and every later log of that lead', () => {
    const q = [log('1', tempLead), log('2', tempLead), log('3', 'L2')];
    expect(nextSendableLog(q, 'rep', unresolved)?.id).toBe('3');
    expect(nextSendableLog([q[0], q[1]], 'rep', unresolved)).toBeUndefined();
  });

  it('does not let a later log of a held lead jump ahead once an earlier one is held', () => {
    const q = [
      log('1', 'L1', { payload: { meta: { leadId: 'L1', calculatorId: 'calc-1760428056813-xyz' } } }),
      log('2', 'L1'),
    ];
    expect(nextSendableLog(q, 'rep', unresolved)).toBeUndefined();
  });

  it("ignores another rep's logs", () => {
    expect(nextSendableLog([log('1', 'L1', { ownerId: 'other' })], 'rep', unresolved)).toBeUndefined();
  });

  it('keeps 2000 before dropping the oldest', () => {
    let q: QueuedActivityLog[] = [];
    for (let i = 0; i < 2001; i += 1) q = appendQueuedLog(q, log(String(i), 'L1'));
    expect(q).toHaveLength(2000);
    expect(q[0].id).toBe('1');
  });
});

import { offlineCheckInModule } from '../../src/utils/offline-lead-work';

describe('offline check-in log', () => {
  it('follows the geofence plan when the lead is not at the door', () => {
    expect(offlineCheckInModule({ shouldCallWork: true, logModule: 'lead_check_in' }, false)).toBe('lead_check_in');
    expect(offlineCheckInModule({ shouldCallWork: true, logModule: 'lead_review' }, false)).toBe('lead_review');
    expect(offlineCheckInModule({ shouldCallWork: false, logModule: '' }, false)).toBe('');
  });
  it('logs a check-in for a lead created offline even though the plan found it out of range', () => {
    expect(offlineCheckInModule({ shouldCallWork: false, logModule: '' }, true)).toBe('lead_check_in');
  });
  it('keeps the planned module when there is one', () => {
    expect(offlineCheckInModule({ shouldCallWork: true, logModule: 'lead_resume' }, true)).toBe('lead_resume');
  });
});

describe('a stable id per log (no duplicate rows on retry)', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('makes a v4 UUID, the only shape the backend accepts', () => {
    for (let i = 0; i < 50; i += 1) expect(newActivityLogId()).toMatch(UUID_V4);
  });

  it('makes a different id each time', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newActivityLogId()));
    expect(ids.size).toBe(500);
  });

  it('keeps the id, and the original action time, when the log is held, retried and re-queued', () => {
    const id = newActivityLogId();
    const first = log('a', 'lead1', {
      payload: { user_activity_log_id: id, meta: { leadId: 'lead1', occurredAt: '2026-10-14T07:00:00.000Z' } },
    });
    // What a failed send does: queue a copy of the payload with the stamped meta.
    const requeued = {
      ...first,
      payload: { ...first.payload, meta: stampOfflineLog(first.payload.meta, first.payload.meta.occurredAt) },
    };
    const queue = appendQueuedLog(appendQueuedLog([], first), { ...requeued, id: 'b' });

    expect(queue.map((l) => l.payload.user_activity_log_id)).toEqual([id, id]);
    expect(queue[1].payload.meta.occurredAt).toBe('2026-10-14T07:00:00.000Z');
  });
});
