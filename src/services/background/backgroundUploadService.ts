import { AppState, Platform, type AppStateStatus } from 'react-native';
import { hasSession } from '../api';
import { isOnline, onReconnect } from '../connectivity';
import {
  shouldStartBackgroundWork,
} from '../../utils/background-upload-policy';
import { pendingUploadCount, runBackgroundDrain } from './uploadCoordinator';
import { beginBackgroundGrace, endBackgroundGrace } from './nativeBackgroundTask';
import { startAndroidUploadService } from './androidUploadService';

let started = false;
let lastState: AppStateStatus = AppState.currentState;

const engageBackgroundUpload = async (): Promise<void> => {
  const pending = pendingUploadCount();
  if (!shouldStartBackgroundWork(pending, hasSession())) return;

  if (Platform.OS === 'ios') {
    const granted = await beginBackgroundGrace();
    if (!granted) {
      console.warn('[background] iOS refused a background task; drain resumes on foreground');
      return;
    }
    try {
      await runBackgroundDrain('ios-background');
    } finally {
      await endBackgroundGrace();
    }
    return;
  }

  const serviceStarted = await startAndroidUploadService(pending, isOnline());
  if (!serviceStarted) {
    runBackgroundDrain('android-no-service').catch((e) =>
      console.warn('[background] drain failed', e)
    );
  }
};

export const startBackgroundUploadService = (): void => {
  if (started) return;
  started = true;

  AppState.addEventListener('change', (next) => {
    const wasForeground = lastState === 'active';
    lastState = next;
    if (wasForeground && (next === 'inactive' || next === 'background')) {
      engageBackgroundUpload().catch((e) =>
        console.warn('[background] could not engage background upload', e)
      );
    }
  });

  onReconnect(() => {
    if (lastState === 'active') return;
    engageBackgroundUpload().catch((e) =>
      console.warn('[background] could not re-engage on reconnect', e)
    );
  });
};
