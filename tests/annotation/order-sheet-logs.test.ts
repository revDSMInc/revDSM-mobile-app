const mockLogEvent = jest.fn();
jest.mock('../../src/services/api/LoggerService', () => ({ logEvent: (...a: any[]) => mockLogEvent(...a) }));

import { logOrderSheetAnnotated, logOrderSheetReset } from '../../src/utils/activity-log/job-builder-logs';

describe('order-sheet logs carry connection + action time', () => {
  beforeEach(() => mockLogEvent.mockClear());

  it('opened (click) offline', async () => {
    await logOrderSheetAnnotated('u1', 'l1', 'opened', { documentId: 'd1', offline: true });
    const [type, body] = mockLogEvent.mock.calls[0];
    expect(type).toBe('click');
    expect(body.meta).toMatchObject({ action: 'order_sheet_annotated', connection: 'offline', stage: 'opened' });
  });

  it('stored (add) keeps the rep action time, not the replay time', async () => {
    await logOrderSheetAnnotated('u1', 'l1', 'stored', { documentId: 'd1', offline: true, occurredAt: '2026-10-21T08:00:00.000Z' });
    const [type, body] = mockLogEvent.mock.calls[0];
    expect(type).toBe('add');
    expect(body.meta).toMatchObject({ connection: 'offline', occurredAt: '2026-10-21T08:00:00.000Z' });
  });

  it('online log has no forced time and says online', async () => {
    await logOrderSheetAnnotated('u1', 'l1', 'stored', { documentId: 'd1' });
    expect(mockLogEvent.mock.calls[0][1].meta.connection).toBe('online');
    expect('occurredAt' in mockLogEvent.mock.calls[0][1].meta).toBe(false);
  });

  it('reset is an add (never delete) with connection + time', async () => {
    await logOrderSheetReset('u1', 'l1', { documentId: 'd1', offline: true, occurredAt: '2026-10-21T09:00:00.000Z' });
    const [type, body] = mockLogEvent.mock.calls[0];
    expect(type).toBe('add');
    expect(body.meta).toMatchObject({ action: 'order_sheet_reset', connection: 'offline', occurredAt: '2026-10-21T09:00:00.000Z' });
  });
});
