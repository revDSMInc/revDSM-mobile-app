import { createMMKV, type MMKV } from 'react-native-mmkv';

export const storage: MMKV = createMMKV({
  id: 'revdsm-app-storage',
});

export const reduxPersistStorage = {
  setItem: (key: string, value: string): Promise<void> => {
    storage.set(key, value);
    return Promise.resolve();
  },
  getItem: (key: string): Promise<string | null | undefined> => {
    const value = storage.getString(key);
    return Promise.resolve(value ?? null);
  },
  removeItem: (key: string): Promise<void> => {
    storage.remove(key);
    return Promise.resolve();
  },
};

export const Storage = {
  getItem: (key: string): string | null => {
    return storage.getString(key) ?? null;
  },

  setItem: (key: string, value: string): void => {
    storage.set(key, value);
  },

  removeItem: (key: string): void => {
    storage.remove(key);
  },

  contains: (key: string): boolean => {
    return storage.contains(key);
  },

  getAllKeys: (): string[] => {
    return storage.getAllKeys();
  },
};
