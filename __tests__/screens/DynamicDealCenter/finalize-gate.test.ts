import {
  isRequiredDocumentationComplete,
  canCompleteJobBuilder,
  finalizeBlockedReason,
} from '../../../src/screens/DynamicDealCenter/utils/finalize-gate';

const base = {
  portalUnrestrictedEdit: false,
  areAllTabsComplete: true,
  isSale: false,
  isDemo: false,
  isAppointmentSet: false,
  hasAgreementDoc: false,
  hasOrderSheetDoc: false,
};

describe('isRequiredDocumentationComplete (web parity)', () => {
  test('sale requires an agreement, demo requires an order sheet', () => {
    expect(isRequiredDocumentationComplete({ isSale: true, isDemo: false, hasAgreementDoc: false, hasOrderSheetDoc: false })).toBe(false);
    expect(isRequiredDocumentationComplete({ isSale: true, isDemo: false, hasAgreementDoc: true, hasOrderSheetDoc: false })).toBe(true);
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: true, hasAgreementDoc: false, hasOrderSheetDoc: false })).toBe(false);
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: true, hasAgreementDoc: false, hasOrderSheetDoc: true })).toBe(true);
  });
  test('neither sale nor demo → nothing required', () => {
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: false, hasAgreementDoc: false, hasOrderSheetDoc: false })).toBe(true);
  });
});

describe('canCompleteJobBuilder (web parity — the key fix)', () => {
  test('SALE cannot finalize without agreement even with appointment + tabs', () => {
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: false })).toBe(false);
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: true })).toBe(true);
  });
  test('SALE cannot finalize without the install appointment', () => {
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: false, hasAgreementDoc: true })).toBe(false);
  });
  test('DEMO cannot finalize without an order sheet', () => {
    expect(canCompleteJobBuilder({ ...base, isDemo: true, hasOrderSheetDoc: false })).toBe(false);
    expect(canCompleteJobBuilder({ ...base, isDemo: true, hasOrderSheetDoc: true })).toBe(true);
  });
  test('incomplete tabs always blocks', () => {
    expect(canCompleteJobBuilder({ ...base, areAllTabsComplete: false, isSale: true, isAppointmentSet: true, hasAgreementDoc: true })).toBe(false);
  });
  test('portal unrestricted edit bypasses all gates', () => {
    expect(canCompleteJobBuilder({ ...base, portalUnrestrictedEdit: true, areAllTabsComplete: false })).toBe(true);
  });
});

describe('finalizeBlockedReason', () => {
  test('names the specific blocker', () => {
    expect(finalizeBlockedReason({ ...base, areAllTabsComplete: false })).toMatch(/product tabs/i);
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: false, hasAgreementDoc: true })).toMatch(/appointment/i);
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: false })).toMatch(/agreement/i);
    expect(finalizeBlockedReason({ ...base, isDemo: true, hasOrderSheetDoc: false })).toMatch(/order sheet/i);
  });
  test('empty when completable', () => {
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: true })).toBe('');
  });
});
