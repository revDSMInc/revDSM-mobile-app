import { Storage } from '../../../src/utils/storage';

jest.mock('../../../src/utils/storage', () => ({
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
  getRolloutConfirmedTimestamps,
  setRolloutConfirmedTimestamp,
  consumeRolloutConfirmedTimestamp,
} from '../../../src/utils/activity-log/rollout-confirmed-at';

const LEAD_ID = 'lead-123';
const CALC_ID = 'calc-456';

function initStore(data: Record<string, string>) {
  mockGetItem.mockImplementation((key: string) => data[key] ?? null);
  mockSetItem.mockImplementation((key: string, value: string) => { data[key] = value; });
  mockRemoveItem.mockImplementation((key: string) => { delete data[key]; });
}

describe('rollout-confirmed-at', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    initStore(store);
  });

  describe('getRolloutConfirmedTimestamps', () => {
    test('returns empty object when no data stored', () => {
      expect(getRolloutConfirmedTimestamps(LEAD_ID)).toEqual({});
    });

    test('returns parsed JSON when data exists', () => {
      setRolloutConfirmedTimestamp(LEAD_ID, CALC_ID, 1000);
      const result = getRolloutConfirmedTimestamps(LEAD_ID);
      expect(result[CALC_ID]).toBe(1000);
    });

    test('returns empty object when stored data is invalid JSON', () => {
      store[`rollout_confirmed_at_${LEAD_ID}`] = 'not-json';
      expect(getRolloutConfirmedTimestamps(LEAD_ID)).toEqual({});
    });
  });

  describe('setRolloutConfirmedTimestamp', () => {
    test('stores timestamp for calculator', () => {
      setRolloutConfirmedTimestamp(LEAD_ID, CALC_ID, 5000);
      const map = getRolloutConfirmedTimestamps(LEAD_ID);
      expect(map[CALC_ID]).toBe(5000);
    });

    test('uses Date.now() when no ts provided', () => {
      const now = 12345678;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      setRolloutConfirmedTimestamp(LEAD_ID, CALC_ID);
      const map = getRolloutConfirmedTimestamps(LEAD_ID);
      expect(map[CALC_ID]).toBe(now);
    });

    test('stores multiple calculators independently', () => {
      setRolloutConfirmedTimestamp(LEAD_ID, 'calc-1', 100);
      setRolloutConfirmedTimestamp(LEAD_ID, 'calc-2', 200);
      const map = getRolloutConfirmedTimestamps(LEAD_ID);
      expect(map['calc-1']).toBe(100);
      expect(map['calc-2']).toBe(200);
    });
  });

  describe('consumeRolloutConfirmedTimestamp', () => {
    test('returns timestamp and removes entry', () => {
      setRolloutConfirmedTimestamp(LEAD_ID, CALC_ID, 3000);
      const ts = consumeRolloutConfirmedTimestamp(LEAD_ID, CALC_ID);
      expect(ts).toBe(3000);
      expect(getRolloutConfirmedTimestamps(LEAD_ID)).toEqual({});
    });

    test('returns null for missing calculator', () => {
      expect(consumeRolloutConfirmedTimestamp(LEAD_ID, 'nonexistent')).toBeNull();
    });

    test('removes only the consumed calculator', () => {
      setRolloutConfirmedTimestamp(LEAD_ID, 'calc-1', 100);
      setRolloutConfirmedTimestamp(LEAD_ID, 'calc-2', 200);
      consumeRolloutConfirmedTimestamp(LEAD_ID, 'calc-1');
      const map = getRolloutConfirmedTimestamps(LEAD_ID);
      expect(map['calc-1']).toBeUndefined();
      expect(map['calc-2']).toBe(200);
    });
  });
});
