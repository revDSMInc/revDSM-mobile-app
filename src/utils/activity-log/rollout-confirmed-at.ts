import { Storage } from '../storage';

const storageKey = (leadId: string) => `rollout_confirmed_at_${leadId}`;

export const getRolloutConfirmedTimestamps = (leadId: string): Record<string, number> => {
  try {
    const raw = Storage.getItem(storageKey(leadId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const setRolloutConfirmedTimestamp = (leadId: string, calculatorId: string, ts = Date.now()) => {
  const map = getRolloutConfirmedTimestamps(leadId);
  map[calculatorId] = ts;
  Storage.setItem(storageKey(leadId), JSON.stringify(map));
};

export const consumeRolloutConfirmedTimestamp = (leadId: string, calculatorId: string): number | null => {
  const map = getRolloutConfirmedTimestamps(leadId);
  const ts = map[calculatorId];
  if (ts) {
    delete map[calculatorId];
    Storage.setItem(storageKey(leadId), JSON.stringify(map));
    return ts;
  }
  return null;
};
