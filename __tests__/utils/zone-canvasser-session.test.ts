import { Storage } from '../../src/utils/storage';

jest.mock('../../src/utils/storage', () => ({
  Storage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const mockGetItem = Storage.getItem as jest.Mock;
const mockSetItem = Storage.setItem as jest.Mock;
const mockRemoveItem = Storage.removeItem as jest.Mock;

import {
  saveZoneMapState,
  peekZoneMapState,
  clearZoneMapState,
  getAndClearZoneMapState,
  markZoneCanvasserShouldReopen,
  peekZoneCanvasserReopen,
  consumeZoneCanvasserReopen,
} from '../../src/utils/zone-canvasser-session';

const ZONE_MAP_STATE_KEY = 'zoneMapState';
const ZONE_CANVASSER_OPEN_KEY = 'zoneCanvasserOpen';

const SAMPLE_STATE = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
  buildingId: 'bldg-1',
};

describe('zone-canvasser-session', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    mockGetItem.mockImplementation((key: string) => store[key] ?? null);
    mockSetItem.mockImplementation((key: string, value: string) => { store[key] = value; });
    mockRemoveItem.mockImplementation((key: string) => { delete store[key]; });
  });

  describe('saveZoneMapState / peekZoneMapState', () => {
    test('saves and retrieves map state', () => {
      saveZoneMapState(SAMPLE_STATE);
      expect(peekZoneMapState()).toEqual(SAMPLE_STATE);
    });

    test('returns null when no state saved', () => {
      expect(peekZoneMapState()).toBeNull();
    });
  });

  describe('clearZoneMapState', () => {
    test('clears saved map state', () => {
      saveZoneMapState(SAMPLE_STATE);
      clearZoneMapState();
      expect(peekZoneMapState()).toBeNull();
    });
  });

  describe('getAndClearZoneMapState', () => {
    test('returns state and clears it', () => {
      saveZoneMapState(SAMPLE_STATE);
      const result = getAndClearZoneMapState();
      expect(result).toEqual(SAMPLE_STATE);
      expect(peekZoneMapState()).toBeNull();
    });

    test('returns null when no state saved', () => {
      expect(getAndClearZoneMapState()).toBeNull();
    });
  });

  describe('zone canvasser reopen flag', () => {
    test('mark and peek', () => {
      expect(peekZoneCanvasserReopen()).toBe(false);
      markZoneCanvasserShouldReopen();
      expect(peekZoneCanvasserReopen()).toBe(true);
    });

    test('consume returns true only once', () => {
      markZoneCanvasserShouldReopen();
      expect(consumeZoneCanvasserReopen()).toBe(true);
      expect(consumeZoneCanvasserReopen()).toBe(false);
      expect(peekZoneCanvasserReopen()).toBe(false);
    });

    test('consume returns false when not set', () => {
      expect(consumeZoneCanvasserReopen()).toBe(false);
    });
  });
});
