import {
  SESSION_KEEP_KEYS,
  isOwnedBy,
  isSessionScopedKey,
  sessionKeysToClear,
} from '../../src/utils/session-scope';

describe('what survives a logout', () => {
  it.each([
    'offline_lead_work',
    'upload_photo_queue',
    'annotation_save_jobs',
    'offline_activity_logs',
    'offline_lead_workflow',
    'offline-photo-deletes',
    'offline-agreement-delivery',
    'offline_image_uploads',
    'accessToken',
  ])('keeps %s', (key) => {
    expect(isSessionScopedKey(key)).toBe(false);
    expect(SESSION_KEEP_KEYS.has(key)).toBe(true);
  });

  it('keeps pending calculator settings per owner, never the un-owned legacy key', () => {
    expect(isSessionScopedKey('offline_calculator_settings:rep-1')).toBe(false);
    expect(isSessionScopedKey('offline_calculator_settings')).toBe(true);
  });

  it('still clears caches and anything unknown', () => {
    expect(isSessionScopedKey('offline-cache:leads-list:all:rep-1')).toBe(true);
    expect(sessionKeysToClear(['offline_image_uploads', 'something-else', 'persist:auth'])).toEqual(['something-else']);
  });
});

describe('isOwnedBy', () => {
  it('matches only the signed-in owner, and never when nobody is signed in', () => {
    expect(isOwnedBy('rep-1', 'rep-1')).toBe(true);
    expect(isOwnedBy(' rep-1 ', 'rep-1')).toBe(true);
    expect(isOwnedBy('rep-1', 'rep-2')).toBe(false);
    expect(isOwnedBy('rep-1', '')).toBe(false);
    expect(isOwnedBy(undefined, '')).toBe(false);
  });
});
