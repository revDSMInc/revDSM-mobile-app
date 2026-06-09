/**
 * migrate-storage.ts
 *
 * One-time migration from AsyncStorage → MMKV.
 * Runs on the very first app boot after the upgrade.
 * After migration completes, sets a flag so it never runs again.
 *
 * Keys migrated:
 *   accessToken, leadId, zoneCanvasserOpen, zoneMapState,
 *   risk_job_* (dynamic), rev_render_jobs_* (dynamic)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { storage } from './storage';

const MIGRATION_FLAG = 'mmkv_migration_v1_done';

export async function migrateAsyncStorageToMMKV(): Promise<void> {
  // Already migrated — skip
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

    // Mark migration as done
    storage.set(MIGRATION_FLAG, 'true');
    console.log('[Storage Migration] Migration complete.');

    // Optionally clear AsyncStorage after successful migration
    // Uncomment after confirming everything works:
    // await AsyncStorage.clear();
  } catch (error) {
    console.error('[Storage Migration] Migration failed. Will retry on next boot.', error);
    // Do NOT set the flag so it retries next time
  }
}
