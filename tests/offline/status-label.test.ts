import { titleCaseStatus } from '../../src/utils/status-label';

describe('titleCaseStatus', () => {
  it('capitalises every word', () => {
    expect(titleCaseStatus('bank decline')).toBe('Bank Decline');
    expect(titleCaseStatus('not_interested')).toBe('Not Interested');
    expect(titleCaseStatus('  BANK   DECLINE ')).toBe('Bank Decline');
  });
  it('handles empty', () => {
    expect(titleCaseStatus(undefined)).toBe('');
    expect(titleCaseStatus('')).toBe('');
  });
});
