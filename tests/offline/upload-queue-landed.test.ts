import { uploadsLeftQueueForLead } from '../../src/utils/upload-queue-landed';

const REAL = '6ae8382cfc35b02ff9263c3c';
const CLIENT = 'lead-1793600795495-ab12';
const item = (id: string, leadId: string) => ({ id, leadId });

describe('uploadsLeftQueueForLead', () => {
  it('counts an item for this lead that is no longer in the queue', () => {
    const prev = [item('u1', REAL), item('u2', REAL), item('u3', REAL)];
    expect(uploadsLeftQueueForLead(prev, [item('u2', REAL), item('u3', REAL)], REAL)).toBe(1);
  });

  it('counts every item once the whole drain has finished', () => {
    const prev = [item('u1', REAL), item('u2', REAL), item('u3', REAL)];
    expect(uploadsLeftQueueForLead(prev, [], REAL)).toBe(3);
  });

  it('ignores items for another lead', () => {
    const prev = [item('u1', REAL), item('x1', 'other')];
    expect(uploadsLeftQueueForLead(prev, [item('u1', REAL)], REAL)).toBe(0);
  });

  it('a rekey keeps the item id, so nothing has landed', () => {
    // The create drained: every item moved from the client id to the real one in place.
    const prev = [item('u1', CLIENT), item('u2', CLIENT)];
    const next = [item('u1', REAL), item('u2', REAL)];
    expect(uploadsLeftQueueForLead(prev, next, CLIENT)).toBe(0);
    expect(uploadsLeftQueueForLead(prev, next, REAL)).toBe(0);
  });

  it('a parked item is still in the queue and does not count', () => {
    const prev = [item('u1', REAL)];
    expect(uploadsLeftQueueForLead(prev, [{ ...item('u1', REAL), parkedAt: 'x' } as any], REAL)).toBe(0);
  });

  it('a newly added item does not count', () => {
    expect(uploadsLeftQueueForLead([], [item('u1', REAL)], REAL)).toBe(0);
  });

  it('is safe on junk', () => {
    expect(uploadsLeftQueueForLead(null, undefined, REAL)).toBe(0);
    expect(uploadsLeftQueueForLead([item('u1', REAL)], [], null)).toBe(0);
    expect(uploadsLeftQueueForLead([item('u1', REAL)], [], 42)).toBe(0);
    expect(uploadsLeftQueueForLead([null as any, item('u1', REAL)], [null as any], REAL)).toBe(1);
  });
});
