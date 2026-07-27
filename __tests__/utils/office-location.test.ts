import { getOfficeCoords } from '../../src/utils/office-location';

// Shape taken from the real `/company` response.
const office = (overrides: any = {}) => ({
  location: { city: 'Sarasota', street: '4630 Country Manor Dr', zipCode: '34233' },
  verifiedAddress: {
    valid: true,
    lat: 27.904627,
    lon: -82.3875237,
    displayName: 'N/A',
    address: '4422 Eagle Falls Pl, Tampa, FL 33619, USA',
  },
  _id: '6a570bf74a3c86dc2601b0dd',
  name: 'Sarasota',
  code: '01',
  lat: null,
  long: null,
  assigned: true,
  status: 'active',
  ...overrides,
});

describe('getOfficeCoords', () => {
  test('reads verifiedAddress when the top-level lat/long are null', () => {
    expect(getOfficeCoords({ office: [office()] })).toEqual({
      latitude: 27.904627,
      longitude: -82.3875237,
    });
  });

  test('falls back to the office lat/long when verifiedAddress is absent', () => {
    const o = office({ verifiedAddress: undefined, lat: 27.95, long: -82.45 });
    expect(getOfficeCoords({ office: [o] })).toEqual({ latitude: 27.95, longitude: -82.45 });
  });

  test('accepts numeric strings', () => {
    const o = office({ verifiedAddress: { lat: '27.5', lon: '-82.5' } });
    expect(getOfficeCoords({ office: [o] })).toEqual({ latitude: 27.5, longitude: -82.5 });
  });

  test('prefers the assigned office', () => {
    const unassigned = office({ assigned: false, verifiedAddress: { lat: 40, lon: -74 } });
    const assigned = office({ assigned: true, verifiedAddress: { lat: 27.9, lon: -82.3 } });
    expect(getOfficeCoords({ office: [unassigned, assigned] })).toEqual({
      latitude: 27.9,
      longitude: -82.3,
    });
  });

  test('falls back to the first locatable office when none is assigned', () => {
    const noCoords = office({ assigned: false, verifiedAddress: undefined, lat: null, long: null });
    const located = office({ assigned: false, verifiedAddress: { lat: 30, lon: -81 } });
    expect(getOfficeCoords({ office: [noCoords, located] })).toEqual({
      latitude: 30,
      longitude: -81,
    });
  });

  test('accepts a single office object as well as an array', () => {
    expect(getOfficeCoords({ office: office() })).toEqual({
      latitude: 27.904627,
      longitude: -82.3875237,
    });
  });

  test('returns null when there is no locatable office', () => {
    expect(getOfficeCoords(null)).toBeNull();
    expect(getOfficeCoords({})).toBeNull();
    expect(getOfficeCoords({ office: [] })).toBeNull();
    expect(
      getOfficeCoords({ office: [office({ verifiedAddress: undefined, lat: null, long: null })] })
    ).toBeNull();
  });

  test('rejects the (0,0) placeholder and out-of-range values', () => {
    expect(getOfficeCoords({ office: [office({ verifiedAddress: { lat: 0, lon: 0 } })] })).toBeNull();
    expect(
      getOfficeCoords({ office: [office({ verifiedAddress: { lat: 200, lon: -82 } })] })
    ).toBeNull();
  });
});
