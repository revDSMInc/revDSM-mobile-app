import AsyncStorage from '@react-native-async-storage/async-storage';
import { storage } from './storage';

const MIGRATION_FLAG = 'mmkv_migration_v1_done';

export async function migrateAsyncStorageToMMKV(): Promise<void> {
  if (storage.contains(MIGRATION_FLAG)) {
    return;
  }

  try {
    console.log('[Storage Migration] Starting AsyncStorage → MMKV migration...');

    const keys = await AsyncStorage.getAllKeys();
    if (keys && keys.length > 0) {
      const pairs = await AsyncStorage.multiGet(keys);
      if (pairs) {
        for (const [key, value] of pairs) {
          if (value !== null) {
            storage.set(key, value);
          }
        }
      }
      console.log(`[Storage Migration] Migrated ${keys.length} key(s):`, keys);
    } else {
      console.log('[Storage Migration] No keys found in AsyncStorage. Nothing to migrate.');
    }

    storage.set(MIGRATION_FLAG, 'true');
    console.log('[Storage Migration] Migration complete.');
  } catch (error) {
    console.error('[Storage Migration] Migration failed. Will retry on next boot.', error);
    // Do NOT set the flag so it retries next time
  }
}
