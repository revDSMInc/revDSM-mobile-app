import { channelInOffice, officeIdsOf } from '../../src/utils/team-channel-offices';

// REVDSM-1313: a channel can belong to several offices and is then one shared
// conversation. Channels saved before that carry only `office_id`, and have to
// keep reading as that one office -- nothing was backfilled. The app only reads
// this: channels are created and managed from the portal.
describe('officeIdsOf', () => {
  it('reads a legacy single-office channel as one office', () => {
    expect(officeIdsOf({ office_id: 'o1' })).toEqual(['o1']);
    expect(officeIdsOf({ office_id: 'o1', office_ids: [] })).toEqual(['o1']);
  });

  it('reads the whole set from a shared channel', () => {
    expect(officeIdsOf({ office_id: 'o1', office_ids: ['o1', 'o2'] })).toEqual(['o1', 'o2']);
  });

  it('answers empty for a channel with no office and for nothing at all', () => {
    expect(officeIdsOf({ office_id: null })).toEqual([]);
    expect(officeIdsOf({})).toEqual([]);
    expect(officeIdsOf(null)).toEqual([]);
    expect(officeIdsOf(undefined)).toEqual([]);
  });

  it('ignores blanks and compares as strings', () => {
    expect(officeIdsOf({ office_ids: ['o1', '', null] })).toEqual(['o1']);
    expect(officeIdsOf({ office_ids: [1, 2] })).toEqual(['1', '2']);
  });
});

describe('channelInOffice', () => {
  const shared = { office_id: 'o1', office_ids: ['o1', 'o2'] };

  it('matches any office of a shared channel, not just the primary one', () => {
    expect(channelInOffice(shared, 'o1')).toBe(true);
    expect(channelInOffice(shared, 'o2')).toBe(true);
    expect(channelInOffice(shared, 'o9')).toBe(false);
  });

  it('matches a legacy channel on its only office', () => {
    expect(channelInOffice({ office_id: 'o1' }, 'o1')).toBe(true);
    expect(channelInOffice({ office_id: 'o1' }, 'o2')).toBe(false);
  });

  it('is false without an office to compare', () => {
    expect(channelInOffice(shared, null)).toBe(false);
    expect(channelInOffice(shared, undefined)).toBe(false);
    expect(channelInOffice(shared, '')).toBe(false);
  });
});
