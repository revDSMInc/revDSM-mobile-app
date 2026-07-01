import {
  GEOFENCE_RADIUS_MILES,
  calculateDistance,
  isSelfGeneratedLead,
  canCheckIn,
  isResumeAppointment,
  getScheduledDateTime,
} from '../../src/utils/location-util';

describe('calculateDistance', () => {
  test('returns 0 for same coordinates', () => {
    expect(calculateDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  test('calculates distance between NYC and LA', () => {
    const dist = calculateDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(dist).toBeGreaterThan(2000);
    expect(dist).toBeLessThan(3000);
  });

  test('calculates short distances accurately', () => {
    const dist = calculateDistance(40.7128, -74.006, 40.7138, -74.007);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(0.1);
  });
});

describe('isSelfGeneratedLead', () => {
  test('returns false when leadTime is present', () => {
    expect(isSelfGeneratedLead({ leadTime: '9am' })).toBe(false);
  });

  test('returns true when leadTime is null', () => {
    expect(isSelfGeneratedLead({ leadTime: null })).toBe(true);
  });

  test('returns true when leadTime is N/A', () => {
    expect(isSelfGeneratedLead({ leadTime: 'N/A' })).toBe(true);
  });

  test('returns true when isSelfGen is true', () => {
    expect(isSelfGeneratedLead({ isSelfGen: true })).toBe(true);
  });

  test('returns true when selfGen is true', () => {
    expect(isSelfGeneratedLead({ selfGen: true })).toBe(true);
  });

  test('returns true when leadType is selfGen', () => {
    expect(isSelfGeneratedLead({ leadType: 'selfGen' })).toBe(true);
  });

  test('returns true when status is selfGenerated', () => {
    expect(isSelfGeneratedLead({ status: 'selfGenerated' })).toBe(true);
  });

  test('returns true for undefined/empty lead (no leadTime means self-gen)', () => {
    expect(isSelfGeneratedLead(undefined)).toBe(true);
    expect(isSelfGeneratedLead({})).toBe(true);
  });
});

describe('canCheckIn', () => {
  test('returns true when workflowState is preview', () => {
    expect(canCheckIn({ workflowState: 'preview' })).toBe(true);
  });

  test('returns true when checkInCount > 0', () => {
    expect(canCheckIn({ checkInCount: 1 })).toBe(true);
  });

  test('returns true when checkIns array has items', () => {
    expect(canCheckIn({ checkIns: [{ timestamp: 1 }] })).toBe(true);
  });

  test('returns true when lastCheckIn is set', () => {
    expect(canCheckIn({ lastCheckIn: '2024-01-01' })).toBe(true);
  });

  test('returns false when no check-in activity exists', () => {
    expect(canCheckIn({ workflowState: 'new' })).toBe(false);
  });
});

describe('isResumeAppointment', () => {
  test('returns true for resume state', () => {
    expect(isResumeAppointment({ workflowState: 'resume' })).toBe(true);
  });

  test('returns false for other states', () => {
    expect(isResumeAppointment({ workflowState: 'preview' })).toBe(false);
    expect(isResumeAppointment({ workflowState: 'new' })).toBe(false);
    expect(isResumeAppointment({})).toBe(false);
  });
});

describe('getScheduledDateTime', () => {
  test('returns null when no leadTime', () => {
    expect(getScheduledDateTime({ leadDate: '2024-03-15' })).toBeNull();
  });

  test('returns null when no date', () => {
    expect(getScheduledDateTime({ leadTime: '9am' })).toBeNull();
  });

  test('returns correct Date for 9am', () => {
    const dt = getScheduledDateTime({ leadTime: '9am', leadDate: '2024-03-15' });
    expect(dt).not.toBeNull();
    expect(dt!.getHours()).toBe(9);
    expect(dt!.getDate()).toBe(15);
  });

  test('returns correct Date for 1pm', () => {
    const dt = getScheduledDateTime({ leadTime: '1pm', leadDate: '2024-03-15' });
    expect(dt!.getHours()).toBe(13);
  });

  test('returns correct Date for 12pm (noon)', () => {
    const dt = getScheduledDateTime({ leadTime: '12pm', leadDate: '2024-03-15' });
    expect(dt!.getHours()).toBe(12);
  });

  test('returns correct Date for 12am (midnight)', () => {
    const dt = getScheduledDateTime({ leadTime: '12am', leadDate: '2024-03-15' });
    expect(dt!.getHours()).toBe(0);
  });

  test('returns null for invalid date string', () => {
    expect(getScheduledDateTime({ leadTime: '9am', leadDate: 'invalid' })).toBeNull();
  });
});
