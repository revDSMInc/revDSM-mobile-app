import { offlineLeadsForTab, isSameLocalDay } from '../../src/utils/offline-lead-work';

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0).getTime();
const TODAY = at(2026, 10, 22, 11);
const YESTERDAY = at(2026, 10, 21, 11);

const work = (clientId: string, createdAtMs: number, extra: any = {}): any => ({
  clientId,
  origin: 'created-offline',
  status: 'draft',
  serverIds: { calculators: {} },
  createdAt: new Date(createdAtMs).toISOString(),
  updatedAt: new Date(createdAtMs).toISOString(),
  done: [],
  lead: { firstName: 'A', lastName: 'B', leadType: 'selfGen' },
  calculators: [],
  ...extra,
});

describe('isSameLocalDay', () => {
  it('is a CALENDAR day, not a rolling 24h window', () => {
    // 23:30 yesterday -> 00:30 today is only an hour apart, but a different day
    expect(isSameLocalDay(at(2026, 10, 21, 23), at(2026, 10, 22, 0))).toBe(false);
    // 00:05 and 23:55 on the SAME day are ~24h apart and still the same day
    expect(isSameLocalDay(at(2026, 10, 22, 0), at(2026, 10, 22, 23))).toBe(true);
  });

  it('separates months and years', () => {
    expect(isSameLocalDay(at(2026, 10, 31, 12), at(2026, 11, 1, 12))).toBe(false);
    expect(isSameLocalDay(at(2025, 10, 22, 12), at(2026, 10, 22, 12))).toBe(false);
    expect(isSameLocalDay(at(2026, 10, 22, 9), at(2026, 10, 22, 17))).toBe(true);
  });
});

describe("the Today tab only shows leads made TODAY", () => {
  it("⚠️ the reported bug: yesterday's offline lead no longer shows under Today", () => {
    const items = [work('w-today', TODAY), work('w-yesterday', YESTERDAY)];
    const out = offlineLeadsForTab(items, 'selfGen', { todayAt: TODAY });
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe('w-today');
  });

  it('without todayAt (Archived / Sold / Rehash) nothing is day-filtered', () => {
    const items = [work('w-today', TODAY), work('w-yesterday', YESTERDAY)];
    expect(offlineLeadsForTab(items, 'selfGen', {})).toHaveLength(2);
    expect(offlineLeadsForTab(items, 'selfGen')).toHaveLength(2);
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: null })).toHaveLength(2);
  });

  it('a lead made just before midnight drops off once the day turns', () => {
    const lateLast = at(2026, 10, 21, 23);
    const items = [work('w-late', lateLast)];
    // still yesterday -> shown
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: at(2026, 10, 21, 23) })).toHaveLength(1);
    // just after midnight -> gone, even though barely an hour has passed
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: at(2026, 10, 22, 0) })).toHaveLength(0);
  });

  it('the lead is filtered from the TAB only — it is still queued work', () => {
    const items = [work('w-yesterday', YESTERDAY)];
    // not on Today...
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: TODAY })).toHaveLength(0);
    // ...but the work item itself is untouched and still uploadable
    expect(items[0].status).toBe('draft');
    expect(items[0].deleteLead).toBeUndefined();
  });

  it('still honours the existing filters alongside the date', () => {
    const items = [
      work('w-today', TODAY),
      work('w-deleted', TODAY, { deleteLead: true }),
      work('w-uploaded', TODAY, { status: 'uploaded' }),
      work('w-onserver', TODAY, { serverIds: { leadId: 'srv1', calculators: {} } }),
    ];
    const out = offlineLeadsForTab(items, 'selfGen', {
      todayAt: TODAY,
      serverLeadIds: ['srv1'],
    });
    expect(out.map((l) => l._id)).toEqual(['w-today']);
  });

  it('an uploaded lead bridged by keepUploaded still respects the day', () => {
    const items = [work('w-up', YESTERDAY, { status: 'uploaded' })];
    const out = offlineLeadsForTab(items, 'selfGen', {
      todayAt: TODAY,
      keepUploaded: ['w-up'],
    });
    expect(out).toHaveLength(0);
  });

  it('leadType still separates the Issued and Self Gen tabs', () => {
    const items = [
      work('w-self', TODAY),
      work('w-lf', TODAY, { lead: { firstName: 'C', lastName: 'D', leadType: 'lfLead' } }),
    ];
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: TODAY }).map((l) => l._id)).toEqual(['w-self']);
    expect(offlineLeadsForTab(items, 'lfLead', { todayAt: TODAY }).map((l) => l._id)).toEqual(['w-lf']);
  });

  it('newest first is preserved among today-only leads', () => {
    const items = [
      work('w-morning', at(2026, 10, 22, 8)),
      work('w-evening', at(2026, 10, 22, 20)),
      work('w-old', YESTERDAY),
    ];
    const out = offlineLeadsForTab(items, 'selfGen', { todayAt: TODAY });
    expect(out.map((l) => l._id)).toEqual(['w-evening', 'w-morning']);
  });

  /**
   * Found against REAL queue data pulled off a simulator: a lead stored as
   * `2026-09-11T21:02:14Z` is 02:02 on the 12th for a rep at +05:00.
   *
   * ⚠️ `createdAt` is UTC (`toISOString()`), the tab is the REP's day. Comparing the ISO date
   * STRING - or normalising the stamp to UTC - puts a late-evening lead on the wrong day for
   * every rep east of Greenwich, and on the previous day for everyone west of it.
   */
  it('a late-evening UTC timestamp belongs to the LOCAL day', () => {
    const utcLate = Date.parse('2026-09-11T21:02:14.147Z');
    const local = new Date(utcLate);
    const items = [work('w-late', utcLate)];
    const sameLocalDay = at(local.getFullYear(), local.getMonth() + 1, local.getDate(), 12);
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: sameLocalDay })).toHaveLength(1);
    // the day before that local day shows nothing
    expect(
      offlineLeadsForTab(items, 'selfGen', { todayAt: sameLocalDay - 24 * 60 * 60 * 1000 })
    ).toHaveLength(0);
  });

  it('work with an unparseable createdAt is not shown on Today', () => {
    const items = [work('w-bad', TODAY, { createdAt: 'not-a-date' })];
    expect(offlineLeadsForTab(items, 'selfGen', { todayAt: TODAY })).toHaveLength(0);
    // but it is still returned where no day scope applies, so it can never be stranded
    expect(offlineLeadsForTab(items, 'selfGen', {})).toHaveLength(1);
  });
});
