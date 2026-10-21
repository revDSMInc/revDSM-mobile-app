import { isNetworkError } from '../../src/utils/network-error';
import {
  LEAD_NOT_SYNCED,
  LEAD_NOT_SYNCED_MESSAGE,
  isLeadNotSyncedError,
  isSyncedLeadId,
  leadNotSyncedError,
  urlHasClientId,
} from '../../src/utils/lead-sync-state';

const REAL_ID = '6a913ac58c1e5b031b58b317';

describe('isSyncedLeadId', () => {
  it('accepts a real server id', () => {
    expect(isSyncedLeadId(REAL_ID)).toBe(true);
  });

  it.each([
    'work-1760000000000-ab12cd34e',
    'lead-1760000000000-ab12cd34e',
    'appt-1760000000000-ab12cd34e',
    'calc-1760000000000-ab12cd34e',
  ])('refuses the client id %s', (id) => {
    expect(isSyncedLeadId(id)).toBe(false);
  });

  it('fails safe on a missing id', () => {
    expect(isSyncedLeadId('')).toBe(false);
    expect(isSyncedLeadId(undefined)).toBe(false);
    expect(isSyncedLeadId(null)).toBe(false);
  });
});

describe('leadNotSyncedError', () => {
  const err = leadNotSyncedError('work-1760000000000-ab12cd34e');

  it('carries the machine code and the offending id, and no httpStatus', () => {
    expect(err.code).toBe(LEAD_NOT_SYNCED);
    expect(err.leadId).toBe('work-1760000000000-ab12cd34e');
    expect(err.message).toBe(LEAD_NOT_SYNCED_MESSAGE);
    expect((err as unknown as Record<string, unknown>).httpStatus).toBeUndefined();
  });

  it('is recognised by its own detector, and nothing else is', () => {
    expect(isLeadNotSyncedError(err)).toBe(true);
    expect(isLeadNotSyncedError({ code: 'ERR_NETWORK' })).toBe(false);
    expect(isLeadNotSyncedError(new Error('nope'))).toBe(false);
    expect(isLeadNotSyncedError(undefined)).toBe(false);
  });

  // ⚠️ Regression guard. If this fails, the message was reworded into `NETWORK_MESSAGE_RE`
  // and the app will treat an unsynced lead as a dropped connection — which feeds
  // `reportRequestSignal` and can wrongly flip the offline banner.
  it('is NOT a network error', () => {
    expect(isNetworkError(err)).toBe(false);
  });
});

describe('urlHasClientId', () => {
  it('spots a client id in any path segment', () => {
    expect(urlHasClientId('/lead/v1/work-1760000000000-ab12cd34e/funding')).toBe(true);
    expect(urlHasClientId('/lead/v1/work-1760000000000-ab12cd34e/funding/p-ab12cd34')).toBe(true);
  });

  it('leaves a real lead-scoped url alone', () => {
    expect(urlHasClientId(`/lead/v1/${REAL_ID}/funding`)).toBe(false);
    expect(urlHasClientId(`/lead/v1/${REAL_ID}/funding/p-ab12cd34`)).toBe(false);
    expect(urlHasClientId('/company/v1/down-payment-limit/sales')).toBe(false);
  });

  it('does not read the literal /lead/ prefix as a client id', () => {
    expect(urlHasClientId('/lead/v1/approvals/mine')).toBe(false);
  });

  it('ignores the query string and a missing url', () => {
    expect(urlHasClientId(`/lead/v1/${REAL_ID}/funding?from=work-1760000000000-ab12cd34e`)).toBe(false);
    expect(urlHasClientId(undefined)).toBe(false);
  });
});
import { findClientIdInUrl } from '../../src/utils/lead-sync-state';

describe('findClientIdInUrl (the app-wide api guard)', () => {
  it('returns the client id segment, e.g. the agreement delivery-preference url', () => {
    expect(findClientIdInUrl('pdf-reports/v1/agreement/lead-1760000000000-ab12cd34e/delivery-preference')).toBe(
      'lead-1760000000000-ab12cd34e'
    );
    expect(findClientIdInUrl('/lead/v1/work-1760000000000-ab12cd34e/funding')).toBe('work-1760000000000-ab12cd34e');
  });
  it('is null for a real lead id', () => {
    expect(findClientIdInUrl(`pdf-reports/v1/agreement/${'6a913ac58c1e5b031b58b317'}/delivery-preference`)).toBeNull();
    expect(findClientIdInUrl('/company/login')).toBeNull();
  });
});
