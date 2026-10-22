import { rekeyQueuedLogs, type QueuedActivityLog } from '../../src/utils/offline-activity-log';
import { findUnresolvedClientIds } from '../../src/utils/offline-lead-work';

const LEAD_CLIENT = 'lead-1792000000000-abc';
const LEAD_SERVER = '6ad7469757ca24d95305abea';
const CALC_CLIENT = 'calc-1792000000000-def';
const CALC_SERVER = '6ad746a057ca24d95305b1c9';
const APPT_CLIENT = 'appt-1792000000000-ghi';
const APPT_SERVER = '6ad7469e57ca24d95305b16a';

// The rollout log from the report: module rollout_and_drop, action "end price entered".
const rolloutLog = (): QueuedActivityLog => {
  const meta = {
    calculatorId: CALC_CLIENT,
    appointmentId: APPT_CLIENT,
    leadId: LEAD_CLIENT,
    calculatorTitle: 'G',
    fieldName: 'endPrice',
    fieldLabel: 'End Price',
    fieldCategory: 'rollout',
    action: 'end price entered',
    occurredAt: '2026-10-20T10:46:30.187Z',
    queuedOffline: true,
  };
  return {
    id: 'log-1',
    eventType: 'change',
    payload: { module_type: 'rollout_and_drop', user_id: 'u1', meta },
    meta,
    attachLocation: false,
    occurredAt: meta.occurredAt,
    ownerId: 'u1',
    attempts: 0,
  };
};

describe('rekeyQueuedLogs repairs every device id, not just meta.leadId', () => {
  it('swaps the lead id in both meta and payload.meta', () => {
    const [out] = rekeyQueuedLogs([rolloutLog()], LEAD_CLIENT, LEAD_SERVER);
    expect(out.meta.leadId).toBe(LEAD_SERVER);
    expect(out.payload.meta.leadId).toBe(LEAD_SERVER);
  });

  it('swaps a CALCULATOR id - the one that used to be left behind', () => {
    const [out] = rekeyQueuedLogs([rolloutLog()], CALC_CLIENT, CALC_SERVER);
    expect(out.meta.calculatorId).toBe(CALC_SERVER);
    expect(out.payload.meta.calculatorId).toBe(CALC_SERVER);
  });

  it('swaps an APPOINTMENT id', () => {
    const [out] = rekeyQueuedLogs([rolloutLog()], APPT_CLIENT, APPT_SERVER);
    expect(out.meta.appointmentId).toBe(APPT_SERVER);
  });

  it('after all three re-keys the payload holds NO device id, so it is sendable', () => {
    let rows = [rolloutLog()];
    rows = rekeyQueuedLogs(rows, LEAD_CLIENT, LEAD_SERVER);
    rows = rekeyQueuedLogs(rows, APPT_CLIENT, APPT_SERVER);
    rows = rekeyQueuedLogs(rows, CALC_CLIENT, CALC_SERVER);
    expect(findUnresolvedClientIds(rows[0].payload)).toEqual([]);
    // and it matches the shape the backend stored in the report
    expect(rows[0].payload.meta).toMatchObject({
      leadId: LEAD_SERVER,
      calculatorId: CALC_SERVER,
      appointmentId: APPT_SERVER,
      action: 'end price entered',
      queuedOffline: true,
    });
  });

  it('leaves unrelated fields and other rows untouched', () => {
    const [out] = rekeyQueuedLogs([rolloutLog()], CALC_CLIENT, CALC_SERVER);
    expect(out.meta.calculatorTitle).toBe('G');
    expect(out.meta.occurredAt).toBe('2026-10-20T10:46:30.187Z');
    expect(out.payload.module_type).toBe('rollout_and_drop');
    expect(out.attempts).toBe(0);
    expect(out.id).toBe('log-1');
  });

  it('returns the SAME array when nothing matched, so no needless MMKV write', () => {
    const rows = [rolloutLog()];
    expect(rekeyQueuedLogs(rows, 'lead-9999999999999-zzz', LEAD_SERVER)).toBe(rows);
    expect(rekeyQueuedLogs(rows, '', LEAD_SERVER)).toBe(rows);
    expect(rekeyQueuedLogs(rows, LEAD_CLIENT, LEAD_CLIENT)).toBe(rows);
  });

  it('does not rewrite a value that merely CONTAINS the id', () => {
    const l = rolloutLog();
    (l.meta as any).note = `derived from ${CALC_CLIENT}`;
    l.payload.meta = l.meta;
    const [out] = rekeyQueuedLogs([l], CALC_CLIENT, CALC_SERVER);
    expect(out.meta.calculatorId).toBe(CALC_SERVER);
    expect((out.meta as any).note).toBe(`derived from ${CALC_CLIENT}`);
  });

  it('reaches ids nested in arrays and sub-objects', () => {
    const l = rolloutLog();
    (l.meta as any).drops = [{ calculatorId: CALC_CLIENT }, { calculatorId: 'other' }];
    l.payload.meta = l.meta;
    const [out] = rekeyQueuedLogs([l], CALC_CLIENT, CALC_SERVER);
    expect((out.meta as any).drops[0].calculatorId).toBe(CALC_SERVER);
    expect((out.meta as any).drops[1].calculatorId).toBe('other');
  });
});
