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

describe('isRequiredDocumentationComplete', () => {
  test('an order sheet is required for every job (sale or demo)', () => {
    // Demo — order sheet only.
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: true, hasAgreementDoc: false, hasOrderSheetDoc: false })).toBe(false);
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: true, hasAgreementDoc: false, hasOrderSheetDoc: true })).toBe(true);
  });
  test('a sale requires BOTH an order sheet and a signed agreement', () => {
    expect(isRequiredDocumentationComplete({ isSale: true, isDemo: false, hasAgreementDoc: false, hasOrderSheetDoc: false })).toBe(false);
    // agreement present but order sheet missing → still blocked.
    expect(isRequiredDocumentationComplete({ isSale: true, isDemo: false, hasAgreementDoc: true, hasOrderSheetDoc: false })).toBe(false);
    // order sheet present but agreement missing → still blocked.
    expect(isRequiredDocumentationComplete({ isSale: true, isDemo: false, hasAgreementDoc: false, hasOrderSheetDoc: true })).toBe(false);
    // both present → ok.
    expect(isRequiredDocumentationComplete({ isSale: true, isDemo: false, hasAgreementDoc: true, hasOrderSheetDoc: true })).toBe(true);
  });
  test('neither sale nor demo → still requires an order sheet', () => {
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: false, hasAgreementDoc: false, hasOrderSheetDoc: false })).toBe(false);
    expect(isRequiredDocumentationComplete({ isSale: false, isDemo: false, hasAgreementDoc: false, hasOrderSheetDoc: true })).toBe(true);
  });
});

describe('canCompleteJobBuilder', () => {
  test('SALE cannot finalize without agreement even with appointment + tabs + order sheet', () => {
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: true, hasOrderSheetDoc: true, hasAgreementDoc: false })).toBe(false);
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: true, hasOrderSheetDoc: true, hasAgreementDoc: true })).toBe(true);
  });
  test('SALE cannot finalize without an order sheet (even with agreement + appointment)', () => {
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: true, hasOrderSheetDoc: false })).toBe(false);
  });
  test('SALE cannot finalize without the install appointment', () => {
    expect(canCompleteJobBuilder({ ...base, isSale: true, isAppointmentSet: false, hasAgreementDoc: true, hasOrderSheetDoc: true })).toBe(false);
  });
  test('DEMO cannot finalize without an order sheet', () => {
    expect(canCompleteJobBuilder({ ...base, isDemo: true, hasOrderSheetDoc: false })).toBe(false);
    expect(canCompleteJobBuilder({ ...base, isDemo: true, hasOrderSheetDoc: true })).toBe(true);
  });
  test('incomplete tabs always blocks', () => {
    expect(canCompleteJobBuilder({ ...base, areAllTabsComplete: false, isSale: true, isAppointmentSet: true, hasAgreementDoc: true, hasOrderSheetDoc: true })).toBe(false);
  });
  test('portal unrestricted edit bypasses all gates', () => {
    expect(canCompleteJobBuilder({ ...base, portalUnrestrictedEdit: true, areAllTabsComplete: false })).toBe(true);
  });
});

describe('finalizeBlockedReason', () => {
  test('names the specific blocker', () => {
    expect(finalizeBlockedReason({ ...base, areAllTabsComplete: false })).toMatch(/product tabs/i);
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: false, hasAgreementDoc: true, hasOrderSheetDoc: true })).toMatch(/appointment/i);
    // Order sheet is checked before the agreement for a sale.
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: true, hasOrderSheetDoc: false })).toMatch(/order sheet/i);
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: false, hasOrderSheetDoc: true })).toMatch(/agreement/i);
    expect(finalizeBlockedReason({ ...base, isDemo: true, hasOrderSheetDoc: false })).toMatch(/order sheet/i);
  });
  test('empty when completable', () => {
    expect(finalizeBlockedReason({ ...base, isSale: true, isAppointmentSet: true, hasAgreementDoc: true, hasOrderSheetDoc: true })).toBe('');
  });
});
