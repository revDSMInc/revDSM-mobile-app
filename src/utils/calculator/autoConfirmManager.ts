import { DeviceEventEmitter } from 'react-native';
import { storage } from '../storage';
import { LeadService } from '../../services/api/leads';

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
    console.error('[AutoConfirmManager] Failed to save queue to MMKV', e);
  }
};

export const autoConfirmManager = {
  registerPendingConfirm: (calc: any) => {
    if (!calc || !calc._id) return;

    const queue = getQueue();
    const hasPrice = Number(calc.price) > 0;
    const isUnconfirmed = !calc.isRolloutConfirmed;

    if (hasPrice && isUnconfirmed) {
      // If not in queue, register it with the current timestamp
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
        };
        saveQueue(queue);
        console.log(`[AutoConfirmManager] Registered calculator ${calc._id} for auto-confirmation at ${new Date(queue[calc._id].timestamp).toLocaleTimeString()}`);
      }
    } else {
      // If confirmed or price reset to 0, remove it from queue
      if (queue[calc._id]) {
        delete queue[calc._id];
        saveQueue(queue);
        console.log(`[AutoConfirmManager] Removed calculator ${calc._id} from auto-confirmation queue.`);
      }
    }
  },

  removePendingConfirm: (calcId: string) => {
    const queue = getQueue();
    if (queue[calcId]) {
      delete queue[calcId];
      saveQueue(queue);
      console.log(`[AutoConfirmManager] Explicitly removed calculator ${calcId} from queue.`);
    }
  },

  startAutoConfirmScheduler: () => {
    console.log('[AutoConfirmManager] Starting auto-confirm scheduler...');
    
    const checkQueue = async () => {
      // Do not run auto-confirm scheduler checks if the user is logged out (token is missing)
      const accessToken = storage.getString('accessToken');
      if (!accessToken) {
        console.log('[AutoConfirmManager] User is logged out. Skipping auto-confirm check.');
        return;
      }

      const queue = getQueue();
      const keys = Object.keys(queue);
      if (keys.length === 0) return;

      const now = Date.now();
      const tenMinutesMs = 10 * 60 * 1000;

      for (const calcId of keys) {
        const item = queue[calcId];
        if (now - item.timestamp >= tenMinutesMs) {
          console.log(`[AutoConfirmManager] 10 minutes elapsed for calculator ${calcId}. Confirming automatically...`);
          
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

            // Only include title if it is a valid unique name (not empty or .)
            if (item.name && item.name !== '.' && !item.name.startsWith('Rollout ')) {
              payload.title = item.name;
            }

            await LeadService.updateCalculator(calcId, payload);
            
            // Remove from queue
            delete queue[calcId];
            saveQueue(queue);

            // Notify active components to refresh UI
            DeviceEventEmitter.emit('calculatorAutoConfirmed', { calculatorId: calcId });
            console.log(`[AutoConfirmManager] Successfully auto-confirmed calculator ${calcId}.`);
          } catch (err: any) {
            console.error(`[AutoConfirmManager] Failed to auto-confirm calculator ${calcId}:`, err);
            // If calculator is deleted (404), remove it from queue
            if (err?.response?.status === 404 || err?.status === 404) {
              delete queue[calcId];
              saveQueue(queue);
              console.log(`[AutoConfirmManager] Calculator ${calcId} returned 404. Removed from queue.`);
            }
          }
        }
      }
    };

    // Run check immediately on start, then every 10 seconds
    checkQueue();
    const interval = setInterval(checkQueue, 10000);
    return () => clearInterval(interval);
  },
};
