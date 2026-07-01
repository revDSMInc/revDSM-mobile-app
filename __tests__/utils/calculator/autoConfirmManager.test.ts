jest.mock('react-native', () => ({
  DeviceEventEmitter: { emit: jest.fn() },
}));

jest.mock('../../../src/utils/storage', () => ({
  storage: {
    getString: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('../../../src/services/api/leads', () => ({
  LeadService: {
    updateCalculator: jest.fn(),
  },
}));

jest.mock('../../../src/utils/activity-log/rollout-log-meta', () => ({
  fireRolloutLog: jest.fn(),
}));

jest.mock('../../../src/utils/activity-log/rollout-confirmed-at', () => ({
  setRolloutConfirmedTimestamp: jest.fn(),
}));

import { DeviceEventEmitter } from 'react-native';
import { storage } from '../../../src/utils/storage';
import { LeadService } from '../../../src/services/api/leads';
import { autoConfirmManager } from '../../../src/utils/calculator/autoConfirmManager';

describe('autoConfirmManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerPendingConfirm', () => {
    test('does nothing when calc is null/undefined', () => {
      autoConfirmManager.registerPendingConfirm(null);
      expect(storage.getString).not.toHaveBeenCalled();

      autoConfirmManager.registerPendingConfirm(undefined);
      expect(storage.getString).not.toHaveBeenCalled();
    });

    test('does nothing when calc has no _id', () => {
      autoConfirmManager.registerPendingConfirm({ price: 100 });
      expect(storage.getString).not.toHaveBeenCalled();
    });

    test('registers calc with valid price and isRolloutConfirmed=false', () => {
      (storage.getString as jest.Mock).mockReturnValue('{}');

      const calc = {
        _id: 'calc-1',
        price: 10000,
        isRolloutConfirmed: false,
        name: 'My Job',
        inputs: { paymentPlan: 'check', markup: '100' },
        extras: {},
        discounts: { seniorVet: false, preOrder: false },
      };

      autoConfirmManager.registerPendingConfirm(calc);

      expect(storage.getString).toHaveBeenCalledWith('REV_DSM_PENDING_CONFIRM_CALCULATORS');
      expect(storage.set).toHaveBeenCalled();
    });

    test('does not register calc with isRolloutConfirmed=true', () => {
      (storage.getString as jest.Mock).mockReturnValue('{}');

      const calc = {
        _id: 'calc-2',
        price: 10000,
        isRolloutConfirmed: true,
      };

      autoConfirmManager.registerPendingConfirm(calc);
      expect(storage.set).not.toHaveBeenCalled();
    });

    test('does not register calc with zero price', () => {
      (storage.getString as jest.Mock).mockReturnValue('{}');

      const calc = {
        _id: 'calc-3',
        price: 0,
        isRolloutConfirmed: false,
      };

      autoConfirmManager.registerPendingConfirm(calc);
      expect(storage.set).not.toHaveBeenCalled();
    });

    test('removes from queue when price exists but already confirmed', () => {
      (storage.getString as jest.Mock).mockReturnValue(
        JSON.stringify({ 'calc-1': { calculatorId: 'calc-1', price: 10000 } })
      );

      const calc = {
        _id: 'calc-1',
        price: 10000,
        isRolloutConfirmed: true,
      };

      autoConfirmManager.registerPendingConfirm(calc);
      expect(storage.set).toHaveBeenCalled();
      const setCall = (storage.set as jest.Mock).mock.calls[0];
      const saved = JSON.parse(setCall[1]);
      expect(saved['calc-1']).toBeUndefined();
    });
  });

  describe('removePendingConfirm', () => {
    test('removes calc from queue when exists', () => {
      (storage.getString as jest.Mock).mockReturnValue(
        JSON.stringify({ 'calc-1': { calculatorId: 'calc-1', price: 10000 } })
      );

      autoConfirmManager.removePendingConfirm('calc-1');
      expect(storage.set).toHaveBeenCalled();
    });

    test('does nothing when calcId not in queue', () => {
      (storage.getString as jest.Mock).mockReturnValue(JSON.stringify({}));

      autoConfirmManager.removePendingConfirm('calc-nonexistent');
      expect(storage.set).not.toHaveBeenCalled();
    });
  });

  describe('startAutoConfirmScheduler', () => {
    test('returns a cleanup function', () => {
      const cleanup = autoConfirmManager.startAutoConfirmScheduler();
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('checkPendingOnReturn', () => {
    test('processes queue on return', () => {
      autoConfirmManager.checkPendingOnReturn();
    });
  });
});
