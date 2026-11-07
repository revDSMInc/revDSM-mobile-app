import { optInMethodBadges, optInPlanOptions } from '../../src/utils/opt-in-methods';

const CK = { key: 'check', label: 'CK' };
const CC = { key: 'mcVisaDscvr', label: 'CC' };
const AMEX = { key: 'amex', label: 'AMEX' };
const ACH = { key: 'lowes_ach', label: 'ACH' };
const LCC = { key: 'lowes_cc', label: 'CC' };
const plan = (key: string, monthly = 100) => ({ key, monthly, terms: key });

describe('optInMethodBadges', () => {
  it('offers CK and CC, as the client asked', () => {
    expect(optInMethodBadges([CK, CC, AMEX], 'gs1509')).toEqual([CK, CC]);
  });

  it('shows AMEX when it is the selected method, so something is always highlighted', () => {
    expect(optInMethodBadges([CK, CC, AMEX], 'amex')).toEqual([CK, CC, AMEX]);
  });

  it('offers ACH and CC on a Lowe\'s lead', () => {
    expect(optInMethodBadges([ACH, LCC], 'x', true)).toEqual([ACH, LCC]);
  });

  it('is safe on nothing', () => {
    expect(optInMethodBadges(null, 'check')).toEqual([]);
  });
});

describe('optInPlanOptions', () => {
  it('lists the plans added on the card', () => {
    const list = [plan('a'), plan('b')];
    expect(optInPlanOptions(list, plan('a'))).toBe(list);
  });

  it('adds the selected plan when it is missing from the shortlist', () => {
    expect(optInPlanOptions([plan('a')], plan('b')).map((p) => p.key)).toEqual(['a', 'b']);
  });

  it('adds nothing when CK or CC is selected', () => {
    const list = [plan('a')];
    expect(optInPlanOptions(list, null)).toBe(list);
  });

  it('is safe on nothing', () => {
    expect(optInPlanOptions(null, null)).toEqual([]);
  });
});
