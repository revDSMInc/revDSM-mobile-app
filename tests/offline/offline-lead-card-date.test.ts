import { offlineWorkToLead, localDateOnly } from '../../src/utils/offline-lead-work';

const work = (createdAt: string, lead: any = {}): any => ({
  clientId: 'work-1',
  origin: 'created-offline',
  status: 'draft',
  serverIds: { calculators: {} },
  createdAt,
  updatedAt: createdAt,
  done: [],
  lead: { leadType: 'selfGen', customer: { firstName: 'Hdh', lastName: 'Uru' }, ...lead },
  calculators: [],
});

// What LeadCard does: `format(new Date(lead.leadDate), 'MM/dd/yyyy')`
const asCardShows = (leadDate: string) => {
  const d = new Date(leadDate);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
};

describe('an offline-created lead shows its date on the card', () => {
  it('⚠️ the reported bug: leadDate was never set, so the card showed N/A', () => {
    const lead = offlineWorkToLead(work('2026-10-22T10:26:00.000Z'))!;
    expect(lead.leadDate).toBeTruthy();
    expect(asCardShows(lead.leadDate)).toBe('10/22/2026');
  });

  it('agrees with Lead Center, which reads leadDatetime', () => {
    const lead = offlineWorkToLead(work('2026-10-22T10:26:00.000Z'))!;
    // both fields are present, as they are on a server lead
    expect(lead.leadDatetime).toBeTruthy();
    expect(lead.leadDate).toBeTruthy();
    const centre = new Date(lead.leadDatetime);
    const card = new Date(lead.leadDate);
    expect(card.getFullYear()).toBe(centre.getFullYear());
    expect(card.getMonth()).toBe(centre.getMonth());
    expect(card.getDate()).toBe(centre.getDate());
  });

  it('⚠️ a late-evening UTC instant renders the REP\'s local day, not the UTC one', () => {
    // 22:30Z on the 22nd is the 23rd at +05:00 (and still the 22nd at -05:00)
    const iso = '2026-10-22T22:30:00.000Z';
    const expected = new Date(iso);
    const lead = offlineWorkToLead(work(iso))!;
    expect(asCardShows(lead.leadDate)).toBe(
      `${String(expected.getMonth() + 1).padStart(2, '0')}/${String(expected.getDate()).padStart(2, '0')}/${expected.getFullYear()}`
    );
  });

  it('the card date never disagrees with the Today-tab filter', () => {
    // both derive from the same local-day rule, so a lead on Today always prints today
    const now = Date.now();
    const lead = offlineWorkToLead(work(new Date(now).toISOString()))!;
    const today = new Date(now);
    expect(asCardShows(lead.leadDate)).toBe(
      `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`
    );
  });

  it('an ISSUED lead keeps its own scheduled date, not the creation day', () => {
    const lead = offlineWorkToLead(
      work('2026-10-22T10:26:00.000Z', { leadType: 'lfLead', lfLeadDate: '2026-11-05T00:00:00-04:00' })
    )!;
    expect(asCardShows(lead.leadDate)).toBe('11/05/2026');
  });

  it('localDateOnly is date-only and carries no zone marker', () => {
    const v = localDateOnly('2026-10-22T10:26:00.000Z');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v).not.toMatch(/[TZ]/);
  });

  it('a bad timestamp yields an empty string, so the card falls back to N/A', () => {
    expect(localDateOnly('not-a-date')).toBe('');
    expect(localDateOnly('')).toBe('');
    expect(localDateOnly(null)).toBe('');
    const lead = offlineWorkToLead(work('not-a-date'))!;
    expect(lead.leadDate).toBe('');   // falsy -> LeadCard prints N/A, as before
  });
});
