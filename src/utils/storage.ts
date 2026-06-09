/**
 * storage.ts — Centralized MMKV storage utility
 *
 * Replaces @react-native-async-storage/async-storage throughout the app.
 * MMKV is synchronous and ~30x faster than AsyncStorage.
 *
 * Usage:
 *   import { storage } from '../utils/storage';
 *
 *   storage.set('key', 'value');
 *   storage.getString('key');
 *   storage.remove('key');
 *
 * For Redux Persist (needs async adapter):
 *   import { reduxPersistStorage } from '../utils/storage';
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

// Single shared MMKV instance for the entire app
export const storage: MMKV = createMMKV({
  id: 'revdsm-app-storage',
});

/**
 * AsyncStorage-compatible async wrapper around MMKV.
 * Used only by Redux Persist which requires a Promise-based storage interface.
 */
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

/**
 * Convenience helpers that mirror AsyncStorage's API surface
 * but are synchronous under the hood.
 *
 * Use these in place of AsyncStorage.getItem / setItem / removeItem.
 */
export const Storage = {
  /** Get a string value by key. Returns null if not set. */
  getItem: (key: string): string | null => {
    return storage.getString(key) ?? null;
  },

  /** Set a string value by key. */
  setItem: (key: string, value: string): void => {
    storage.set(key, value);
  },

  /** Remove a value by key. */
  removeItem: (key: string): void => {
    storage.remove(key);
  },

  /** Check if a key exists. */
  contains: (key: string): boolean => {
    return storage.contains(key);
  },

  /** Get all stored keys. */
  getAllKeys: (): string[] => {
    return storage.getAllKeys();
  },
};
