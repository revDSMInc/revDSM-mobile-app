import { DeviceEventEmitter } from 'react-native';
import { storage } from '../storage';
import { LeadService } from '../../services/api/leads';
import { fireRolloutLog } from '../activity-log/rollout-log-meta';
import { setRolloutConfirmedTimestamp } from '../activity-log/rollout-confirmed-at';

interface PendingConfirmItem {
  calculatorId: string;
  price: number;
  timestamp: number;
  name?: string;
  inputs?: any;
  extras?: any;
  paymentMethod?: string;
  pricemarkup?: string;
  discounts?: any;
  appointmentId?: string;
  userId?: string;
  retryCount?: number;
}

const STORAGE_KEY = 'REV_DSM_PENDING_CONFIRM_CALCULATORS';

const getQueue = (): Record<string, PendingConfirmItem> => {
  try {
    const data = storage.getString(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
};

const saveQueue = (queue: Record<string, PendingConfirmItem>) => {
  try {
    storage.set(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('[AutoConfirmManager] Failed to save queue to MMKV', e);
  }
};

const processQueue = async (opts?: { onReturn?: boolean }) => {
  const accessToken = storage.getString('accessToken');
  if (!accessToken) return;

  const queue = getQueue();
  const keys = Object.keys(queue);
  if (keys.length === 0) return;

  const now = Date.now();
  const tenMinutesMs = 10 * 60 * 1000;
  const leadId = storage.getString('leadId') || undefined;
  const confirmAction = opts?.onReturn
    ? 'rollout auto-confirmed (10 min inactivity - on page return)'
    : 'rollout auto-confirmed (10 min inactivity)';

  for (const calcId of keys) {
    const item = queue[calcId];
    if (now - item.timestamp >= tenMinutesMs) {
      try {
        const payload: any = {
          ...item.inputs,
          ...item.extras,
          paymentMethod: item.paymentMethod,
          pricemarkup: item.pricemarkup,
          price: item.price,
          isRolloutConfirmed: true,
          seniorVet: item.discounts?.seniorVet,
          preOrder: item.discounts?.preOrder,
        };

        if (item.name && item.name !== '.' && !item.name.startsWith('Rollout ')) {
          payload.title = item.name;
        }

        await LeadService.updateCalculator(calcId, payload);

        delete queue[calcId];
        saveQueue(queue);

        if (item.userId && leadId) {
          setRolloutConfirmedTimestamp(leadId, calcId);
          await fireRolloutLog(
            item.userId,
            {
              _id: calcId,
              appointmentId: item.appointmentId,
              name: item.name,
              title: item.name,
              inputs: item.inputs || {},
              extras: item.extras || {},
              price: item.price,
            },
            {
              fieldName: opts?.onReturn ? 'rolloutAutoConfirmedOnReturn' : 'rolloutConfirmed',
              fieldLabel: opts?.onReturn
                ? 'Rollout Auto-Confirmed (Returned from Other Page)'
                : 'Rollout Confirmed',
              fieldValue: item.price,
              fieldCategory: 'rollout',
              oldValue: '',
              newValue: item.price,
              action: confirmAction,
              ...(opts?.onReturn ? { autoConfirmed: true } : {}),
            },
            leadId
          );
        }

        DeviceEventEmitter.emit('calculatorAutoConfirmed', { calculatorId: calcId });
      } catch (err: any) {
        item.retryCount = (item.retryCount || 0) + 1;
        const status = err?.response?.status || err?.status;
        if (item.retryCount >= 3 || status === 400 || status === 401 || status === 403 || status === 404) {
          delete queue[calcId];
          saveQueue(queue);
        } else {
          queue[calcId] = item;
          saveQueue(queue);
        }
      }
    }
  }
};

export const autoConfirmManager = {
  registerPendingConfirm: (calc: any, userId?: string) => {
    if (!calc || !calc._id) return;

    const queue = getQueue();
    const hasPrice = Number(calc.price) > 0;
    const isUnconfirmed = !calc.isRolloutConfirmed;

    if (hasPrice && isUnconfirmed) {
      if (!queue[calc._id]) {
        queue[calc._id] = {
          calculatorId: calc._id,
          price: Number(calc.price),
          timestamp: Date.now(),
          name: calc.name || calc.title || '',
          inputs: calc.inputs || {},
          extras: calc.extras || {},
          paymentMethod: calc.inputs?.paymentPlan || calc.paymentMethod || 'check',
          pricemarkup: calc.inputs?.markup || calc.pricemarkup || '100',
          discounts: calc.discounts || {},
          appointmentId: calc.appointmentId,
          userId,
          retryCount: 0,
        };
        saveQueue(queue);
      } else if (userId && !queue[calc._id].userId) {
        queue[calc._id].userId = userId;
        saveQueue(queue);
      }
    } else if (queue[calc._id]) {
      delete queue[calc._id];
      saveQueue(queue);
    }
  },

  removePendingConfirm: (calcId: string) => {
    const queue = getQueue();
    if (queue[calcId]) {
      delete queue[calcId];
      saveQueue(queue);
    }
  },

  startAutoConfirmScheduler: () => {
    processQueue();
    const interval = setInterval(() => processQueue(), 10000);
    return () => clearInterval(interval);
  },

  checkPendingOnReturn: () => processQueue({ onReturn: true }),
};
