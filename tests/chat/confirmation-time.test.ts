import {
  confirmationTimeLabel,
  confirmationTimeOf,
} from '../../src/widgets/components/chat/chat-confirmation';

/**
 * Reported: confirming showed "Confirmed - 5:10 PM", but leaving the channel and returning
 * showed "Confirmed - 2026-10-28T11:58:48...". The reloaded message carries `acknowledgedAt`
 * (a raw ISO string) which used to be printed verbatim.
 */
describe('confirmationTimeOf', () => {
  it('formats an ackBy entry', () => {
    expect(confirmationTimeOf({ ackedAt: '2026-10-28T17:10:00' })).toBe('5:10 PM');
  });

  it('also formats a BARE timestamp, which is how acknowledgedAt arrives', () => {
    expect(confirmationTimeOf('2026-10-28T17:10:00')).toBe('5:10 PM');
    expect(confirmationTimeOf(new Date('2026-10-28T09:05:00'))).toBe('9:05 AM');
  });

  it('never returns a raw ISO string', () => {
    const out = confirmationTimeOf('2026-10-28T11:58:48.000');
    expect(out).not.toContain('T');
    expect(out).not.toContain('-');
  });

  it('is empty for nothing, or for junk it cannot parse', () => {
    expect(confirmationTimeOf(null)).toBe('');
    expect(confirmationTimeOf({})).toBe('');
    expect(confirmationTimeOf('not a date')).toBe('');
  });

  it('renders midnight and noon as 12, not 0', () => {
    expect(confirmationTimeOf('2026-10-28T00:30:00')).toBe('12:30 AM');
    expect(confirmationTimeOf('2026-10-28T12:30:00')).toBe('12:30 PM');
  });
});

describe('confirmationTimeLabel', () => {
  const me = 'u1';

  // The reload case: the server message carries acknowledgedAt.
  it('formats acknowledgedAt instead of printing it raw', () => {
    const out = confirmationTimeLabel({ acknowledgedAt: '2026-10-28T17:10:00' }, me);
    expect(out).toBe('5:10 PM');
  });

  // The just-confirmed case: no acknowledgedAt yet, only the ackBy row.
  it('falls back to the viewer own ackBy entry', () => {
    const out = confirmationTimeLabel(
      { ackBy: [{ userId: 'u1', ackedAt: '2026-10-28T17:10:00' }] },
      me
    );
    expect(out).toBe('5:10 PM');
  });

  it('ignores another user ack row', () => {
    const out = confirmationTimeLabel(
      { ackBy: [{ userId: 'someone-else', ackedAt: '2026-10-28T17:10:00' }] },
      me
    );
    expect(out).toBe('');
  });

  it('is empty when there is nothing to show', () => {
    expect(confirmationTimeLabel({}, me)).toBe('');
    expect(confirmationTimeLabel(null, me)).toBe('');
  });
});
