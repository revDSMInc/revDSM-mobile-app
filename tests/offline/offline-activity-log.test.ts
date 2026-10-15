import {
  appendQueuedLog,
  isQueueableLog,
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
