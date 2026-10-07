import { Storage, storage } from '../utils/storage';
import {
  normalizeOwnerId,
  sessionKeysToClear,
} from '../utils/session-scope';

const OWNER_KEY = 'session:ownerId';

let cachedOwner: string | null = null;

export const getSessionOwner = (): string => {
  if (cachedOwner === null) cachedOwner = normalizeOwnerId(Storage.getItem(OWNER_KEY));
  return cachedOwner;
};

const writeOwner = (owner: string): void => {
  cachedOwner = owner;
  try {
    if (owner) Storage.setItem(OWNER_KEY, owner);
    else Storage.removeItem(OWNER_KEY);
  } catch (e) {
    console.warn('[session] could not record the session owner', e);
  }
};

type ResetHook = () => void;
const resetHooks = new Set<ResetHook>();

export const registerSessionResetHook = (hook: ResetHook): (() => void) => {
  resetHooks.add(hook);
  return () => {
    resetHooks.delete(hook);
  };
};

const runResetHooks = (): void => {
  resetHooks.forEach((hook) => {
    try {
      hook();
    } catch (e) {
      console.warn('[session] a store failed to reset', e);
    }
  });
};

export const resetSessionStorage = (nextOwner?: string | null): void => {
  runResetHooks();

  try {
    sessionKeysToClear(storage.getAllKeys()).forEach((key) => {
      try {
        storage.remove(key);
      } catch (e) {
        console.warn(`[session] could not clear ${key}`, e);
      }
    });
  } catch (e) {
    console.warn('[session] could not enumerate storage', e);
  }

  writeOwner(normalizeOwnerId(nextOwner));
};

export const adoptSessionOwner = (userId: unknown): boolean => {
  const next = normalizeOwnerId(userId);
  if (!next) return false;

  const current = getSessionOwner();
  if (current === next) return false;

  resetSessionStorage(next);
  return true;
};
