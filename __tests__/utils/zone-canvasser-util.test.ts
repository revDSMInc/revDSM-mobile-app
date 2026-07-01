import { distanceMiles, formatZoneDisplayName } from '../../src/utils/zone-canvasser-util';

describe('distanceMiles', () => {
  test('returns 0 for same point', () => {
    expect(distanceMiles(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  test('NYC to LA is ~2400 miles', () => {
    const d = distanceMiles(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2500);
  });

  test('short distance in same city', () => {
    const d = distanceMiles(40.7128, -74.006, 40.7200, -74.010);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });

  test('London to Paris is ~200 miles', () => {
    const d = distanceMiles(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(250);
  });
});

describe('formatZoneDisplayName', () => {
  test('returns "Zone Statistics" for null/empty', () => {
    expect(formatZoneDisplayName(null)).toBe('Zone Statistics');
    expect(formatZoneDisplayName({})).toBe('Zone Statistics');
  });

  test('uses zoneName when available', () => {
    expect(formatZoneDisplayName({ zoneName: 'Downtown' })).toBe('Downtown');
  });

  test('falls back to zoneId', () => {
    expect(formatZoneDisplayName({ zoneId: 'Zone-A' })).toBe('Zone-A');
  });

  test('redacts REV- prefix middle digits', () => {
    expect(formatZoneDisplayName({ zoneName: 'REV-1234567' })).toBe('REV-...4567');
  });

  test('no change for non-REV names', () => {
    expect(formatZoneDisplayName({ zoneName: 'Alpha Zone' })).toBe('Alpha Zone');
  });

  test('zoneId fallback with REV pattern', () => {
    expect(formatZoneDisplayName({ zoneId: 'REV-9876543' })).toBe('REV-...6543');
  });
});
